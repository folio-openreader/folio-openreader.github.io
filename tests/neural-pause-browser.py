"""Trust the mobile reader UI while precisely controlling local neural PCM completion."""
from argparse import ArgumentParser
from pathlib import Path
import json
import re
import runpy
from playwright.sync_api import expect, sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("epub-illustrations-browser.py")))
serve,epub=fixture["serve"],fixture["epub"]
FIRST="Soft morning light spread over the harbor."
SECOND="The tide carried the little boat toward the quay."

SETUP="""
localStorage.setItem('folio-v2',JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
localStorage.setItem('folio.voice.1.en-Latn',JSON.stringify({voice:'folio:en-v1:jasper',rate:1}));
const has=CacheStorage.prototype.has,open=CacheStorage.prototype.open;
CacheStorage.prototype.has=function(key){
  if(!key.startsWith('folio-voices-'))return has.call(this,key);
  V.probes++;return Promise.resolve(true);
};
CacheStorage.prototype.open=function(key){
  if(!key.startsWith('folio-voices-'))return open.call(this,key);
  return Promise.resolve({keys:async()=>files.map(name=>({url:new URL('/voices/en-v1/'+name,location.origin).href}))});
};
const V=window.voiceHarness={jobs:[],starts:[],workers:0,terminated:0,native:0,probes:0,time:0,source:null};
const measuredNow=performance.now.bind(performance);
Object.defineProperty(performance,'now',{value:()=>measuredNow()+(V.clockJump||0)});
V.deliver=(i,samples=24000)=>{
  const job=V.jobs[i];if(!job||job.owner.dead)throw Error('Worker cannot finish this job');
  const pcm=new Float32Array(samples);pcm[0]=i+1;
  job.owner.onmessage({data:{id:job.id,pcm,rate:24000}});
};
V.finish=()=>V.source?.onended?.();
const Real=Worker;
window.Worker=class extends EventTarget{
  constructor(url,options){
    super();
    if(typeof url!=='string'||!url.startsWith('blob:'))return new Real(url,options);
    V.workers++;
  }
  postMessage(params){V.jobs.push({...params,owner:this});}
  terminate(){this.dead=true;V.terminated++;}
};
window.AudioContext=class{
  constructor(){this.state='suspended';this.destination={};}
  get currentTime(){return V.time;}
  resume(){this.state='running';return Promise.resolve();}
  close(){this.state='closed';return Promise.resolve();}
  createBuffer(_channels,length,rate){
    return {duration:length/rate,copyToChannel(data){this.id=data[0];}};
  }
  createBufferSource(){
    return {connect(){},disconnect(){},stop(){},start(when,offset){
      V.source=this;V.starts.push({id:this.buffer.id,when,offset});
    }};
  }
};
const speech=new EventTarget();speech.getVoices=()=>[];speech.cancel=()=>{};
speech.speak=()=>V.native++;
Object.defineProperty(window,'speechSynthesis',{value:speech});
Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{constructor(text){this.text=text;}}});
"""


