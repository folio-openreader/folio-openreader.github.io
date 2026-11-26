"""Deleting a book keeps keyboard focus at a surviving neighboring shelf card."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        for width, mobile in ((390,True),(1080,False)):
            c = b.new_context(viewport={"width":width,"height":844},is_mobile=mobile,has_touch=mobile,
                              reduced_motion="reduce",service_workers="block")
            c.route("**/*", lambda r: r.continue_() if
                    r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
            c.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
              readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
            p = c.new_page()
            p.set_default_timeout(6500)
            errors = []
            p.on("pageerror", lambda e: errors.append(str(e)))
            p.goto(origin+"/app.html#library")
            p.locator("#folio-boot").wait_for(state="detached")
            for label in ("Amber notes","Birch notes","Cedar notes"):
                p.locator("#import-open").click()
                p.locator("#original-file").set_input_files({"name":label+".txt","mimeType":"text/plain",
                    "buffer":b"The archive opens at dawn."})
                p.locator("#preview-import").click()
                p.locator("#save-import").click()
                expect(p.locator("#book-title")).to_have_text(label)
                p.locator("#reader-back").click()
                expect(p.locator("#library-view")).to_be_visible()
            p.locator("[data-view=home]:visible").first.press("Enter")
            shelf = p.locator("#books")
            expect(shelf.locator(".book-card")).to_have_count(4)
            modal = p.locator("#book-delete")
            remove = lambda title: shelf.get_by_role("button",name=f"Удалить книгу {title}",exact=True)

            remove("Birch notes").press("Enter")
            expect(modal).to_be_visible()
            p.keyboard.press("Escape")
            expect(modal).to_be_hidden()
            expect(remove("Birch notes")).to_be_focused()
            expect(shelf.locator(".book-card")).to_have_count(4)

            remove("Birch notes").press("Enter")
            modal.get_by_role("button",name="Удалить книгу",exact=True).press("Enter")
            expect(modal).to_be_hidden()
            expect(remove("Birch notes")).to_have_count(0)
            cedar = shelf.locator(".book-open").filter(has=p.get_by_role("heading",name="Cedar notes",exact=True))
            expect(cedar).to_be_focused()
            p.keyboard.press("Tab")
            expect(remove("Cedar notes")).to_be_focused()
            p.keyboard.press("Enter")
            modal.get_by_role("button",name="Удалить книгу",exact=True).press("Enter")
            expect(modal).to_be_hidden()
            amber = shelf.locator(".book-open").filter(has=p.get_by_role("heading",name="Amber notes",exact=True))
            expect(amber).to_be_focused()
            expect(shelf.locator(".book-card")).to_have_count(2)
            assert not errors, errors
            print(f"{width}px: Escape restored the remove button; deletion focused the next or previous surviving book.")
            c.close()
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args = parser.parse_args()
    run(args.dist.resolve(), args.chromium)
