"""On a small screen the translation action and result precede a long source."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

suite = runpy.run_path(str(Path(__file__).with_name("paragraph-cache-browser.py")))
serve, MODEL_MOCK = (suite[k] for k in ("serving", "MODEL_MOCK"))
TEXT = " ".join(["The ferry crossed the harbor before the watchman lit the first lamp."] * 32)
CLICK_TARGET_IN_SHEET = """button=>{
  const sheet=button.closest('dialog').getBoundingClientRect(),r=button.getBoundingClientRect(),
    h=window.visualViewport?.height||window.innerHeight;
  return {top:r.top,bottom:r.bottom,clipTop:Math.max(0,sheet.top),clipBottom:Math.min(h,sheet.bottom)};
}"""
FIRST_RESULT_LINE = """el=>{
  const range=document.createRange(),text=el.firstChild;
  range.setStart(text,0);range.setEnd(text,Math.min(12,text.length));
  const r=range.getBoundingClientRect(),sheet=el.closest('dialog').getBoundingClientRect();
  return {top:r.top,bottom:r.bottom,clipTop:Math.max(sheet.top,0),
    clipBottom:Math.min(sheet.bottom,window.visualViewport?.height||window.innerHeight)};
}"""


def assert_in_sheet(locator, geometry, description):
    rect=locator.evaluate(geometry)
    assert rect["clipTop"] <= rect["top"] < rect["bottom"] <= rect["clipBottom"], (description,rect)


def run(dist, chromium):
    module=(dist/"local-translation.js").read_text("utf-8")
    adapter=module.replace("export function createLocalTranslator(","function realLocalTranslator(",1)+MODEL_MOCK
    with serve(dist) as origin,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        context=browser.new_context(viewport={"width":320,"height":640},is_mobile=True,has_touch=True,
                                    reduced_motion="reduce",service_workers="block")
        requests=[]
        def fence(route):
            url=route.request.url
            if url==origin+"/local-translation.js":
                return route.fulfill(content_type="text/javascript; charset=utf-8",body=adapter)
            if url.startswith(origin+"/vendor/bergamot/"):
                requests.append(url)
                return route.abort()
            if url.startswith((origin+"/","blob:","data:")):
                return route.continue_()
            return route.abort()
        context.route("**/*",fence)
        context.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        page=context.new_page()
        page.set_default_timeout(6500)
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.goto(origin+"/app.html#library")
        page.locator("#folio-boot").wait_for(state="detached")
        page.locator("#import-open").tap()
        page.locator("#original-file").set_input_files({"name":"Long paragraph.txt",
            "mimeType":"text/plain","buffer":TEXT.encode()})
        page.locator("#preview-import").tap()
        page.locator("#save-import").tap()
        reader_open=page.locator("#translation-full")
        reader_open.tap()
        sheet=page.locator("#translation-dialog")
        expect(sheet).to_be_visible()
        button=sheet.locator("#local-translation-start")
        expect(button).to_be_enabled()
        assert page.evaluate("paragraphModelCalls") == [], "Opening a sheet cannot request inference"
        assert_in_sheet(button,CLICK_TARGET_IN_SHEET,"Translate action without scrolling")

        page.evaluate("window.holdNextParagraph=true")
        button.tap()
        expect(sheet.locator("#local-translation-status")).to_have_text("Переводим на устройстве…")
        expect(button).to_be_disabled()
        page.wait_for_function("typeof releaseParagraph==='function'")
        page.evaluate("releaseParagraph()")
        result=sheet.locator(".machine-result")
        expect(result).to_have_text("Синтетический перевод: "+TEXT)
        expect(result).to_have_attribute("lang","ru")
        assert_in_sheet(result,FIRST_RESULT_LINE,"First line of the translation without scrolling")
        source=sheet.locator(".source-text")
        expect(source).to_have_text(TEXT)
        expect(source).to_have_attribute("lang","en")
        assert source.bounding_box()["y"] > result.bounding_box()["y"]
        source.scroll_into_view_if_needed()
        expect(source).to_be_in_viewport()
        page.keyboard.press("Escape")
        expect(sheet).to_be_hidden()
        expect(reader_open).to_be_focused()
        assert len(page.evaluate("paragraphModelCalls")) == 1 and not requests and not errors,(requests,errors)
        print("320x640: action, loading and result are visible without scrolling past the long original; it remains readable below.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
