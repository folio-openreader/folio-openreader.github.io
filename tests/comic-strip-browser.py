"""A 320px CBZ can advance by scroll, keep the page anchor, and still use page OCR."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
from struct import pack
import runpy
from zipfile import ZIP_STORED, ZipFile
import zlib
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
OCR="""export async function recognizeComicPage(blob,{language}={}){
  if(!(blob instanceof Blob) || language!=='kor')throw Error('Wrong source page or language');
  return {paragraphs:[{text:'작은 정원입니다.'}],words:[]};
}"""
N=9


def cbz(height=1800):
    stream=BytesIO()
    width=320
    def chunk(tag,data):
        return pack(">I",len(data))+tag+data+pack(">I",zlib.crc32(tag+data))
    with ZipFile(stream,"w",compression=ZIP_STORED) as archive:
        for i in reversed(range(1,N+1)):
            rows=(b"\0"+bytes((20+i*19,60,100))*width)*height
            archive.writestr(f"pages/page{i}.png",b"\x89PNG\r\n\x1a\n"+
                chunk(b"IHDR",pack(">IIBBBBB",width,height,8,2,0,0,0))+
                chunk(b"IDAT",zlib.compress(rows))+chunk(b"IEND",b""))
    return stream.getvalue()


MEASURE="""(i)=>{
 const sc=document.querySelector('#reading-scroll'),bar=sc.querySelector('.comic-strip-bar');
 const frame=sc.querySelector(`.comic-strip-frame[data-page="${i}"]`).getBoundingClientRect();
 return (sc.getBoundingClientRect().top+bar.offsetHeight-frame.top)/frame.height;
}"""
SCROLL="""([i,relative])=>{
 const sc=document.querySelector('#reading-scroll'),bar=sc.querySelector('.comic-strip-bar');
 const frame=sc.querySelector(`.comic-strip-frame[data-page="${i}"]`).getBoundingClientRect();
 sc.scrollTop+=frame.top-sc.getBoundingClientRect().top-bar.offsetHeight+frame.height*relative;
}"""


def run(dist,chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        def fence(r):
            if r.request.url==origin+"/comic-ocr.js":
                r.fulfill(content_type="text/javascript",body=OCR)
            elif r.request.url.startswith((origin+"/","blob:","data:")):
                r.continue_()
            else:
                r.abort()
        c.route("**/*",fence)
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        errors=[]
        def open_app(p,section):
            p.set_default_timeout(7000)
            p.on("pageerror",lambda e:errors.append(str(e)))
            p.goto(origin+"/app.html#"+section)
            p.locator("#folio-boot").wait_for(state="detached")
        p=c.new_page()
        open_app(p,"library")
        p.locator("#comic-import-open").tap()
        p.locator("#comic-language").select_option("kor")
        p.locator("#comic-files").set_input_files({"name":"Local comic.cbz","mimeType":"application/x-cbz","buffer":cbz()})
        p.locator("#comic-import-start").tap()
        expect(p.locator(".comic-art")).to_have_attribute("alt","Страница 1")
        layout=p.get_by_role("button",name="Вертикальная лента",exact=True)
        expect(layout).to_have_attribute("aria-pressed","false")
        layout.press("Enter")
        expect(layout).to_have_attribute("aria-pressed","true")
        expect(layout).to_be_focused()
        expect(p.locator(".comic-strip-frame")).to_have_count(N)
        p.wait_for_function("""() => document.querySelector('.comic-strip-frame[data-page="0"] img')?.naturalHeight===1800""")
        assert 1<=p.locator(".comic-strip-frame img[src]").count()<=5
        p.evaluate(SCROLL,[5,.34])
        expect(p.locator("#reading-progress")).to_have_text("6 / 9")
        p.wait_for_function("""() => document.querySelector('.comic-strip-frame[data-page="5"] img')?.naturalHeight===1800""")
        expect(p.locator('.comic-strip-frame[data-page="0"] img[src]')).to_have_count(0)
        assert 1<=p.locator(".comic-strip-frame img[src]").count()<=5
        relative=p.evaluate(MEASURE,5)
        assert abs(relative-.34)<.004, relative
        p.set_viewport_size({"width":390,"height":750})
        p.wait_for_function("""() => document.querySelector('.comic-strip-frame[data-page="5"]').getBoundingClientRect().width>=389""")
        p.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
        assert abs(p.evaluate(MEASURE,5)-relative)<.004
        exact=p.evaluate("""() => {
          ("""+SCROLL+""")([5,.43]);
          const point=("""+MEASURE+""")(5);
          document.querySelector('#reader-back').click();
          return point;
        }""")
        expect(p.locator("#reader")).to_be_hidden()
        p.close()
        p=c.new_page()
        open_app(p,"home")
        p.locator("#continue-card button").tap()
        expect(p.locator("#comic-layout")).to_have_attribute("aria-pressed","true")
        expect(p.locator("#reading-progress")).to_have_text("6 / 9")
        p.wait_for_function("""() => document.querySelector('.comic-strip-frame[data-page="5"] img')?.naturalHeight===1800""")
        assert abs(p.evaluate(MEASURE,5)-exact)<.004, (p.evaluate(MEASURE,5),exact)
        p.get_by_role("button",name="Распознавание текущей страницы").tap()
        expect(p.locator(".comic-art")).to_have_attribute("alt","Страница 6")
        scan=p.get_by_role("button",name="Распознать слова на странице")
        expect(scan).to_be_focused()
        scan.tap()
        p.get_by_role("button",name="Показать распознанный текст").tap()
        expect(p.locator(".comic-transcript")).to_have_text("작은 정원입니다.")
        p.locator("#comic-layout").tap()
        expect(p.locator("#reading-progress")).to_have_text("6 / 9")
        expect(p.locator("#comic-layout")).to_have_attribute("aria-pressed","true")
        p.locator('.comic-strip-frame[data-page="5"] img[src]').wait_for(state="visible")
        p.evaluate("""() => {const sc=document.querySelector('#reading-scroll');sc.scrollTop=sc.scrollHeight}""")
        expect(p.locator("#reading-progress")).to_have_text("9 / 9")
        # Very short panels must not leave blank holes in the visible area.
        p.locator("#reader-back").tap()
        p.locator("[data-view=library]:visible").first.tap()
        p.locator("#comic-import-open").tap()
        p.locator("#comic-files").set_input_files({"name":"Wide comic.cbz",
            "mimeType":"application/x-cbz","buffer":cbz(72)})
        p.locator("#comic-import-start").tap()
        expect(p.locator("#book-title")).to_have_text("Wide comic")
        p.locator("#comic-layout").tap()
        p.wait_for_function("""()=>{
          const sc=document.querySelector('#reading-scroll');
          const bottom=sc.getBoundingClientRect().bottom,bar=sc.querySelector('.comic-strip-bar');
          if(!bar)return false;
          const top=bar.getBoundingClientRect().bottom;
          const visible=[...sc.querySelectorAll('.comic-strip-frame')].filter(frame=>{
            const r=frame.getBoundingClientRect();return r.top<bottom&&r.bottom>top;
          });
          return visible.length>5&&visible.every(f=>f.querySelector('img')?.naturalHeight===72);
        }""")
        assert p.locator(".comic-strip-frame img[src]").count()<=10
        assert not errors,errors
        b.close()
    print("320px CBZ: normal page remains default; scroll crosses pages with at most five images, survives resize and immediate close, opens the selected page’s Korean OCR, reaches page 9, and renders all visible short panels within the cap.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
