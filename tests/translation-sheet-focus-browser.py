"""Keyboard focus follows an explicit local translation without stealing focus."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

suite=runpy.run_path(str(Path(__file__).with_name("paragraph-cache-browser.py")))
serve, MODEL_MOCK, COUNT_CACHE=(suite[k] for k in ("serving","MODEL_MOCK","COUNT_CACHE"))
TEXT=b"The amber lamp was lit after the last ferry left the harbor.\n\nThe morning paper arrived with a letter."
HOLD=MODEL_MOCK.replace(
    "await new Promise(resolve=>{window.releaseParagraph=resolve;});",
    "await new Promise((resolve,reject)=>{window.finishTranslation=ok=>ok?resolve():reject(Error('download-network'));});",
)
assert HOLD != MODEL_MOCK


def run(dist, chromium):
    module=(dist/"local-translation.js").read_text("utf-8")
    adapter=module.replace("export function createLocalTranslator(","function realLocalTranslator(",1)+HOLD
    with serve(dist) as origin,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        context=browser.new_context(viewport={"width":320,"height":680},is_mobile=True,has_touch=True,
                                    reduced_motion="reduce",service_workers="block")
        model_requests=[]
        def fence(route):
            url=route.request.url
            if url==origin+"/local-translation.js":
                return route.fulfill(content_type="text/javascript",body=adapter)
            if url.startswith(origin+"/vendor/bergamot/"):
                model_requests.append(url)
                return route.abort()
            return route.continue_() if url.startswith((origin+"/","blob:","data:")) else route.abort()
        context.route("**/*",fence)
        context.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=context.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda error:errors.append(str(error)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Ferry focus.txt","mimeType":"text/plain","buffer":TEXT})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        sheet=p.locator("#translation-dialog")
        start=sheet.locator("#local-translation-start")
        handle=sheet.locator("[data-sheet-handle]")
        opener=p.locator("#translation-full")
        expect(opener).to_be_visible()
        expect(p.locator("#paragraph-0")).to_have_class("reading-paragraph active")
        opener.press("Enter")
        expect(sheet).to_be_visible()
        expect(start).to_be_enabled()

        def translate(call):
            p.evaluate("window.holdNextParagraph=true;window.finishTranslation=null")
            start.press("Enter")
            p.wait_for_function("n => paragraphModelCalls.length===n && typeof finishTranslation==='function'",arg=call)
            expect(start).to_be_focused(timeout=1200)
            expect(start).to_be_disabled()
            p.keyboard.press("Enter")
            p.keyboard.press("Space")
            assert p.evaluate("paragraphModelCalls.length")==call

        translate(1)
        p.evaluate("finishTranslation(false)")
        expect(start).to_have_text("Повторить")
        expect(start).to_be_enabled()
        expect(start).to_be_focused()
        translate(2)
        p.evaluate("finishTranslation(true)")
        result=sheet.locator(".machine-result")
        expect(result).to_contain_text("The amber lamp")
        expect(result).to_be_focused()
        expect(result).to_have_attribute("lang","ru")
        p.keyboard.press("Escape")
        expect(opener).to_be_focused()
        # Use the next paragraph, with auto paused so this is an explicit job.
        auto=p.locator("#local-translation-open")
        expect(auto).to_have_text("Пауза")
        auto.tap()
        p.locator("#paragraph-1 .word").first.tap()
        p.locator("#word-dialog [data-sheet-handle]").tap()
        expect(p.locator("#word-dialog")).to_be_hidden()
        opener.press("Enter")
        expect(sheet).to_be_visible()
        expect(start).to_be_enabled()
        translate(3)
        handle.focus()
        p.evaluate("finishTranslation(true)")
        expect(result).to_contain_text("The morning paper")
        expect(handle).to_be_focused()
        assert p.evaluate("paragraphModelCalls.length")==3
        for _ in range(25):
            if p.evaluate(COUNT_CACHE)==2:
                break
            p.wait_for_timeout(50)
        assert p.evaluate(COUNT_CACHE)==2
        assert not (model_requests or errors),(model_requests,errors)
        print("Translation: kept keyboard focus while busy and after failure; handed it to the result only when appropriate.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
