"""Table cells in an imported EPUB must remain separate words in the text reader."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def epub():
    stream = BytesIO()
    with ZipFile(stream, "w", compression=ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        z.writestr("META-INF/container.xml", """<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>""")
        z.writestr("book.opf", """<package xmlns="http://www.idpf.org/2007/opf"
            xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="edition">
          <metadata><dc:identifier id="edition">folio-tables</dc:identifier>
            <dc:title>Field guide fixture</dc:title><dc:language>en</dc:language></metadata>
          <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="c1"/></spine>
        </package>""")
        z.writestr("c1.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml">
          <head><title>The schedule</title></head><body><h1>The schedule</h1>
          <table><thead><tr><th>Place</th><th>Departure</th><th>Time</th></tr></thead>
          <tbody><tr><th>Old port</th><td><em>Ferry</em></td><td>08:30</td></tr>
          <tr><th>Green pier</th><td></td><td>09:05</td></tr>
          <tr><th colspan="2">Low tide</th><td hidden="hidden">ignore this</td><td>11:15</td></tr></tbody></table>
          <p>Look for the after<em>noon</em> lantern.</p></body></html>""")
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                          reduced_motion="reduce",service_workers="block")
        c.route("**/*", lambda r: r.continue_() if
                r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',
          JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p = c.new_page()
        p.set_default_timeout(6500)
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files({"name":"table.epub",
            "mimeType":"application/epub+zip","buffer":epub()})
        p.locator("#preview-import").click()
        expect(p.locator("#import-preview")).to_be_visible()
        p.locator("#save-import").click()
        expect(p.locator("#book-title")).to_have_text("Field guide fixture")
        expect(p.locator("#passage .reading-paragraph")).to_have_text([
            "Place Departure Time", "Old port Ferry 08:30", "Green pier 09:05",
            "Low tide 11:15", "Look for the afternoon lantern."
        ], timeout=1800)
        ferry = p.locator("#paragraph-1").get_by_role("button",name="Ferry",exact=True)
        ferry.tap()
        expect(p.locator("#word-sheet-heading")).to_have_text("Ferry")
        assert not errors, errors
        print("EPUB table headers/values retain cell spacing and separate lookup, while inline prose stays intact")
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
