
"""A mixed-aspect strip restores points on the artwork at cold reopen and on resize."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
from struct import pack
import runpy, zlib
from zipfile import ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("comic-strip-browser.py")))
serve=fixture["serve"]
DIMS=[(320,1250),(760,160),(320,550),(280,1160),(640,180),(320,940),
      (510,300),(300,840),(800,100),(320,1180),(480,185),(290,1200)]
WATCH=8
OFFSET=.22
HELD="""()=>{
 const get=IDBObjectStore.prototype.get;
 window.mixedHeld=true;window.mixedCompletions=[];
 window.releaseMixed=()=>{
   window.mixedHeld=false;
   for(const callback of window.mixedCompletions.splice(0))callback();
 };
 IDBObjectStore.prototype.get=function(key){
  const request=get.apply(this,arguments);
  if(key?.[0]==='comic-page'&&document.querySelector('.comic-strip')){
   const transaction=this.transaction,complete=transaction.oncomplete;
   transaction.oncomplete=event=>{
    const dispatch=()=>complete.call(transaction,event);
    if(window.mixedHeld)window.mixedCompletions.push(dispatch);else dispatch();
   };
  }
  return request;
 };
}"""
ART="""([i,w,h,wanted])=>{
 const sc=document.querySelector('#reading-scroll');
 const bar=sc.querySelector('.comic-strip-bar'),frame=sc.querySelector('.comic-strip-frame[data-page="'+i+'"]');
 const r=frame.getBoundingClientRect(),at=sc.getBoundingClientRect().top+bar.offsetHeight;
 const artHeight=Math.min(r.height,r.width*h/w),artTop=r.top+(r.height-artHeight)/2;
 if(wanted!=null)sc.scrollTop+=artTop+artHeight*wanted-at;
 else return {artOffset:(at-artTop)/artHeight,slotOffset:(at-r.top)/r.height,
       width:r.width,slotHeight:r.height,artHeight,top:sc.scrollTop,loaded:!!frame.querySelector('img')?.naturalWidth};
}"""
def archive_bytes():
    def chunk(tag,data):
        return pack(">I",len(data))+tag+data+pack(">I",zlib.crc32(tag+data))
    f=BytesIO()
    with ZipFile(f,"w",compression=ZIP_STORED) as zip:
        for index,(w,h) in reversed(list(enumerate(DIMS))):
            data=(b"\0"+bytes((20+index*17,60,100))*w)*h
            zip.writestr(f"mixed/panel{index+1}.png",b"\x89PNG\r\n\x1a\n"+
                chunk(b"IHDR",pack(">IIBBBBB",w,h,8,2,0,0,0))+
                chunk(b"IDAT",zlib.compress(data))+chunk(b"IEND",b""))
    return f.getvalue()

opts=ArgumentParser()
opts.add_argument("dist",type=Path)
opts.add_argument("--chromium",required=True)
args=opts.parse_args()
with serve(args.dist.resolve()) as origin,sync_playwright() as pw:
    b=pw.chromium.launch(executable_path=args.chromium,headless=True,args=["--disable-dev-shm-usage"])
    c=b.new_context(viewport={"width":740,"height":320},is_mobile=True,has_touch=True,
         reduced_motion="reduce",service_workers="block")
    c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',JSON.stringify({
      prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}})); ("""+HELD+")();")
    external=[]
    def fence(row):
        if row.request.url.startswith((origin+"/","blob:","data:")): row.continue_()
        else: external.append(row.request.url);row.abort()
    c.route("**/*",fence)
    errors=[]
    def page(section, width, height):
        p=c.new_page();p.set_viewport_size({"width":width,"height":height})
        p.set_default_timeout(8000);p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#"+section);p.locator("#folio-boot").wait_for(state="detached")
        return p
    def measure(p):
        return p.evaluate(ART,[WATCH,*DIMS[WATCH],None])
    def loaded(p):
        index=WATCH
        p.wait_for_function("""i=>document.querySelector('.comic-strip-frame[data-page="'+i+'"] img')?.naturalWidth===800""",arg=index)
        expect(p.locator("#reading-progress")).to_have_text("9 / 12")
        assert p.locator(".comic-strip-frame img[src]").count()<=10
        return measure(p)
    def viewport(p,width,height):
        p.set_viewport_size({"width":width,"height":height})
        p.wait_for_function("""([n,w])=>document.querySelector('.comic-strip-frame[data-page="'+n+'"]').getBoundingClientRect().width===w""",arg=[WATCH,width])
        p.evaluate("() => new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
        return loaded(p)
    p=page("library",740,320)
    p.locator("#comic-import-open").tap()
    p.locator("#comic-language").select_option("kor")
    p.locator("#comic-files").set_input_files({"name":"Mixed anchor.cbz","mimeType":"application/x-cbz","buffer":archive_bytes()})
    p.locator("#comic-import-start").tap();expect(p.locator(".comic-art")).to_have_attribute("alt","Страница 1")
    p.locator("#comic-layout").tap()
    p.locator(".comic-strip-frame").last.wait_for(state="attached")
    p.evaluate(ART,[WATCH,*DIMS[WATCH],OFFSET])
    expect(p.locator("#reading-progress")).to_have_text("9 / 12")
    p.wait_for_function("window.mixedCompletions.length>0")
    p.evaluate("releaseMixed()")
    first=loaded(p)
    assert abs(first["artOffset"]-OFFSET)<=.012,first
    print("WIDE INITIAL",first,flush=True)
    p.locator("#reader-back").tap();expect(p.locator("#reader")).to_be_hidden();p.close()
    p=page("home",320,740);p.locator("#continue-card button").tap()
    expect(p.locator("#reading-progress")).to_have_text("9 / 12")
    p.wait_for_function("window.mixedCompletions.length>0")
    pending=measure(p)
    assert not pending["loaded"],pending
    print("NARROW COLD PENDING",pending,flush=True)
    p.evaluate("releaseMixed()")
    narrow=loaded(p)
    print("NARROW WITH BLOBS",narrow,flush=True)
    wide=viewport(p,740,320)
    again=viewport(p,320,740)
    for measured in (pending,narrow,wide,again):
        assert abs(measured["artOffset"]-first["artOffset"])<.017,(first,measured)
    assert abs(pending["artOffset"]-narrow["artOffset"])<.001,(pending,narrow)
    assert narrow["slotHeight"]>narrow["artHeight"],narrow

    # Old checkpoints only knew the slot fraction; the fallback does not
    # silently reinterpret that ratio as a point on a differently sized image.
    p.locator("#reader-back").tap()
    expect(p.locator("#reader")).to_be_hidden()
    p.evaluate("""() => {
      const key='folio-v2',disk=JSON.parse(localStorage.getItem(key));
      const pos=disk.positions[disk.lastBook];
      pos.comicImageOffset=.2;pos.fraction=.2;delete pos.comicStripArtworkOffset;
      localStorage.setItem(key,JSON.stringify(disk));
    }""")
    p.close()
    p=page("home",320,740);p.locator("#continue-card button").tap()
    expect(p.locator("#reading-progress")).to_have_text("9 / 12")
    p.wait_for_function("window.mixedCompletions.length>0")
    old=measure(p)
    assert abs(old["slotOffset"]-.2)<.008 and old["artOffset"]<0,old
    p.evaluate("releaseMixed()");loaded(p)
    print("Mixed-aspect CBZ: same artwork offset with local images pending/loaded, after cold reopen and resize; legacy slot fallback retained.",flush=True)
    assert not errors and not external,(errors,external)
    b.close()
