"""Bound the translation ribbon after importing a long paired EPUB."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZipFile, ZIP_STORED
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
CHAPTERS, ROWS = 14, 160


def epub(paired):
    stream = BytesIO()
    label = "Translated" if paired else "Original"
    with ZipFile(stream, "w", ZIP_STORED) as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml", """<container
          xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
          <rootfiles><rootfile media-type="application/oebps-package+xml"
          full-path="EPUB/book.opf"/></rootfiles></container>""")
        manifest = "".join(f'<item id="chapter{i}" href="ch{i}.xhtml" media-type="application/xhtml+xml"/>'
                           for i in range(1, CHAPTERS + 1))
        spine = "".join(f'<itemref idref="chapter{i}"/>' for i in range(1, CHAPTERS + 1))
        z.writestr("EPUB/book.opf", f"""<package xmlns="http://www.idpf.org/2007/opf" version="3.0"
          unique-identifier="book-id" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <metadata><dc:identifier id="book-id">fixture</dc:identifier>
          <dc:title>{label} large test book</dc:title><dc:language>en</dc:language></metadata>
          <manifest>{manifest}</manifest><spine>{spine}</spine></package>""")
        for chapter in range(1, CHAPTERS + 1):
            rows = "".join(f'<p>{label} chapter {chapter}, paragraph {i}. The river runs near the old town.</p>'
                           for i in range(1, ROWS + 1))
            z.writestr(f"EPUB/ch{chapter}.xhtml", f"""<html xmlns="http://www.w3.org/1999/xhtml">
                       <head><title>Chapter {chapter}</title></head><body>{rows}</body></html>""")
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=chromium, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                      service_workers="block")
        context.route("**/*", lambda route: route.continue_()
                      if route.request.url.startswith((origin + "/", "blob:", "data:")) else route.abort())
        page = context.new_page()
        page.set_default_timeout(10000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(origin + "/app.html#library")
        page.locator("#folio-boot").wait_for(state="detached")
        page.locator("[data-lang-continue]").first.click()
        page.locator("#import-open").click()
        for role in ("original", "translation"):
            page.locator("#" + role + "-file").set_input_files({"name": role + ".epub",
                "mimeType": "application/epub+zip", "buffer": epub(role == "translation")})
        page.locator("#preview-import").click()
        page.locator("#alignment-check").check()
        page.locator("#save-import").click()
        ribbon = page.locator("#translation-ribbon")
        segments = ribbon.locator(".translation-segment")
        expect(page.locator("#translation-0-0.current")).to_contain_text("Translated chapter 1, paragraph 1.")
        assert segments.count() == ROWS, f"initial ribbon mounted {segments.count()} vs expected {ROWS}"
        ribbon.press("End")
        assert ribbon.evaluate("n => n.scrollLeft") > 500
        ribbon.press("Home")
        assert ribbon.evaluate("n => n.scrollLeft") <= 2
        page.locator("#chapter-open").click()
        page.locator("#chapter-list .chapter-row").nth(7).click()
        expect(page.locator("#translation-7-0.current")).to_contain_text("Translated chapter 8, paragraph 1.")
        assert segments.count() == ROWS
        assert page.locator("#translation-0-0").count() == 0
        page.reload()
        page.locator("#folio-boot").wait_for(state="detached")
        expect(page.locator("#translation-7-0.current")).to_contain_text("Translated chapter 8, paragraph 1.")
        assert segments.count() == ROWS
        assert not errors, errors
        print(f"{ROWS} of {CHAPTERS * ROWS} segments mounted; checked chapter jump, scroll Home/End and reload")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
