"""Only the visible strip window should finish reads while local storage is busy."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
from struct import pack
import runpy
import zlib
from random import Random
from zipfile import ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

harness=runpy.run_path(str(Path(__file__).with_name("comic-strip-browser.py")))
serve,SCROLL,MEASURE=(harness[k] for k in ("serve","SCROLL","MEASURE"))
N,WIDTH,HEIGHT=60,320,620
VISITS=[6,14,22,30,38,46,54]
SPY=r"""
(() => {
 const stored=IDBObjectStore.prototype.get, make=URL.createObjectURL.bind(URL), drop=URL.revokeObjectURL.bind(URL);
 const owners=new WeakMap(),live=new Map();
 const empty=()=>({context:0,reads:[],getResults:[],complete:[],aborted:[],created:[],revoked:[],peakURLs:0});
 const state=window.readTest={data:null,start(){this.data=empty();}};
 IDBObjectStore.prototype.get=function(key){
   const request=stored.apply(this,arguments),test=state.data;
   if(key?.[0]!=='comic-page'||!test||!document.querySelector('.comic-strip'))return request;
   const index=key[2], tx=this.transaction, visit=test.context;
   test.reads.push({index,visit});
   request.addEventListener('success',()=>{
     const result=request.result;
     if(result?.blob){owners.set(result.blob,index);test.getResults.push({index,visit,current:test.context,size:result.blob.size});}
   });
   tx.addEventListener('complete',()=>test.complete.push(index));
   tx.addEventListener('abort',()=>test.aborted.push(index));
   return request;
 };
 URL.createObjectURL=blob=>{
   const url=make(blob), test=state.data, index=owners.get(blob);
   if(test&&index!==undefined){
     live.set(url,index);test.created.push({index,current:test.context});test.peakURLs=Math.max(test.peakURLs,live.size);
   }
   return url;
 };
 URL.revokeObjectURL=url=>{
   if(live.has(url)){state.data?.revoked.push(live.get(url));live.delete(url);}
   return drop(url);
 };
 window.occupyBooks=()=>new Promise((resolve,reject)=>{
   const opened=indexedDB.open('folio-library');
   opened.onerror=()=>reject(opened.error);
   opened.onsuccess=()=>{
     const db=opened.result, lane=db.transaction('books','readwrite');
     const store=lane.objectStore('books'), until=performance.now()+15000;
     let released=false, first=true;
     window.finishOccupation=()=>{released=true};
     lane.oncomplete=()=>db.close();lane.onabort=()=>{db.close();reject(lane.error);};
     function next(){
       store.get('synthetic-lock-probe').onsuccess=()=>{
         if(first){first=false;resolve();}
         if(!released&&performance.now()<until)next();
       };
     }
     next();
   };
 });
})();
"""

def comic():
    def chunk(tag,data):
        return pack(">I",len(data))+tag+data+pack(">I",zlib.crc32(tag+data))
    noise=Random(49609).randbytes(WIDTH*HEIGHT*3)
    row=WIDTH*3
    noise=b"".join(b"\0"+noise[i:i+row] for i in range(0,len(noise),row))
    out=BytesIO()
    with ZipFile(out,"w",compression=ZIP_STORED) as zip:
        for i in range(1,N+1):
            page=b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",pack(">IIBBBBB",WIDTH,HEIGHT,8,2,0,0,0))
            page+=chunk(b"IDAT",zlib.compress(noise[:1]+bytes([i])+noise[2:],1))+chunk(b"IEND",b"")
            zip.writestr(f"story/page{i:03d}.png",page)
    return out.getvalue()

def run(dist,chromium,contended):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                         reduced_motion="reduce",service_workers="block")
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));"""+SPY)
        unexpected=[]
        def fence(route):
            if route.request.url.startswith((origin+"/","blob:","data:")):route.continue_()
            else:unexpected.append(route.request.url);route.abort()
        c.route("**/*",fence)
        p=c.new_page();p.set_default_timeout(11000)
        errors=[];p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#comic-import-open").tap()
        p.locator("#comic-language").select_option("kor")
        data=comic();print(f"CBZ {N} pages, {len(data)} bytes; contended={contended}",flush=True)
        p.locator("#comic-files").set_input_files({"name":"Synthetic long strip.cbz","mimeType":"application/x-cbz","buffer":data})
        p.locator("#comic-import-start").tap()
        p.locator(".comic-art").wait_for(state="visible",timeout=25000)
        p.locator("#comic-layout").tap()
        p.wait_for_function("""()=>document.querySelector('.comic-strip-frame[data-page="0"] img')?.naturalHeight===620""")
        if contended:p.evaluate("() => occupyBooks()")
        p.evaluate("() => readTest.start()")
        for index in VISITS:
            p.evaluate("i=>{readTest.data.context=i;("+SCROLL+")([i,.31]);}",index)
            expect(p.locator("#reading-progress")).to_have_text(f"{index+1} / {N}")
        if contended:
            before=p.evaluate("readTest.data")
            assert len(before["reads"])>=28 and not before["complete"],before
            p.evaluate("finishOccupation()")
        final=VISITS[-1]
        p.wait_for_function("""i=>document.querySelector('.comic-strip-frame[data-page="'+i+'"] img')?.naturalHeight===620""",arg=final)
        p.wait_for_function("""()=>{const d=readTest.data;return d.complete.length+d.aborted.length===d.reads.length}""")
        assert abs(p.evaluate(MEASURE,final)-.31)<.004
        assert p.locator(".comic-strip-frame img[src]").count()<=10
        results=p.evaluate("readTest.data")
        stale=[x for x in results["getResults"] if x["current"]!=x["visit"]]
        escaped=[x for x in results["created"] if not x["current"]-2<=x["index"]<=x["current"]+2]
        print("RESULT",{"started":len(results["reads"]),"completed":len(results["complete"]),
             "aborted":len(results["aborted"]),"staleResults":len(stale),
             "staleBlobHandlesBytes":sum(x["size"] for x in stale),
             "created":len(results["created"]),"staleUrls":len(escaped),
             "maxLiveUrls":results["peakURLs"]},flush=True)
        if contended:
            assert not stale and not escaped,results
            assert len(results["aborted"])>=24,results
            assert all(final-2<=i<=final+2 for i in results["complete"]),results
        assert results["peakURLs"]<=10 and not errors and not unexpected,(results,errors,unexpected)
        b.close()

if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium",required=True)
    parser.add_argument("--contended",action="store_true")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium,a.contended)
