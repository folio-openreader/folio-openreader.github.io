"""Browser history Back dismisses Folio's reader-only modal sheets."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                          reduced_motion="reduce", service_workers="block")
        c.route("**/*", lambda r: r.continue_() if
                r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
          JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p = c.new_page()
        p.set_default_timeout(6500)
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#home")
        p.locator("#folio-boot").wait_for(state="detached")
        for trigger, visible in [
            ("#reader-prefs", "#preferences"), ("#chapter-open", "#contents-dialog"),
            ("#translation-full", "#translation-dialog"), ("#paragraph-0 .word:first-child", "#word-dialog")]:
            p.locator("#continue-card button").tap()
            expect(p.locator("#reader")).to_be_visible()
            p.locator(trigger).first.tap()
            expect(p.locator(visible)).to_be_visible()
            p.evaluate("history.back()")
            expect(p.locator("#reader")).to_be_hidden()
            expect(p.locator(visible)).to_be_hidden(timeout=1600)
            expect(p.locator("dialog[open]")).to_have_count(0)
            expect(p.locator("#continue-card button")).to_contain_text("The Night Ferry")
        assert not errors, errors
        print("Mobile history Back closes reader preferences, contents, paragraph translation and word sheet; Continue works")
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
