"""Cancellation during extraction of a single large EPUB chapter."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZipFile
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
ROWS = 12000


def epub():
    stream = BytesIO()
    rows = "".join(f'<p>Paragraph {i}. <strong>The river</strong> runs toward the gulf. '
                   'The boat drifts quietly under a bridge.</p>' for i in range(1, ROWS + 1))
    with ZipFile(stream, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml", """<container
          xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
          <rootfiles><rootfile media-type="application/oebps-package+xml"
          full-path="EPUB/book.opf"/></rootfiles></container>""")
        z.writestr("EPUB/book.opf", """<package xmlns="http://www.idpf.org/2007/opf" version="3.0"
          unique-identifier="book-id" xmlns:dc="http://purl.org/dc/elements/1.1/">
          <metadata><dc:identifier id="book-id">fixture</dc:identifier>
          <dc:title>Single long chapter</dc:title><dc:language>en</dc:language></metadata>
          <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="chapter"/></spine></package>""")
        z.writestr("EPUB/chapter.xhtml", f'<html xmlns="http://www.w3.org/1999/xhtml">'
                   '<head><title>Large chapter</title></head><body data-fixture="dense-chapter">'
                   f'{rows}</body></html>')
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                      has_touch=True, service_workers="block")
        context.route("**/*", lambda r: r.continue_()
                      if r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        context.add_init_script("""(() => {
          const parse = DOMParser.prototype.parseFromString;
          window.cancelWhenParsed = true;
          window.cancelTurn = null;
          DOMParser.prototype.parseFromString = function(source,mime) {
            const doc=parse.call(this,source,mime);
            if(window.cancelWhenParsed && source.includes('data-fixture="dense-chapter"')) {
              window.cancelWhenParsed=false;
              // Queue the same Cancel button's click as soon as the chapter is
              // parsed. Proves traversal gives pending input a turn before preview.
              setTimeout(() => {
                const cancel=document.querySelector('#cancel-import');
                window.cancelTurn={hidden:cancel.hidden};
                if(!cancel.hidden)cancel.click();
              }, 0);
            }
            return doc;
          };
        })()""")
        page = context.new_page()
        cdp = context.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 6})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(origin + "/app.html#library")
        page.locator("#folio-boot").wait_for(state="detached")
        page.locator("[data-lang-continue]").first.click()
        page.locator("#import-open").click()
        page.locator("#original-file").set_input_files({"name":"dense.epub",
            "mimeType":"application/epub+zip","buffer":epub()})
        page.locator("#preview-import").click()
        page.wait_for_function("window.cancelTurn?.hidden !== undefined")
        assert page.evaluate("window.cancelTurn") == {"hidden": False}, page.evaluate("window.cancelTurn")
        expect(page.locator("#import-status")).to_contain_text("Отменено. Книга не добавлена.")
        expect(page.locator("#import-preview")).to_be_hidden()
        expect(page.locator("#preview-import")).to_be_enabled()
        # The same selected file is immediately retryable, and the complete
        # chapter still yields the same order, inline spaces and paragraph count.
        page.locator("#preview-import").click()
        preview = page.locator("#import-preview")
        expect(preview).to_contain_text(f"Абзацев: {ROWS}", timeout=15000)
        expect(preview.locator(".preview-pair").first).to_contain_text("Paragraph 1. The river runs")
        assert not errors, errors
        print("Cancel ran during large chapter extraction. Retry kept all 12000 paragraphs.")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