def run(dist,chromium):
    files=re.findall(r'"file": "([^"]+)"',(dist/"neural-assets.js").read_text("utf-8"))+["installed"]
    assert len(files)>1
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        external,errors=[],[]
        def fence(r):
            u=r.request.url
            if u.startswith(origin+"/voices/en-v1/"):
                external.append(u)
                r.abort()
            elif u.startswith((origin+"/","blob:","data:")):
                r.continue_()
            else:
                external.append(u)
                r.abort()
        c.route("**/*",fence)
        c.add_init_script("const files="+json.dumps(files)+";"+SETUP)

        def reader():
            p=c.new_page()
            p.set_default_timeout(4000)
            p.on("pageerror",lambda e:errors.append(str(e)))
            p.goto(origin+"/app.html#library")
            p.locator("#folio-boot").wait_for(state="detached")
            p.wait_for_function("voiceHarness.probes>0")
            p.locator("#import-open").tap()
            p.locator("#original-file").set_input_files({"name":"Narration fixture.epub",
             "mimeType":"application/epub+zip","buffer":epub("Narration fixture","en",FIRST,SECOND)})
            p.locator("#preview-import").tap()
            p.locator("#save-import").tap()
            expect(p.locator("#book-title")).to_have_text("Narration fixture")
            return p

        def audio(p,n):
            p.wait_for_function("n=>voiceHarness.starts.length===n",arg=n)

        def jobs(p):
            return p.evaluate("voiceHarness.jobs.map(x=>[x.text,x.voice,x.rate])")

        p=reader()
        listen=p.locator("#reader-listen")
        listen.tap()
        p.wait_for_function("voiceHarness.jobs.length===1")
        p.evaluate("voiceHarness.deliver(0)")
        audio(p,1)
        p.wait_for_function("voiceHarness.jobs.length===2")
        p.evaluate("voiceHarness.deliver(1)")
        # Ensure the promise for the completed lookahead settles, but never
        # give the test clock enough time to synthesize any unexpected rerun.
        p.evaluate("() => new Promise(requestAnimationFrame)")
        p.evaluate("voiceHarness.time=.35")
        listen.tap()
        expect(listen).to_have_accessible_name("Продолжить слушать")
        listen.tap()
        audio(p,2)
        assert p.evaluate("voiceHarness.starts.at(-1)")=={"id":1,"when":.35,"offset":.35}
        actual=jobs(p)
        assert actual==[[FIRST,"Jasper",1],[SECOND,"Jasper",1]],actual
        p.evaluate("voiceHarness.time=1;voiceHarness.finish()")
        audio(p,3)
        assert p.evaluate("voiceHarness.starts.at(-1)")=={"id":2,"when":1,"offset":0}
        expect(p.locator("#reading-progress")).to_contain_text("абзац 2 / 2")
        assert len(jobs(p))==2,jobs(p)
        assert p.evaluate("voiceHarness.native") == 0
        p.close()

        # An unfinished lookahead may be canceled during pause; that prevents
        # model work while idle. Resume still uses the current audio offset.
        q=reader()
        listen=q.locator("#reader-listen")
        listen.tap()
        q.wait_for_function("voiceHarness.jobs.length===1")
        q.evaluate("voiceHarness.deliver(0)")
        audio(q,1)
        q.wait_for_function("voiceHarness.jobs.length===2")
        listen.tap()
        expect(listen).to_have_accessible_name("Продолжить слушать")
        assert q.evaluate("voiceHarness.terminated")==1
        assert len(jobs(q))==2
        listen.tap()
        audio(q,2)
        q.wait_for_function("voiceHarness.jobs.length===3")
        assert [row[0] for row in jobs(q)]==[FIRST,SECOND,SECOND]
        q.evaluate("voiceHarness.deliver(2)")
        q.evaluate("voiceHarness.finish()")
        audio(q,3)
        assert q.evaluate("voiceHarness.native")==0
        q.close()

        # An expired or exceptionally large completed lookahead is not retained.
        for limit in ("expiry","memory"):
            tab=reader()
            listen=tab.locator("#reader-listen")
            listen.tap()
            tab.wait_for_function("voiceHarness.jobs.length===1")
            tab.evaluate("voiceHarness.deliver(0)")
            audio(tab,1)
            tab.wait_for_function("voiceHarness.jobs.length===2")
            tab.evaluate("samples=>voiceHarness.deliver(1,samples)", 600000 if limit=="memory" else 24000)
            tab.evaluate("() => new Promise(requestAnimationFrame)")
            listen.tap()
            expect(listen).to_have_accessible_name("Продолжить слушать")
            if limit=="expiry":
                tab.evaluate("voiceHarness.clockJump=21000")
            listen.tap()
            audio(tab,2)
            assert [row[0] for row in jobs(tab)]==[FIRST,SECOND,SECOND],(limit,jobs(tab))
            tab.close()

        assert not external,external
        assert not errors,errors
        b.close()
    print("320px neural controls: resumed exact offset; ready next paragraph reused without inference, unfinished, expired and oversized work not retained.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
