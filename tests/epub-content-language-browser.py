"""An EPUB uses consistent content-language tags when package metadata is unknown."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

fixtures=runpy.run_path(str(Path(__file__).with_name("japanese-words-browser.py")))
serve,TEXT=fixtures["serve"],fixtures["TEXT"]


def epub(declared, second_lang):
    stream=BytesIO()
    with ZipFile(stream,"w",compression=ZIP_DEFLATED) as book:
        book.writestr("mimetype","application/epub+zip",compress_type=ZIP_STORED)
        book.writestr("META-INF/container.xml",'''<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>''')
        book.writestr("book.opf",f'''<package xmlns="http://www.idpf.org/2007/opf"
          xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="edition">
          <metadata><dc:identifier id="edition">folio-lang-fallback</dc:identifier>
          <dc:title>Content language fixture</dc:title><dc:language>{declared}</dc:language></metadata>
          <manifest><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/>
          <item id="second" href="second.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="first"/><itemref idref="second"/></spine>
          </package>''')
        book.writestr("first.xhtml",f'''<html xmlns="http://www.w3.org/1999/xhtml" lang="de">
          <head><title>First</title></head><body xml:lang="ja"><p>{TEXT}</p></body></html>''')
        book.writestr("second.xhtml",f'''<html xmlns="http://www.w3.org/1999/xhtml" lang="{second_lang}">
          <head><title>Second</title></head><body><p>{TEXT}</p></body></html>''')
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=chromium,args=["--disable-dev-shm-usage"])
        ctx=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                                reduced_motion="reduce",service_workers="block")
        ctx.route("**/*",lambda r:r.continue_() if
                  r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
            readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=ctx.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        for declared,section,wanted in (("und","ja","ja"),("en","ja","en"),("","en",None)):
            p.locator("#import-open").tap()
            p.locator("#original-file").set_input_files({"name":"language.epub",
                "mimeType":"application/epub+zip","buffer":epub(declared,section)})
            p.locator("#preview-import").tap()
            preview=p.locator("#import-preview")
            expect(preview).to_be_visible()
            if wanted is None:
                expect(preview.get_by_label("Язык оригинала (не указан в файле)")).to_be_visible()
                break
            expect(preview.locator(".preview-pair p").first).to_have_attribute("lang",wanted,timeout=1600)
            p.locator("#save-import").tap()
            row=p.locator("#paragraph-0")
            expect(row).to_have_text(TEXT)
            expect(row).to_have_attribute("lang",wanted)
            if wanted=="ja":
                assert row.locator(".word").all_text_contents()==["私","は","本","を","読む","明日","も","読む"]
                row.get_by_role("button",name="読む",exact=True).last.tap()
                expect(p.locator("#word-sheet-heading")).to_have_text("読む")
                p.locator("#word-dialog [data-sheet-handle]").tap()
            p.locator("#reader-back").tap()
            expect(p).to_have_url(origin+"/app.html#library")
        assert not errors,errors
        print("Content tags enabled Japanese word lookup; package language won when present, and conflicting chapters did not guess.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
