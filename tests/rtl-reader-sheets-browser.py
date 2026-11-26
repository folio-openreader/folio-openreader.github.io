"""RTL book excerpts keep their own direction inside LTR Folio dialogs."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
ARABIC="في عام 2026، أضاء النور الطريق عند الغروب؟"
ENGLISH="In 2026, did the light illuminate the road at dusk?"


def epub(title, language, text):
    stream=BytesIO()
    with ZipFile(stream,"w",compression=ZIP_DEFLATED) as z:
        z.writestr("mimetype","application/epub+zip",compress_type=ZIP_STORED)
        z.writestr("META-INF/container.xml",'''<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>''')
        z.writestr("book.opf",f'''<package xmlns="http://www.idpf.org/2007/opf"
          xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="edition">
          <metadata><dc:identifier id="edition">rtl-{language}</dc:identifier><dc:title>{title}</dc:title>
          <dc:language>{language}</dc:language></metadata>
          <manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="c"/></spine></package>''')
        z.writestr("c.xhtml",f'''<html xmlns="http://www.w3.org/1999/xhtml" lang="{language}">
          <head><title>{title}</title></head><body><h1>{title}</h1><p>{text}</p></body></html>''')
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',
          JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.set_default_timeout(6500)
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        for field,title,lang,text in [("original","دفتر الأفق","ar",ARABIC),("translation","Parallel fixture","en",ENGLISH)]:
            p.locator(f"#{field}-file").set_input_files({"name":f"{field}.epub",
                "mimeType":"application/epub+zip","buffer":epub(title,lang,text)})
        p.locator("#preview-import").tap()
        p.locator("#alignment-check").check()
        p.locator("#save-import").tap()

        source=p.locator("#paragraph-0")
        expect(source).to_have_text(ARABIC)
        expect(source).to_have_css("direction","rtl")
        source.get_by_role("button",name="النور",exact=True).tap()
        word=p.locator("#word-dialog")
        word.locator("#word-context-toggle").tap()
        excerpt=word.locator(".word-original")
        expect(excerpt).to_have_text(ARABIC)
        expect(excerpt).to_have_css("direction","rtl",timeout=1600)
        expect(excerpt.locator("mark")).to_have_text("النور")
        expect(word.locator(".word-parallel")).to_have_text(ENGLISH)
        expect(word.locator(".word-parallel")).to_have_css("direction","ltr")
        expect(word.locator("#word-sheet-heading")).to_have_css("direction","rtl")
        expect(word.get_by_role("heading",name="Абзац оригинала")).to_have_css("direction","ltr")
        word.locator("[data-sheet-handle]").tap()

        p.locator("#translation-full").tap()
        sheet=p.locator("#translation-dialog")
        expect(sheet.locator(".source-text")).to_have_text(ARABIC)
        expect(sheet.locator(".source-text")).to_have_css("direction","rtl")
        translated=sheet.locator("#full-translation p[lang=en]")
        expect(translated).to_have_text(ENGLISH)
        expect(translated).to_have_css("direction","ltr")
        expect(sheet.get_by_role("heading",name="Текущий абзац")).to_have_css("direction","ltr")
        assert not errors,errors
        print("Arabic original and English parallel text retain independent direction in both mobile sheets.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
