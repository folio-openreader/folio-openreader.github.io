"""Verify keyboard access to every word without tabbing through all words."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT = ("The amber lighthouse watched the harbor while the ferry turned to port.\n\n"
        "Another sailor waited silently along the pier for a long time.\n\n"
        "لغة عربية بسيطة تقرأ من اليمين إلى اليسار")


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                                      service_workers="block")
        context.route("**/*", lambda r: r.continue_()
                      if r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        p = context.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files({"name": "Keyboard fixture.txt",
            "mimeType": "text/plain", "buffer": TEXT.encode("utf-8")})
        p.locator("#preview-import").click()
        p.locator("#save-import").click()
        words = p.locator("#passage button[data-word]")
        expect(words.first).to_be_visible()
        expect(p.locator("#paragraph-2 button[data-word]").first).to_be_attached()
        assert words.count() > 18
        tabs = p.locator("#passage button[data-word]:not([tabindex='-1'])")
        assert tabs.count() == 3, f"{tabs.count()} consecutive Tab stops for three paragraphs"
        first = p.locator("#paragraph-0 [data-word]").first
        next_word = p.locator("#paragraph-0 [data-word]").nth(1)
        next_row = p.locator("#paragraph-1 [data-word]").first
        first.focus()
        p.keyboard.press("ArrowRight")
        expect(next_word).to_be_focused()
        p.keyboard.press("Enter")
        dialog = p.locator("#word-dialog")
        expect(dialog).to_be_visible()
        expect(p.locator("#word-sheet-heading")).to_have_text("amber")
        p.keyboard.press("Escape")
        expect(next_word).to_be_focused()
        p.keyboard.press("Tab")
        expect(next_row).to_be_focused()
        p.keyboard.press("End")
        expect(p.locator("#paragraph-1 [data-word]").last).to_be_focused()
        p.keyboard.press("Home")
        expect(next_row).to_be_focused()
        p.keyboard.press("Tab")
        expect(p.locator("#paragraph-2 [data-word]").first).to_be_focused()
        p.keyboard.press("ArrowLeft")
        expect(p.locator("#paragraph-2 [data-word]").nth(1)).to_be_focused()
        harbor = p.locator('#paragraph-0 [data-word="harbor"]')
        harbor.click()
        expect(p.locator("#word-sheet-heading")).to_have_text("harbor")
        p.keyboard.press("Escape")
        expect(harbor).to_be_focused()
        expect(harbor).to_have_attribute("tabindex", "0")
        assert not errors, errors
        print(f"{words.count()} words, {tabs.count()} tab stops; arrows, Enter, escape return, Home/End and RTL passed.")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
