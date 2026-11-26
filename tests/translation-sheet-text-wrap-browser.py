"""Pairing books does not cut long literal strings off a narrow translation sheet."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

baseline=runpy.run_path(str(Path(__file__).with_name("rtl-reader-sheets-browser.py")))
serve, epub=baseline["serve"],baseline["epub"]
geometry=runpy.run_path(str(Path(__file__).with_name("reader-long-word-browser.py")))
assert_fits=geometry["assert_fits"]
ORIGINAL="Sie prüfte das Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz im Register."
TRANSLATION="The reference was https://example.test/" + "catalogue" * 12 + " in the report."


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":320,"height":640},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'de',dictionaryTarget:'en',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6000)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        for side,title,lang,text in [
            ("original","Ein Archiv","de",ORIGINAL),("translation","An archive","en",TRANSLATION)]:
            p.locator(f"#{side}-file").set_input_files({"name":f"{side}.epub",
                "mimeType":"application/epub+zip","buffer":epub(title,lang,text)})
        p.locator("#preview-import").tap()
        p.locator("#alignment-check").check()
        p.locator("#save-import").tap()
        opener=p.locator("#translation-full")
        opener.tap()
        sheet=p.locator("#translation-dialog")
        expect(sheet).to_be_visible()
        p.evaluate("document.fonts.ready")
        for selector,text,lang in [
            ("#translation-result p[lang=en]",TRANSLATION,"en"),("#translation-original",ORIGINAL,"de")]:
            block=sheet.locator(selector)
            expect(block).to_have_text(text)
            expect(block).to_have_attribute("lang",lang)
            r=block.bounding_box()
            assert_fits(block,r["x"],r["x"]+r["width"],selector,wraps=True)
        widths=sheet.evaluate("el=>({content:el.scrollWidth,visible:el.clientWidth})")
        assert widths["content"]<=widths["visible"]+1,widths
        p.keyboard.press("Escape")
        expect(sheet).to_be_hidden()
        expect(opener).to_be_focused()
        assert not errors,errors
        print("320px translation sheet wraps long URL and source compound, preserves both texts, and never scrolls horizontally.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
