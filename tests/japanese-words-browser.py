"""A tagged Japanese EPUB exposes words, not a whole sentence as one button."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT = "📚私は本を読む。明日も読む。"


def epub():
    stream = BytesIO()
    with ZipFile(stream, "w", compression=ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        z.writestr("META-INF/container.xml", """<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>""")
        z.writestr("book.opf", """<package xmlns="http://www.idpf.org/2007/opf"
            xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="edition">
          <metadata><dc:identifier id="edition">folio-ja-test</dc:identifier>
            <dc:title>Japanese fixture</dc:title><dc:language>ja</dc:language></metadata>
          <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>""")
        z.writestr("chapter.xhtml", f"""<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
          <head><title>Test</title></head><body><p>{TEXT}</p></body>
        </html>""")
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width":390,"height":844}, is_mobile=True,
                          has_touch=True, service_workers="block")
        c.route("**/*", lambda r: r.continue_() if
                r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        p = c.new_page()
        p.set_default_timeout(10000)
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files({"name":"japanese.epub",
            "mimeType":"application/epub+zip", "buffer":epub()})
        p.locator("#preview-import").click()
        expect(p.locator("#import-preview")).to_be_visible()
        p.locator("#save-import").click()
        expect(p.locator("#book-title")).to_have_text("Japanese fixture")
        row = p.locator("#paragraph-0")
        expect(row).to_have_attribute("lang","ja")
        expect(row).to_have_text(TEXT)
        words = row.locator(".word")
        expect(words.first).to_be_visible()
        actual=words.all_text_contents()
        assert actual==["私","は","本","を","読む","明日","も","読む"], actual
        assert row.locator(".word[tabindex='0']").count()==1
        target=row.get_by_role("button",name="読む",exact=True).last
        assert target.get_attribute("data-offset")=="12" # UTF-16; emoji uses two code units.
        target.tap()
        expect(p.locator("#word-sheet-heading")).to_have_text("読む")
        p.locator("#word-context-toggle").click()
        context=p.locator("#word-context .word-original")
        expect(context).to_have_text(TEXT)
        expect(context.locator("mark")).to_have_text("読む")
        assert context.locator("mark").evaluate("el => el.nextSibling.textContent")=="。"
        assert not errors, errors
        print("Tagged Japanese EPUB: 8 word controls, exact UTF-16 highlight on second repeated word, unchanged prose.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
