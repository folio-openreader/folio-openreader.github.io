"""Read a persisted result on the ribbon without opting in or opening a dialog."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

suite=runpy.run_path(str(Path(__file__).with_name("paragraph-cache-browser.py")))
serve, MODEL_MOCK, COUNT_CACHE=(suite[n] for n in ("serving","MODEL_MOCK","COUNT_CACHE"))
OLD="The evening ferry followed the northern shore."
NEW="Light through the window fell on the floor."


def run(dist, chromium):
    source=(dist/"local-translation.js").read_text("utf-8")
    adapter=source.replace("export function createLocalTranslator(","function realLocalTranslator(",1)
    adapter+=MODEL_MOCK.replace("capabilities:()=>true", "capabilities:()=>!sessionStorage.getItem('no-inference')")
    with serve(dist) as origin, sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        downloads=[]
        def fence(r):
            url=r.request.url
            if url==origin+"/local-translation.js":
                return r.fulfill(content_type="text/javascript; charset=utf-8",body=adapter)
            if url.startswith(origin+"/vendor/bergamot/"):
                downloads.append(url);return r.abort()
            return r.continue_() if url.startswith((origin+"/","blob:","data:")) else r.abort()
        c.route("**/*",fence)
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
          JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Ferry fixture.txt","mimeType":"text/plain",
            "buffer":(OLD+"\n\n"+NEW).encode()})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        p.locator("#translation-full").tap()
        p.locator("#local-translation-start").tap()
        sheet=p.locator("#translation-dialog")
        expect(sheet.locator(".machine-result")).to_contain_text(OLD)
        p.wait_for_function(f"async () => (await ({COUNT_CACHE})()) === 1")
        sheet.locator("[data-sheet-handle]").tap()
        auto=p.locator("#local-translation-open")
        expect(auto).to_have_text("Пауза")
        auto.tap()
        expect(auto).to_have_text("Продолжить")
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        ribbon=p.locator("#translation-track .translation-empty")
        expect(ribbon).to_contain_text(OLD,timeout=1500)
        expect(auto).to_have_text("Продолжить")
        expect(sheet).to_be_hidden()
        assert p.evaluate("paragraphModelCalls")==[]

        p.locator("#paragraph-1 .word").first.tap()
        p.locator("#word-dialog [data-sheet-handle]").tap()
        expect(ribbon).to_have_text("Нет готового перевода.")
        expect(auto).to_have_text("Перевести")
        p.wait_for_timeout(450)  # Let the read-only miss settle; no inference should start.
        assert p.evaluate("paragraphModelCalls")==[]
        p.locator("#paragraph-0 .word").first.tap()
        p.locator("#word-dialog [data-sheet-handle]").tap()
        expect(ribbon).to_contain_text(OLD)
        p.evaluate("sessionStorage.setItem('no-inference','1')")
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(ribbon).to_contain_text(OLD)
        expect(auto).to_be_hidden()
        assert p.evaluate("paragraphModelCalls")==[] and not downloads and not errors,(downloads,errors)
        print("Cold ribbon restored saved text whether inference was supported or not; neither result required a tap/model.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
