"""Long literal EPUB strings must fit the narrow import preview."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

here = Path(__file__).parent
fixtures = runpy.run_path(str(here / "translation-sheet-text-wrap-browser.py"))
epub, serve, assert_fits = (fixtures[k] for k in ("epub", "serve", "assert_fits"))
ORIGINAL, TRANSLATION = (fixtures[k] for k in ("ORIGINAL", "TRANSLATION"))


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True,
                                     args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width":320,"height":640}, is_mobile=True, has_touch=True,
                                  reduced_motion="reduce", service_workers="block")
        ctx.route("**/*",lambda r: r.continue_() if
                  r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
            readingLanguage:'de',dictionaryTarget:'en',languageSetup:'done'}}));""")
        p = ctx.new_page()
        p.set_default_timeout(6500)
        errors = []
        p.on("pageerror",lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        for field,title,lang,copy in [
                ("original","Ein Archiv","de",ORIGINAL),("translation","The archive","en",TRANSLATION)]:
            p.locator(f"#{field}-file").set_input_files({"name":f"{field}.epub",
                "mimeType":"application/epub+zip","buffer":epub(title,lang,copy)})
        p.locator("#preview-import").tap()
        dialog = p.locator("#import-dialog")
        preview = dialog.locator("#import-preview")
        expect(preview).to_be_visible()
        p.evaluate("document.fonts.ready")
        for lang, text in (("de",ORIGINAL),("en",TRANSLATION)):
            paragraph = preview.locator(f".preview-pair p[lang={lang}]")
            expect(paragraph).to_have_text(text)
            box = paragraph.bounding_box()
            assert_fits(paragraph,box["x"],box["x"]+box["width"],lang,wraps=True)
        width = dialog.evaluate("el=>({inner:el.clientWidth,outer:el.scrollWidth})")
        assert width["outer"] <= width["inner"]+1,width
        dialog.locator("#alignment-check").check()
        dialog.locator("#save-import").tap()
        expect(p.locator("#paragraph-0")).to_have_text(ORIGINAL)
        assert not errors,errors
        print("320px paired import preview keeps the original compound and full URL inside their passages.")
        browser.close()


if __name__=="__main__":
    ap=ArgumentParser(description=__doc__)
    ap.add_argument("dist",type=Path)
    ap.add_argument("--chromium")
    args=ap.parse_args()
    run(args.dist.resolve(),args.chromium)
