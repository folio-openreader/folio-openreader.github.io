"""Keep keyboard focus with comic OCR through loading, success or retry."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
panel = runpy.run_path(str(Path(__file__).with_name("comic-nav-focus-browser.py")))["panel"]
OCR = """
export function recognizeComicPage(){
  const calls=window.folioOcrTest??=[];
  return new Promise((resolve,reject)=>calls.push(mode=>{
    if(mode==='error')return reject(new Error('synthetic OCR error'));
    resolve({paragraphs:mode==='empty'?[]:[{text:'amber lantern'}],
      words:mode==='marks'?[{text:'amber',paragraphIndex:0,offset:0,x:.1,y:.1,w:.2,h:.12}]:[]});
  }));
}
"""


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                                      reduced_motion="reduce",service_workers="block")
        def route(r):
            if r.request.url == origin + "/comic-ocr.js":
                return r.fulfill(content_type="text/javascript",body=OCR)
            return r.continue_() if r.request.url.startswith((origin+"/","blob:","data:")) else r.abort()
        context.route("**/*",route)
        context.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p = context.new_page()
        errors = []
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#comic-import-open").tap()
        p.locator("#comic-files").set_input_files(
            [{"name":f"0{i}.png","mimeType":"image/png","buffer":panel(i)} for i in range(1,5)])
        p.locator("#comic-import-start").tap()
        art, scan, next_page, toggle, language = (
            p.locator(s) for s in [".comic-art",".comic-scan",".comic-next",".comic-text-toggle",".comic-language"])
        expect(art).to_have_attribute("alt","Страница 1")

        def start(number):
            scan.press("Enter")
            p.wait_for_function("n => window.folioOcrTest?.length === n",arg=number)
            expect(scan).to_be_focused(timeout=1200)
            expect(scan).to_be_disabled()
            p.keyboard.press("Enter")
            p.keyboard.press("Space")
            assert p.evaluate("window.folioOcrTest.length")==number

        def finish(number,mode):
            p.evaluate("([number,mode]) => window.folioOcrTest[number-1](mode)",[number,mode])

        start(1)
        finish(1,"marks")
        expect(scan).to_have_attribute("aria-pressed","true")
        expect(scan).to_be_focused()
        expect(scan).to_be_enabled()
        p.keyboard.press("Enter")
        expect(scan).to_have_attribute("aria-pressed","false")
        assert p.evaluate("window.folioOcrTest.length")==1
        next_page.press("Enter")
        expect(art).to_have_attribute("alt","Страница 2")

        start(2)
        finish(2,"text")
        expect(scan).to_be_hidden()
        expect(toggle).to_be_focused()
        p.keyboard.press("Enter")
        expect(p.locator(".comic-transcript")).to_contain_text("amber lantern")
        next_page.press("Enter")
        expect(art).to_have_attribute("alt","Страница 3")

        start(3)
        finish(3,"error")
        expect(scan).to_have_accessible_name("Повторить распознавание слов")
        expect(scan).to_be_focused()
        expect(scan).to_be_enabled()
        start(4)
        finish(4,"empty")
        expect(p.locator(".comic-note")).to_have_text("На этой странице слова не распознаны.")
        expect(scan).to_be_focused()
        expect(scan).to_be_enabled()
        next_page.press("Enter")
        expect(art).to_have_attribute("alt","Страница 4")

        start(5)
        # A reader can move away while OCR runs; completion must not pull them back.
        p.keyboard.press("Shift+Tab")
        previous = p.locator(".comic-prev")
        expect(previous).to_be_focused()
        finish(5,"text")
        expect(toggle).to_be_visible()
        expect(previous).to_be_focused()
        expect(language).to_be_enabled()
        assert not errors,errors
        print("Comic OCR: loading retained focus; repeated keys did not restart; image words, text-only, error and empty outcomes kept keyboard flow; moving away did not steal focus.")
        browser.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
