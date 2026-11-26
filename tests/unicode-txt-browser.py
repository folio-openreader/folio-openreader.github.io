"""Local browser smoke: Unicode TXT books from a Windows/Unicode editor."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import sync_playwright, expect

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
ORIGINAL = "Таң атты. 🌅\r\n\r\nБіз кітап оқимыз."
TRANSLATED = "Dawn broke. 🌅\r\rWe are reading a book."


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as p:
        b = p.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                has_touch=True, service_workers="block")
        c.route("**/*", lambda route: route.continue_()
                if route.request.url.startswith((origin + "/", "blob:", "data:")) else route.abort())
        page = c.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_default_timeout(8000)
        page.goto(origin + "/app.html#library")
        page.locator("#folio-boot").wait_for(state="detached")
        page.locator("[data-lang-continue]").first.click()
        page.locator("#import-open").click()
        page.locator("#original-file").set_input_files({"name": "Таң.txt", "mimeType": "text/plain",
                                            "buffer": b"\xff\xfe" + ORIGINAL.encode("utf-16le")})
        page.locator("#translation-file").set_input_files({"name": "Dawn.txt", "mimeType": "text/plain",
                                            "buffer": b"\xfe\xff" + TRANSLATED.encode("utf-16be")})
        page.locator("#preview-import").click()
        samples = page.locator("#import-preview .preview-pair")
        expect(samples).to_have_count(2)
        expect(samples.first).to_contain_text("Таң атты. 🌅")
        expect(samples.first).to_contain_text("Dawn broke. 🌅")
        expect(samples.nth(1)).to_contain_text("We are reading a book.")
        page.locator("#alignment-check").check()
        page.locator("#save-import").click()
        expect(page.locator("#book-title")).to_have_text("Таң")
        expect(page.locator("#paragraph-1")).to_have_text("Біз кітап оқимыз.")
        expect(page.locator("#translation-0-0.current")).to_contain_text("Dawn broke. 🌅")
        assert not errors, errors
        print("UTF-16LE source + UTF-16BE translation imported, rendered and aligned")
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
