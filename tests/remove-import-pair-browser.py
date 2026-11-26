"""Removing an optional translation preserves the original scan and avoids another OCR pass."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect,sync_playwright

HERE=Path(__file__).parent
serve=runpy.run_path(str(HERE/"sync-browser.py"))["serving"]
scan=runpy.run_path(str(HERE/"webp-ocr-browser.py"))["fixture"]


def run(dist,chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        workers=[]
        def fence(r):
            url=r.request.url
            if url.startswith(origin+"/vendor/ocr-v1/worker.min.js"):
                workers.append(url)
            return r.continue_() if url.startswith((origin+"/","blob:","data:")) else r.abort()
        c.route("**/*",fence)
        c.add_init_script("""localStorage.setItem('folio-v2', JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          const read=File.prototype.arrayBuffer;window.folioFixtureReads={};
          File.prototype.arrayBuffer=function(...args){
            folioFixtureReads[this.name]=(folioFixtureReads[this.name]||0)+1;
            return read.apply(this,args);
          };""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        orig,trans=(p.locator(s) for s in ["#original-file","#translation-file"])
        remove=p.get_by_role("button",name="Убрать файл перевода")
        expect(remove).to_be_hidden()
        orig.set_input_files({"name":"Original scan.webp","mimeType":"image/webp","buffer":scan()})
        unhealthy={"name":"Broken translation.txt","mimeType":"text/plain","buffer":b"\xff"}
        trans.set_input_files(unhealthy)
        expect(remove).to_be_visible(timeout=1400)
        remove.tap()
        assert orig.evaluate("el=>el.files[0]?.name")=="Original scan.webp"
        assert trans.evaluate("el=>el.files.length")==0
        assert not workers and p.evaluate("folioFixtureReads")=={}
        expect(p.locator("#save-import")).to_be_hidden()

        trans.set_input_files(unhealthy)
        p.locator("#ocr-panel summary").tap()
        p.locator("#ocr-original").select_option("eng")
        p.locator("#preview-import").tap()
        expect(p.locator("#import-status")).to_contain_text("Не удалось прочитать текст", timeout=25000)
        assert len(workers)==1 and p.evaluate("folioFixtureReads['Original scan.webp']")==1
        remove.press("Enter")
        expect(p.locator("#import-preview .ocr-review")).to_contain_text("Follow the river.")
        expect(p.locator("#alignment-check")).to_be_hidden()
        expect(p.locator("#save-import")).to_be_focused()
        expect(p.locator("#ocr-original")).to_have_value("eng")
        expect(remove).to_be_hidden()
        assert orig.evaluate("el=>el.files[0]?.name")=="Original scan.webp"
        assert trans.evaluate("el=>el.files.length")==0
        assert len(workers)==1 and p.evaluate("folioFixtureReads['Original scan.webp']")==1
        p.locator("#save-import").tap()
        expect(p.locator("#paragraph-0")).to_have_text("Follow the river.")
        expect(p.locator("#reading-note")).to_contain_text("Файл перевода не добавлен.")
        assert not errors,errors
        print("Optional file removed before and after preview error; original was kept, saved and recognized exactly once.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
