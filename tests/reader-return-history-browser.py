"""The reader's Back preserves forward history for a book opened in Folio."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
ID = "starter-squirrel-nutkin"


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True,
                                     args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                                  reduced_motion="reduce", service_workers="block")
        ctx.route("**/*", lambda r: r.continue_() if
                  r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        ctx.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
            JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        errors = []

        def app(hash):
            p = ctx.new_page()
            p.set_default_timeout(6500)
            p.on("pageerror", lambda e: errors.append(str(e)))
            p.goto(origin + "/app.html" + hash)
            p.locator("#folio-boot").wait_for(state="detached")
            return p

        page = app("#home")
        page.locator("[data-view=library]:visible").first.press("Enter")
        expect(page.locator("#library-view")).to_be_visible()
        book = page.locator(f'[data-starter-book="{ID}"]')
        book.press("Enter")
        expect(page.locator("#book-title")).to_have_text("The Tale of Squirrel Nutkin")
        expect(page.locator("#reading-scroll")).to_be_focused()
        reader_url = origin + f"/app.html#read/{ID}"

        page.locator("#reader-back").press("Enter")
        expect(page.locator("#library-view")).to_be_visible()
        expect(page).to_have_url(origin + "/app.html#library")
        expect(book).to_be_focused()
        page.evaluate("history.forward()")
        expect(page).to_have_url(reader_url,timeout=1700)
        expect(page.locator("#reader")).to_be_visible()
        expect(page.locator("#book-title")).to_have_text("The Tale of Squirrel Nutkin")

        page.locator("#reader-back").tap()
        expect(page.locator("#library-view")).to_be_visible()
        expect(page).to_have_url(origin + "/app.html#library")
        page.evaluate("history.back()")
        expect(page.locator("#home-view")).to_be_visible()
        expect(page).to_have_url(origin + "/app.html#home")

        # A fresh reader link has no in-app parent. Its Back stays in Folio,
        # and must not jump into the browser's earlier unrelated history.
        direct = app("#read/" + ID)
        expect(direct.locator("#book-title")).to_have_text("The Tale of Squirrel Nutkin")
        direct.locator("#reader-back").tap()
        expect(direct.locator("#home-view")).to_be_visible()
        expect(direct).to_have_url(origin + "/app.html#home")

        assert not errors, errors
        print("Reader Back kept its forward entry, restored keyboard focus, skipped duplicate shelf history and kept direct links in Folio.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
