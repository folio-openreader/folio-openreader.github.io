"""RTL paired text is isolated from the reader's LTR chapter number and scroller."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

fixture = runpy.run_path(str(Path(__file__).with_name("rtl-reader-sheets-browser.py")))
serve, epub = fixture["serve"], fixture["epub"]
ARABIC = "«في عام 2026، أضاء النور الطريق عند الغروب؟»"
ENGLISH = "In 2026, did the light illuminate the road at dusk?"


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        for field,title,lang,content in [
            ("original","North light","en",ENGLISH),("translation","ضوء الشمال","ar",ARABIC)]:
            p.locator(f"#{field}-file").set_input_files({"name":f"{field}.epub",
                "mimeType":"application/epub+zip","buffer":epub(title,lang,content)})
        p.locator("#preview-import").tap()
        p.locator("#alignment-check").check()
        p.locator("#save-import").tap()
        segment=p.locator("#translation-0-0")
        copy=segment.locator(".translation-copy")
        expect(copy).to_have_text(ARABIC)
        expect(segment).to_have_attribute("lang","ar")
        expect(copy).to_have_css("direction","rtl",timeout=1200)
        expect(copy).to_have_css("unicode-bidi","isolate")
        expect(segment.locator(".separator")).to_have_css("direction","ltr")
        expect(p.locator("#translation-track")).to_have_css("direction","ltr")
        assert segment.locator(".separator").bounding_box()["x"] < copy.bounding_box()["x"]
        expect(p.locator("#paragraph-0")).to_have_css("direction","ltr")

        p.locator("#translation-full").tap()
        expect(p.locator("#translation-result p[lang=ar]")).to_have_text(ARABIC)
        expect(p.locator("#translation-result p[lang=ar]")).to_have_css("direction","rtl")
        assert not errors,errors
        print("Arabic paired ribbon text is RTL and isolated, while the chapter prefix and reader stay LTR.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
