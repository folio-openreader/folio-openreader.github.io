"""A user-selected speech balloon runs real local Korean OCR on only that crop."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

fixtures=runpy.run_path(str(Path(__file__).with_name("comic-korean-ocr-browser.py")))
serve,sample=fixtures["serve"],fixtures["sample"]
TOP,BOTTOM=fixtures["TOP"],fixtures["BOTTOM"]
ANCHOR="""() => {
 const sc=document.querySelector('#reading-scroll'),f=sc.querySelector('.comic-frame').getBoundingClientRect();
 return (sc.getBoundingClientRect().top+sc.querySelector('.comic-bar').offsetHeight-f.top)/f.height;
}"""


def run(dist,chromium,font):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        external=[]
        def fence(route):
            if route.request.url.startswith((origin+"/","blob:","data:")): route.continue_()
            else:
                external.append(route.request.url)
                route.abort()
        c.route("**/*",fence)
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          const Native=Worker;
          window.ocrCrops=[];
          window.Worker=class extends Native{
            postMessage(job,...args){
              if(job.action==='recognize'){
                const bytes=job.payload.image;
                const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
                const dimensions=[d.getUint32(16),d.getUint32(20)];
                window.ocrCrops.push(dimensions);
                // Only the cancellation probe pauses a real worker's job.
                // The successful attempt below sends normal inference bytes.
                if(window.blockRegion&&dimensions[0]<550&&dimensions[1]<250){
                  this.blockedRegion=true;window.blockedRegion=true;return;
                }
              }
              return super.postMessage(job,...args);
            }
            terminate(){if(this.blockedRegion)window.terminatedRegion=true;return super.terminate();}
          };""")
        p=c.new_page()
        p.set_default_timeout(18000)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#comic-import-open").tap()
        p.locator("#comic-language").select_option("kor")
        p.locator("#comic-files").set_input_files({"name":"Local garden.cbz",
            "mimeType":"application/x-cbz","buffer":sample(font)})
        p.locator("#comic-import-start").tap()
        expect(p.locator(".comic-art")).to_be_visible()
        p.locator(".comic-scan").tap()
        expect(p.locator(".comic-text-toggle")).to_be_visible()
        older=p.locator(".comic-hotspot").all_text_contents()
        assert older[:2]==["작은","정원"] and older[-2:]!=["좋은","아침"],older
        preserved=p.locator('.comic-hotspot[data-word="정원"]').get_attribute("style")
        existing=len(p.evaluate("window.ocrCrops"))
        assert existing>=2
        p.locator("#reading-scroll").evaluate("sc=>sc.scrollTop=610")
        p.wait_for_function("""() => JSON.parse(localStorage.getItem('folio-v2')).positions[
         JSON.parse(localStorage.getItem('folio-v2')).lastBook]?.comicImageOffset>.1""")
        before=p.evaluate(ANCHOR)
        correction=p.locator(".comic-language")
        region=p.get_by_role("dialog",name="Область распознавания")
        go=region.get_by_role("button",name="Распознать область")

        def open_region():
            correction.tap()
            p.get_by_role("button",name="Выбрать область",exact=True).tap()
            expect(region).to_be_visible()
            p.wait_for_function("document.querySelector('#comic-region-dialog img')?.naturalHeight===4800")
            expect(go).to_be_disabled()

        def touch(x,y):
            point=region.locator(".comic-region-viewport").evaluate("""(v,[x,y])=>{
               const img=v.querySelector('img');
               v.scrollTop=img.offsetHeight*y-v.clientHeight/2;
               const r=img.getBoundingClientRect();
               return [r.left+r.width*x,r.top+r.height*y];
            }""",[x,y])
            p.touchscreen.tap(*point)

        open_region()
        cancelled=region.locator("img").get_attribute("src")
        assert cancelled.startswith("blob:")
        touch(.30,.94)
        expect(go).to_be_disabled()
        p.keyboard.press("Escape")
        expect(region).to_be_hidden()
        expect(correction).to_be_focused()
        assert len(p.evaluate("window.ocrCrops"))==existing
        assert abs(p.evaluate(ANCHOR)-before)<.003
        assert not p.evaluate("url=>fetch(url).then(r=>r.ok,()=>false)",cancelled)

        open_region()
        p.set_viewport_size({"width":374,"height":740})
        touch(.30,.94)
        touch(.70,.965)
        expect(go).to_be_enabled()
        p.evaluate("window.blockRegion=true")
        go.tap()
        expect(region).to_be_hidden()
        p.wait_for_function("window.blockedRegion")
        p.get_by_role("button",name="Отменить распознавание области",exact=True).press("Enter")
        p.wait_for_function("window.terminatedRegion")
        expect(correction).to_be_focused()
        assert p.locator(".comic-hotspot").all_text_contents()==older
        assert abs(p.evaluate(ANCHOR)-before)<.005
        p.evaluate("window.blockRegion=false")
        existing=len(p.evaluate("window.ocrCrops"))

        open_region()
        touch(.30,.94)
        touch(.70,.965)
        expect(go).to_be_enabled()
        go.tap()
        expect(region).to_be_hidden()
        p.wait_for_function("""() => Array.from(document.querySelectorAll('.comic-hotspot'))
          .map(x=>x.textContent).join(' ') === '작은 정원 좋은 아침'""")
        jobs=p.evaluate("window.ocrCrops")[existing:]
        assert len(jobs)==1 and jobs[0][0]<550 and jobs[0][1]<250,jobs
        assert p.locator('.comic-hotspot[data-word="정원"]').get_attribute("style")==preserved
        assert abs(p.evaluate(ANCHOR)-before)<.005,(before,p.evaluate(ANCHOR))
        p.locator(".comic-text-toggle").tap()
        expect(p.locator(".comic-transcript p")).to_have_text([TOP,BOTTOM])
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator(".comic-text-toggle").tap()
        expect(p.locator(".comic-transcript p")).to_have_text([TOP,BOTTOM])
        assert not p.evaluate("window.ocrCrops")
        # Emulate prior sparse OCR splitting a lower line around an unlocated
        # caption. A real block recognition can now propose one merged line
        # spanning two old slots; this must not write or move either old slot.
        chapter=["작은 정원","좋은","Unlocated caption","아침"]
        stored_ocr=r"""async texts=>{
          const {readComicPage,updateComicPage}=await import('./comic-storage.js');
          const id=JSON.parse(localStorage.getItem('folio-v2')).lastBook;
          const db=await new Promise((resolve,reject)=>{
            const req=indexedDB.open('folio-library');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
          });
          try{
            const row=await readComicPage(db,id,0);
            if(!texts)return row.ocr;
            const words=row.ocr.words.map(w=>w.paragraphIndex===0?w:{
              ...w,paragraphIndex:w.text==='좋은'?1:3,offset:0
            });
            const ocr={...row.ocr,paragraphs:texts.map(text=>({text})),text:texts.join('\n\n'),words};
            await updateComicPage(db,id,{...row,ocr});
            return ocr;
          }finally{db.close();}
        }"""
        old_ocr=p.evaluate(stored_ocr,chapter)
        p.set_viewport_size({"width":320,"height":740})
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(correction).to_be_visible()
        p.locator(".comic-text-toggle").tap()
        expect(p.locator(".comic-transcript p")).to_have_text(chapter)
        p.locator(".comic-text-toggle").tap()
        p.locator("#reading-scroll").evaluate("el=>el.scrollTop=610")
        p.wait_for_function("document.querySelector('#reading-scroll').scrollTop===610")
        prior_ambiguous_anchor=p.evaluate(ANCHOR)
        p.evaluate("window.lastMark=document.querySelector('.comic-hotspot[data-word=아침]')")
        open_region()
        touch(.30,.94)
        touch(.70,.965)
        expect(go).to_be_enabled()
        go.tap()
        expect(p.locator("#toast")).to_contain_text("Порядок реплик неясен. Старый текст оставлен.")
        expect(p.locator(".comic-ocr-progress")).to_be_hidden()
        assert p.evaluate("window.ocrCrops.length") == 1
        assert p.evaluate("document.querySelector('.comic-hotspot[data-word=아침]')===window.lastMark")
        assert p.evaluate(stored_ocr,None)==old_ocr
        assert abs(p.evaluate(ANCHOR)-prior_ambiguous_anchor)<.005
        p.locator(".comic-text-toggle").tap()
        expect(p.locator(".comic-transcript p")).to_have_text(chapter)
        assert not external,external
        assert not errors,errors
        b.close()
    print("Real Korean OCR: selected context crop",jobs,"old outside box unchanged; cancel, scaling, nearby reading place and reload verified.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    parser.add_argument("--font",default=fixtures["FONT"])
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium,args.font)
