"""Keep EPUB ruby base words intact in Folio's plain-text reader."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def epub():
    stream = BytesIO()
    with ZipFile(stream, "w", compression=ZIP_DEFLATED) as book:
        book.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        book.writestr("META-INF/container.xml", """<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>""")
        book.writestr("book.opf", """<package xmlns="http://www.idpf.org/2007/opf"
            xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="edition">
          <metadata><dc:identifier id="edition">folio-ruby</dc:identifier>
            <dc:title>Ruby reading fixture</dc:title><dc:language>ja</dc:language></metadata>
          <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="c1"/></spine>
        </package>""")
        book.writestr("c1.xhtml", """<html xmlns="http://www.w3.org/1999/xhtml">
          <head><title>新しい旅</title></head><body>
          <h1><ruby>新<rt>あたら</rt></ruby>しい旅</h1>
          <p>今日、<ruby>東京<rp>（</rp><rt>とうきょう</rt><rp>）</rp></ruby>へ行く。</p>
          <p><ruby><rb>日本</rb><rt>にほん</rt><rb>語</rb><rt>ご</rt></ruby>を学ぶ。</p>
          <p>旅の<ruby><rb>道</rb><rtc><rt>みち</rt></rtc></ruby>が続く。</p>
          </body></html>""")
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True,
                                     args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                                      reduced_motion="reduce", service_workers="block")
        context.route("**/*", lambda r: r.continue_() if
                      r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        context.add_init_script("""localStorage.setItem('folio-v2', JSON.stringify({prefs:{
           readingLanguage:'ja',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        page = context.new_page()
        page.set_default_timeout(6500)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(origin + "/app.html#library")
        page.locator("#folio-boot").wait_for(state="detached")
        page.locator("#import-open").tap()
        page.locator("#original-file").set_input_files({"name":"ruby.epub",
            "mimeType":"application/epub+zip","buffer":epub()})
        page.locator("#preview-import").tap()
        expect(page.locator("#import-preview")).to_be_visible()
        page.locator("#save-import").tap()
        expect(page.locator("#book-title")).to_have_text("Ruby reading fixture")
        expect(page.locator("#passage .reading-paragraph")).to_have_text([
            "今日、東京へ行く。", "日本語を学ぶ。", "旅の道が続く。"
        ], timeout=1800)
        expect(page.locator("#reader").get_by_role("heading",name="新しい旅",exact=True)).to_be_visible()
        page.locator("#paragraph-0").get_by_role("button",name="東京",exact=True).tap()
        expect(page.locator("#word-sheet-heading")).to_have_text("東京")
        assert not errors, errors
        print("EPUB ruby annotation is not concatenated into chapter titles, reading text, or dictionary targets.")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args = parser.parse_args()
    run(args.dist.resolve(),args.chromium)
