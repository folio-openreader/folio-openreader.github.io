"""Keyboard removal in a reader's contents keeps focus within the bookmark list."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("contents-current-chapter-browser.py")))
serve,epub=fixture["serve"],fixture["epub"]


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Bookmarks.epub",
            "mimeType":"application/epub+zip","buffer":epub()})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        mark=p.locator("#reader-bookmark")
        for chapter in range(1,4):
            expect(p.locator("#chapter-heading")).to_have_text(f"Section {chapter}")
            expect(mark).to_have_attribute("aria-pressed","false")
            mark.tap()
            expect(mark).to_have_attribute("aria-pressed","true")
            if chapter<3:
                p.locator("#next-chapter").tap()
        opener=p.locator("#chapter-open")
        opener.press("Enter")
        drawer=p.locator("#contents-dialog")
        expect(drawer).to_be_visible()
        marks=drawer.locator("#bookmarks-list")
        rows=marks.locator(".bookmark-row")
        expect(rows).to_have_count(3)
        chapter_list=drawer.locator("#chapter-list")
        original_scroll=chapter_list.evaluate("el=>el.scrollTop")

        rows.nth(1).locator(".icon-button").press("Enter")
        expect(rows).to_have_count(2)
        expect(rows.nth(1).locator(".chapter-row")).to_have_text("Section 3 · абзац 1")
        expect(rows.nth(1).locator(".chapter-row")).to_be_focused(timeout=1600)
        expect(rows.nth(1).locator(".icon-button")).to_have_accessible_name("Удалить закладку: Section 3 · абзац 1")

        p.keyboard.press("Tab")
        expect(rows.nth(1).locator(".icon-button")).to_be_focused()
        p.keyboard.press("Enter")
        expect(rows).to_have_count(1)
        expect(rows.first.locator(".chapter-row")).to_have_text("Section 1 · абзац 1")
        expect(rows.first.locator(".chapter-row")).to_be_focused()

        rows.first.locator(".icon-button").press("Enter")
        expect(marks.get_by_text("Сохраните абзац значком закладки.")).to_be_focused()
        expect(rows).to_have_count(0)
        assert chapter_list.evaluate("el=>el.scrollTop")==original_scroll
        expect(drawer).to_be_visible()
        p.keyboard.press("Escape")
        expect(opener).to_be_focused()
        expect(p.locator("#chapter-heading")).to_have_text("Section 3")
        assert not errors,errors
        print("Bookmark deletion follows the next/previous bookmark or empty hint without jumping chapter or losing focus.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
