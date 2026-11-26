"""Every OCR transcript word is available without a Tab stop per word."""
from argparse import ArgumentParser
from pathlib import Path
import json
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
panel_image = runpy.run_path(str(Path(__file__).with_name("comic-nav-focus-browser.py")))["panel"]
TEXT = [
    "amber lantern beside the harbor " + "many quiet waves drift toward the shore " * 4 + "at dusk",
    "another letter arrived with the morning paper",
    "لغة عربية بسيطة تقرأ من اليمين إلى اليسار",
]
PARAGRAPHS = json.dumps([{"text": line.strip()} for line in TEXT], ensure_ascii=False)
OCR = """export async function recognizeComicPage(){return {paragraphs:""" + PARAGRAPHS + """,words:[
  {text:'amber',paragraphIndex:0,offset:0,x:.1,y:.1,w:.18,h:.1},
  {text:'lantern',paragraphIndex:0,offset:6,x:.35,y:.1,w:.24,h:.1}
]};}"""


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                                      reduced_motion="reduce", service_workers="block")
        def route(r):
            if r.request.url == origin + "/comic-ocr.js":
                return r.fulfill(content_type="text/javascript", body=OCR)
            if r.request.url.startswith((origin + "/", "blob:", "data:")):
                return r.continue_()
            return r.abort()
        context.route("**/*", route)
        context.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        page = context.new_page()
        page.set_default_timeout(6500)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(origin + "/app.html#library")
        page.locator("#folio-boot").wait_for(state="detached")
        page.locator("#comic-import-open").tap()
        page.locator("#comic-files").set_input_files(
            {"name":"01.png", "mimeType":"image/png", "buffer":panel_image(1)})
        page.locator("#comic-import-start").tap()
        expect(page.locator(".comic-art")).to_have_attribute("alt","Страница 1")
        page.locator(".comic-scan").tap()
        toggle = page.locator(".comic-text-toggle")
        expect(toggle).to_be_visible()
        toggle.tap()
        expect(toggle).to_have_attribute("aria-expanded","true")
        transcript = page.locator(".comic-transcript")
        expect(transcript).to_have_accessible_description(
            "Tab переходит между абзацами. Стрелки влево и вправо выбирают слово, Enter открывает словарь.")
        words = transcript.locator("button.comic-token")
        total = words.count()
        assert total > 45, total
        rows = transcript.locator("p[data-paragraph]")
        tabs = transcript.locator('button.comic-token:not([tabindex="-1"])')
        assert tabs.count() == 3, f"{tabs.count()} tab stops for {total} words, expected 3"
        first = rows.nth(0).locator(".comic-token").first
        lantern = rows.nth(0).locator(".comic-token").nth(1)
        next_row = rows.nth(1).locator(".comic-token").first
        arabic = rows.nth(2).locator(".comic-token")
        first.focus()
        page.keyboard.press("ArrowRight")
        expect(lantern).to_be_focused()
        page.keyboard.press("Enter")
        expect(page.locator("#word-sheet-heading")).to_have_text("lantern")
        page.keyboard.press("Escape")
        expect(lantern).to_be_focused()
        page.keyboard.press("End")
        expect(rows.nth(0).locator(".comic-token").last).to_be_focused()
        page.keyboard.press("Home")
        expect(first).to_be_focused()
        page.keyboard.press("Tab")
        expect(next_row).to_be_focused()
        page.keyboard.press("Tab")
        expect(arabic.first).to_be_focused()
        page.keyboard.press("ArrowLeft")
        expect(arabic.nth(1)).to_be_focused()
        page.keyboard.press("Shift+Tab")
        expect(next_row).to_be_focused()
        direct_tap = rows.nth(1).get_by_role("button",name="paper",exact=True)
        direct_tap.tap()
        expect(page.locator("#word-sheet-heading")).to_have_text("paper")
        page.keyboard.press("Escape")
        expect(direct_tap).to_be_focused()
        expect(direct_tap).to_have_attribute("tabindex","0")
        assert tabs.count() == 3
        hotspots = page.locator(".comic-overlay button.comic-hotspot")
        expect(hotspots).to_have_count(2)
        hotspots.first.focus()
        page.keyboard.press("ArrowRight")
        expect(hotspots.last).to_be_focused()
        expect(hotspots.last).to_have_attribute("tabindex","0")
        page.keyboard.press("Home")
        expect(hotspots.first).to_be_focused()
        assert not errors, errors
        print(f"OCR transcript: {total} words; 3 Tab stops; RTL, arrows, Home/End, touch, dictionary return and image buttons passed.")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    args = parser.parse_args()
    run(args.dist.resolve(), args.chromium)
