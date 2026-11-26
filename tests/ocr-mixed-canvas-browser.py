"""An unavailable optional OCR canvas doesn't erase readable PDF text."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

here = Path(__file__).parent
serve = runpy.run_path(str(here / "sync-browser.py"))["serving"]
mixed = runpy.run_path(str(here / "ocr-mixed-faint-browser.py"))
scan = runpy.run_path(str(here / "ocr-failure-browser.py"))["fixture"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True,
                                     args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                                  reduced_motion="reduce", service_workers="block")
        ctx.route("**/*",lambda r: r.continue_() if
                  r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
          readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          window.fixtureCanvasBlocked=true;window.fixtureCanvasFailures=0;
          const get=HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext=function(type,...args){
            if(fixtureCanvasBlocked&&type==='2d'&&this.width>600&&new Error().stack.includes('/ocr-engine.js')){
              fixtureCanvasFailures++;
              return null;
            }
            return get.call(this,type,...args);
          };
        """)
        errors = []

        def start(filename, content):
            p=ctx.new_page()
            p.set_default_timeout(6500)
            p.on("pageerror",lambda e:errors.append(str(e)))
            p.goto(origin + "/app.html#library")
            p.locator("#folio-boot").wait_for(state="detached")
            p.locator("#import-open").tap()
            p.locator("#original-file").set_input_files({"name":filename,
                "mimeType":"application/pdf","buffer":content})
            p.locator("#preview-import").tap()
            return p

        p=start("Mixed PDF.pdf",mixed["fixture"]())
        preview=p.locator("#import-preview")
        expect(preview).to_be_visible(timeout=4500)
        warning=preview.get_by_text("Не удалось обработать изображения для OCR на страницах: 1, 2, 3.",exact=False)
        expect(warning).to_be_visible()
        for key in ("HEAD","CONTROL","GRAY"):
            expect(preview).to_contain_text(mixed[key])
        assert p.evaluate("fixtureCanvasFailures")==3
        expect(p.locator("#save-import")).to_be_enabled()

        # A degraded parse is useful but not a completed cache hit.
        p.evaluate("fixtureCanvasBlocked=false")
        p.locator("#preview-import").tap()
        expect(preview.locator(".ocr-review")).to_contain_text(mixed["CAPTION"],timeout=32000)
        expect(warning).to_have_count(0)
        p.locator("#save-import").tap()
        expect(p.locator("#passage .reading-paragraph")).to_have_text([mixed["HEAD"],mixed["CAPTION"]])
        p.close()

        pure=start("Scan only.pdf",scan(False))
        expect(pure.locator("#import-status")).to_contain_text("Браузер не поддерживает обработку изображения")
        expect(pure.locator("#import-preview")).to_be_hidden()
        expect(pure.locator("#save-import")).to_be_hidden()
        assert not errors,errors
        print("Mixed PDF preserved all three original pages after optional canvas failure; retry used real OCR; scan-only failure stayed explicit.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
