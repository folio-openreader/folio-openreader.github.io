"""Browser regression: EPUB font-only metadata is ignored; DRM is never opened."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
OCF = "urn:oasis:names:tc:opendocument:xmlns:container"
XMLENC = "http://www.w3.org/2001/04/xmlenc#"
IDPF = "http://www.idpf.org/2008/embedding"
SENTENCE = "This chapter is clear text; the font assets are ignored."


def epub(mode):
    stream = BytesIO()
    method = IDPF if mode != "drm" else XMLENC + "aes128-cbc"
    uri = "EPUB/chapter.xhtml" if mode == "chapter" else "EPUB/fonts/book.woff2"
    with ZipFile(stream, "w") as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        z.writestr("META-INF/container.xml",
                   f'<container xmlns="{OCF}" version="1.0"><rootfiles><rootfile '
                   'full-path="EPUB/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr("META-INF/encryption.xml", f"""
            <encryption xmlns="{OCF}" xmlns:enc="{XMLENC}">
              <enc:EncryptedData>
                <enc:EncryptionMethod Algorithm="{method}"/>
                <enc:CipherData><enc:CipherReference URI="{uri}"/></enc:CipherData>
              </enc:EncryptedData>
            </encryption>""")
        if mode == "rights":
            z.writestr("META-INF/rights.xml", "<rights/>")
        alias = "fonts/book.woff2" if mode == "alias" else "chapter.xhtml"
        z.writestr("EPUB/book.opf", f"""<package xmlns="http://www.idpf.org/2007/opf"
            xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="edition">
            <metadata><dc:identifier id="edition">test-epub-font</dc:identifier>
            <dc:title>Clear chapter fixture</dc:title><dc:language>en</dc:language></metadata>
            <manifest><item id="chapter" href="{alias}" media-type="application/xhtml+xml"/>
            <item id="font" href="fonts/book.woff2" media-type="font/woff2"/></manifest>
            <spine><itemref idref="chapter"/></spine></package>""", compress_type=ZIP_DEFLATED)
        z.writestr("EPUB/chapter.xhtml", f"""<html xmlns="http://www.w3.org/1999/xhtml">
                   <head><title>Test chapter</title></head><body><p>{SENTENCE}</p></body></html>""",
                   compress_type=ZIP_DEFLATED)
        z.writestr("EPUB/fonts/book.woff2", b"No usable font here. An importer must not need it.")
    return stream.getvalue()


def run(dist, chromium, modes):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                          has_touch=True, service_workers="block")
        c.route("**/*", lambda route: route.continue_() if
                route.request.url.startswith((origin + "/", "blob:", "data:")) else route.abort())
        p = c.new_page()
        p.set_default_timeout(10000)
        errors = []
        p.on("pageerror", lambda error: errors.append(str(error)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        for mode in modes:
            p.locator("#original-file").set_input_files({"name": mode + ".epub",
                "mimeType": "application/epub+zip", "buffer": epub(mode)})
            p.locator("#preview-import").click()
            if mode == "good":
                expect(p.locator("#import-preview")).to_contain_text(SENTENCE)
                p.locator("#save-import").click()
                expect(p.locator("#book-title")).to_have_text("Clear chapter fixture")
                expect(p.locator("#paragraph-0")).to_have_text(SENTENCE)
            else:
                expect(p.locator("#import-status")).to_contain_text("Protected or encrypted EPUBs")
                expect(p.locator("#import-preview")).to_be_hidden()
            print(mode + ": expected preview result verified")
        assert not errors, errors
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    parser.add_argument("--only-good", action="store_true")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium, ("good",) if a.only_good else ("drm", "chapter", "alias", "rights", "good"))
