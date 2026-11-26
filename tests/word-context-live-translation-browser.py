"""An open word context reflects a completed paragraph translation without reopening."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

suite=runpy.run_path(str(Path(__file__).with_name("paragraph-cache-browser.py")))
serve, MODEL_MOCK=(suite[k] for k in ("serving","MODEL_MOCK"))
TEXT=b"The amber lamp was lit after the last ferry.\n\nThe morning paper arrived with a letter."


def run(dist, chromium):
    mod=(dist/"local-translation.js").read_text("utf-8")
    adapter=mod.replace("export function createLocalTranslator(","function realLocalTranslator(",1)+MODEL_MOCK
    with serve(dist) as origin,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                              reduced_motion="reduce",service_workers="block")
        def fence(r):
            if r.request.url==origin+"/local-translation.js":
                return r.fulfill(content_type="text/javascript",body=adapter)
            return r.continue_() if r.request.url.startswith((origin+"/","blob:","data:")) else r.abort()
        c.route("**/*",fence)
        c.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Context fixture.txt",
            "mimeType":"text/plain","buffer":TEXT})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        word=p.locator("#word-dialog")
        panel=word.locator("#word-context")
        translation=p.locator("#translation-dialog")
        start=translation.locator("#local-translation-start")
        translate=panel.get_by_role("button",name="Перевести абзац",exact=True)
        result=panel.locator(".word-parallel")

        def context(index, term):
            p.locator(f"#paragraph-{index}").get_by_role("button",name=term,exact=True).tap()
            expect(word).to_be_visible()
            word.locator("#word-context-toggle").tap()
            expect(translate).to_be_visible()
            translate.press("Enter")
            expect(translation).to_be_visible()
            expect(start).to_be_enabled()

        context(0,"lamp")
        start.press("Enter")
        expect(translation.locator(".machine-result")).to_contain_text("The amber lamp")
        p.keyboard.press("Escape")
        expect(translation).to_be_hidden()
        expect(word).to_be_visible()
        expect(result).to_contain_text("The amber lamp",timeout=1600)
        expect(result).to_have_attribute("lang","ru")
        expect(translate).to_have_count(0)
        expect(result).to_be_focused()
        assert p.evaluate("paragraphModelCalls.length")==1

        p.keyboard.press("Escape")
        expect(word).to_be_hidden()
        auto=p.locator("#local-translation-open")
        expect(auto).to_have_text("Пауза")
        auto.tap()
        context(1,"paper")
        p.evaluate("window.holdNextParagraph=true;window.releaseParagraph=null")
        start.press("Enter")
        p.wait_for_function("typeof releaseParagraph==='function'")
        p.keyboard.press("Escape")
        expect(translation).to_be_hidden()
        expect(translate).to_be_focused()
        p.evaluate("releaseParagraph()")
        expect(result).to_contain_text("The morning paper")
        expect(result).to_be_focused()
        assert p.evaluate("paragraphModelCalls.length")==2
        assert not errors,errors
        print("Word context updates once with the matching result both after nested close and after background completion; keyboard focus follows only its replaced button.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
