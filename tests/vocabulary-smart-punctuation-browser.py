"""Pasting a book's typography into Folio search matches the saved spelling."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT = "Don’t forget the long‑term plan or the lan\u00adtern."


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
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files({"name":"smart.txt","mimeType":"text/plain",
            "buffer":TEXT.encode("utf-8")})
        p.locator("#preview-import").click()
        expect(p.locator("#import-preview")).to_be_visible()
        p.locator("#save-import").click()
        for word in ["Don’t", "long‑term", "lan\u00adtern"]:
            p.locator("#paragraph-0").get_by_role("button",name=word,exact=True).tap()
            expect(p.locator("#word-save")).to_have_attribute("aria-pressed","true")
            p.keyboard.press("Escape")
            expect(p.locator("#word-dialog")).to_be_hidden()
        p.locator("#reader-back").tap()
        p.locator("[data-view=words]:visible").first.tap()
        rows = p.locator("#saved-list .saved-row strong")
        expect(rows).to_have_count(3)
        p.locator("#word-search-toggle").tap()
        search = p.locator("#word-search")
        for query,want in [("don't","don't"),("DON’T","don't"),("long‑term","long-term"),
                           ("lan\u00adtern","lantern"),("фонарь","lantern")]:
            search.fill(query)
            expect(rows).to_have_text([want], timeout=1800)
        search.fill("long—term")  # A real em dash is punctuation, not an in-word hyphen.
        expect(rows).to_have_count(0)

        p.locator("[data-view=practice]:visible").first.tap()
        p.locator("#lesson-choose").tap()
        lesson_search=p.locator("#lesson-search")
        lesson_search.fill("don’t")
        expect(p.locator("#lesson-options input")).to_have_count(1)
        expect(p.locator("#lesson-options input")).to_have_attribute("value", "en:don't")
        assert not errors, errors
        print("Smart apostrophes, nonbreaking/discretionary hyphens and legacy gloss query pass in actual Folio search")
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
