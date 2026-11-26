"""Keyboard selection of a saved bookmark leads to the saved paragraph."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT="\n\n".join(f"Passage {i}. The lighthouse keeper watched the quiet sea while another ferry slowly crossed the harbor, carrying travellers to the city." for i in range(1,35))
MEASURE="""() => {
  const sc=document.querySelector('#reading-scroll'),target=document.querySelector('#paragraph-14');
  return target.getBoundingClientRect().top-sc.getBoundingClientRect().top;
}"""


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=chromium,args=["--disable-dev-shm-usage"])
        ctx=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                                reduced_motion="reduce",service_workers="block")
        ctx.route("**/*",lambda r: r.continue_() if
                  r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
           readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=ctx.new_page()
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Bookmark focus.txt","mimeType":"text/plain","buffer":TEXT.encode()})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        target=p.locator("#paragraph-14")
        expect(target).to_be_attached()
        p.evaluate("""() => {
          const sc=document.querySelector('#reading-scroll'), row=document.querySelector('#paragraph-14');
          sc.scrollTop+=row.getBoundingClientRect().top-sc.getBoundingClientRect().top-20;
        }""")
        expect(target).to_have_class("reading-paragraph active")
        p.locator("#reader-bookmark").tap()
        expect(p.locator("#reader-bookmark")).to_have_attribute("aria-pressed","true")
        baseline=p.evaluate(MEASURE)
        p.evaluate("document.querySelector('#reading-scroll').scrollTop=0")
        expect(p.locator("#paragraph-0")).to_have_class("reading-paragraph active")
        p.locator("#chapter-open").press("Enter")
        contents=p.locator("#contents-dialog")
        jump=contents.locator(".bookmark-row .chapter-row")
        expect(jump).to_contain_text("абзац 15")
        jump.press("Enter")
        expect(contents).to_be_hidden()
        expect(target).to_be_focused(timeout=1600)
        expect(target).to_have_class("reading-paragraph active")
        assert abs(p.evaluate(MEASURE)-baseline) < 2,(baseline,p.evaluate(MEASURE))
        expect(target.locator('.word[tabindex="0"]')).to_be_visible()
        p.keyboard.press("Tab")
        expect(target.locator('.word[tabindex="0"]')).to_be_focused()

        p.locator("#chapter-open").tap()
        jump.tap()
        expect(contents).to_be_hidden()
        expect(target).not_to_be_focused()
        expect(target).to_have_class("reading-paragraph active")
        assert abs(p.evaluate(MEASURE)-baseline) < 2
        assert not errors,errors
        print("Keyboard bookmark jump moved focus to the exact saved paragraph without shifting its position; the next Tab reached its first word.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
