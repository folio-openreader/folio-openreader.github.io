"""Local EPUB images survive paired import and cold reload without shifting text."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

fixtures=Path(__file__).parent
serve=runpy.run_path(str(fixtures/"sync-browser.py"))["serving"]
png=runpy.run_path(str(fixtures/"comic-nav-focus-browser.py"))["panel"]
BEFORE="The garden lies beyond the hill."
AFTER="The lantern waits by the window. " + "Beyond the hill a second garden is resting. " * 20
AFTER=AFTER.strip()
PAIRED="Фонарь ждёт у окна."
ALT="A drawing of the lantern"


def epub(title, lang, first, second, art=False):
    stream=BytesIO()
    with ZipFile(stream,"w",compression=ZIP_DEFLATED) as z:
        z.writestr("mimetype","application/epub+zip",compress_type=ZIP_STORED)
        z.writestr("META-INF/container.xml",'''<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="content/book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>''')
        resources='<item id="draw" href="images/lamp%20image.png" media-type="image/png"/>' if art else ''
        z.writestr("content/book.opf",f'''<package xmlns="http://www.idpf.org/2007/opf"
          xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="edition">
          <metadata><dc:identifier id="edition">fixture-{lang}</dc:identifier><dc:title>{title}</dc:title>
          <dc:language>{lang}</dc:language></metadata>
          <manifest><item id="c" href="chapters/c.xhtml" media-type="application/xhtml+xml"/>{resources}</manifest>
          <spine><itemref idref="c"/></spine></package>''')
        drawing=f'''<figure><img src="../images/lamp%20image.png" alt="{ALT}"/></figure>
          <img src="https://epub-image.invalid/remote.png" alt="Remote drawing"/>''' if art else ''
        z.writestr("content/chapters/c.xhtml",f'''<html xmlns="http://www.w3.org/1999/xhtml" lang="{lang}">
          <head><title>{title}</title></head><body><h1>{title}</h1><p>{first}</p>{drawing}<p>{second}</p></body></html>''')
        if art:
            z.writestr("content/images/lamp image.png",png(2))
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        remote=[]
        def route(r):
            if r.request.url.startswith((origin+"/","blob:","data:")): r.continue_()
            else:
                remote.append(r.request.url)
                r.abort()
        c.route("**/*",route)
        p=c.new_page()
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.set_default_timeout(6500)
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        format_help=p.locator('#import-dialog summary[aria-label="Поддерживаемые форматы книг"]')
        format_help.tap()
        help_copy=p.locator("#import-dialog .import-formats .help-copy")
        expect(help_copy).to_be_visible()
        expect(help_copy).to_contain_text("встроенные иллюстрации оригинала (PNG, JPEG, WebP)")
        expect(help_copy).to_contain_text("из PDF или фото сохраняется только текст")
        expect(help_copy).to_contain_text("сохранить страницы целиком, выберите «Импортировать комикс»")
        box=help_copy.bounding_box()
        assert 0<=box["x"]<box["x"]+box["width"]<=320,box
        format_help.tap()
        expect(help_copy).to_be_hidden()
        for field,data in [
            ("original",epub("Illustrated lantern","en",BEFORE,AFTER,art=True)),
            ("translation",epub("Иллюстрация","ru","Сад за холмом.",PAIRED))]:
            p.locator(f"#{field}-file").set_input_files({"name":f"{field}.epub",
                "mimeType":"application/epub+zip","buffer":data})
        p.locator("#preview-import").tap()
        expect(p.locator("#import-preview")).to_contain_text("сопоставлено 2 из 2")
        expect(p.locator("#import-preview")).to_contain_text("Встроенных изображений: 1")
        p.locator("#alignment-check").check()
        p.locator("#save-import").tap()

        def reading():
            expect(p.locator("#paragraph-0")).to_have_text(BEFORE)
            expect(p.locator("#paragraph-1")).to_have_text(AFTER)
            picture=p.locator("#passage #paragraph-0 + figure:has(+ #paragraph-1)").get_by_role("img",name=ALT)
            expect(picture).to_be_visible()
            p.wait_for_function("""() => {
              const art = document.querySelector('#passage figure img');
              return art?.complete && art.naturalWidth === 120 && art.naturalHeight === 160;
            }""")
            assert picture.get_attribute("src").startswith("blob:")
            size=picture.bounding_box()
            assert 0<=size["x"] and size["x"]+size["width"]<=320, size
            expect(p.get_by_role("img",name="Remote drawing")).to_have_count(0)
        reading()
        p.locator("#reading-scroll").evaluate("""sc=>{
          const row=sc.querySelector('#paragraph-1');
          sc.scrollTop+=row.getBoundingClientRect().top-sc.getBoundingClientRect().top-22;
        }""")
        expect(p.locator("#reading-progress")).to_contain_text("абзац 2 / 2")
        p.wait_for_function("""() => {
          const state=JSON.parse(localStorage.getItem('folio-v2'));
          return state.positions?.[state.lastBook]?.paragraph===1;
        }""")
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        reading()
        expect(p.locator("#reading-progress")).to_contain_text("абзац 2 / 2")
        p.locator("#paragraph-1").get_by_role("button",name="lantern").tap()
        p.locator("#word-context-toggle").tap()
        expect(p.locator("#word-dialog .word-parallel")).to_have_text(PAIRED)
        p.locator("#word-dialog [data-sheet-handle]").tap()
        old_url=p.locator("#passage figure img").get_attribute("src")
        assert old_url and old_url.startswith("blob:")
        book_id=p.evaluate("""JSON.parse(localStorage.getItem('folio-v2')).lastBook""")
        def stored_images():
            return p.evaluate("""id=>new Promise((done,fail)=>{
              const open=indexedDB.open('folio-library');
              open.onerror=()=>fail(open.error);
              open.onsuccess=()=>{
                const db=open.result,tx=db.transaction('books');
                const count=tx.objectStore('books').count(
                  IDBKeyRange.bound(['epub-illustration-v1',id],['epub-illustration-v1',id,[]],false,true));
                tx.oncomplete=()=>{db.close();done(count.result)};
                tx.onabort=()=>{db.close();fail(tx.error)};
              };
            })""",book_id)
        assert stored_images()==1
        p.locator("#reader-back").tap()
        expect(p.locator("#library-view")).to_be_visible()
        assert not p.evaluate("url=>fetch(url).then(r=>r.ok,()=>false)",old_url)
        p.locator("[data-view=home]:visible").first.press("Enter")
        remove=p.locator("#books").get_by_role("button",name="Удалить книгу Illustrated lantern",exact=True)
        remove.press("Enter")
        p.locator("#book-delete").get_by_role("button",name="Удалить книгу",exact=True).press("Enter")
        expect(remove).to_have_count(0)
        assert stored_images()==0
        assert not any("epub-image.invalid" in url for url in remote),remote
        assert not errors,errors
        b.close()
    print("320px illustrated EPUB: a local raster renders between the two unchanged text indices, survives reload with the text checkpoint, preserves paired lookup, and is cleaned up on deletion.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
