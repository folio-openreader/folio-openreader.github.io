"""A mobile/desktop table of contents opens at the current chapter of a real EPUB."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def epub():
    stream = BytesIO()
    sections = range(1, 65)
    manifest = ''.join(f'<item id="c{i}" href="{i}.xhtml" media-type="application/xhtml+xml"/>' for i in sections)
    spine = ''.join(f'<itemref idref="c{i}"/>' for i in sections)
    with ZipFile(stream, "w", compression=ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        z.writestr("META-INF/container.xml", """<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>""")
        z.writestr("book.opf", f"""<package xmlns="http://www.idpf.org/2007/opf"
            xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="edition">
          <metadata><dc:identifier id="edition">folio-contents</dc:identifier>
            <dc:title>Long contents fixture</dc:title><dc:language>en</dc:language></metadata>
          <manifest>{manifest}</manifest><spine>{spine}</spine>
        </package>""")
        for i in sections:
            z.writestr(f"{i}.xhtml", f"""<html xmlns="http://www.w3.org/1999/xhtml">
              <head><title>Section {i}</title></head><body><h1>Section {i}</h1>
              <p>There is a short passage in section {i}. Watch the river from the shore.</p></body></html>""")
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        for mobile, viewport in [(True, {"width":390,"height":844}), (False, {"width":1200,"height":780})]:
            c = b.new_context(viewport=viewport, is_mobile=mobile, has_touch=mobile,
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
            p.locator("#original-file").set_input_files({"name":"contents.epub",
                "mimeType":"application/epub+zip","buffer":epub()})
            p.locator("#preview-import").click()
            expect(p.locator("#import-preview")).to_be_visible()
            p.locator("#save-import").click()
            expect(p.locator("#book-title")).to_have_text("Long contents fixture")
            opener = p.locator("#chapter-open")
            drawer = p.locator("#contents-dialog")
            rows = drawer.locator("#chapter-list button")
            opener.click()
            expect(rows).to_have_count(64)
            rows.nth(54).click()
            expect(p.locator("#chapter-heading")).to_have_text("Section 55")
            p.locator("#reader-bookmark").click()
            opener.tap() if mobile else opener.press("Enter")
            expect(drawer).to_be_visible()
            current = rows.nth(54)
            expect(current).to_have_text("55. Section 55")
            expect(current).to_be_in_viewport(timeout=1500)
            expect(current).to_have_attribute("aria-current", "location")
            expect(drawer.locator('[aria-current="location"]')).to_have_count(1)
            expect(current).to_be_focused()
            expect(drawer.get_by_role("heading",name="Оглавление")).to_be_in_viewport()
            expect(drawer.get_by_role("heading",name="Закладки")).to_be_in_viewport()
            list_scroll = drawer.locator("#chapter-list").evaluate("el=>el.scrollTop")
            assert list_scroll > 1000
            expect(drawer.locator("#bookmarks-list .chapter-row")).to_contain_text("Section 55")
            drawer.locator("#bookmarks-list .icon-button").click()
            expect(drawer.locator("#bookmarks-list .chapter-row")).to_have_count(0)
            assert drawer.locator("#chapter-list").evaluate("el=>el.scrollTop") == list_scroll

            p.keyboard.press("Escape")
            expect(drawer).to_be_hidden()
            expect(opener).to_be_focused()
            opener.press("Enter")
            expect(current).to_be_focused()
            p.keyboard.press("Tab")
            expect(rows.nth(55)).to_be_focused()
            p.keyboard.press("Enter")
            expect(p.locator("#chapter-heading")).to_have_text("Section 56")
            expect(p.locator("#chapter-heading")).to_be_focused()
            assert not errors, errors
            print(("mobile" if mobile else "desktop") + ": current chapter visible, keyboard selection/escape correct")
            c.close()
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
