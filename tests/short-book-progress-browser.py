"""A book with one long paragraph shows real progress and still resumes its place."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT = " ".join(["The evening ferry moved quietly across the harbor as lamps lit the docks."] * 44)


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        service_workers="block",reduced_motion="reduce")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
          JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda error:errors.append(str(error)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"One passage.txt","mimeType":"text/plain",
                                                    "buffer":TEXT.encode()})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        p.evaluate("document.fonts.ready")
        expect(p.locator("#passage > .reading-paragraph")).to_have_count(1)
        expect(p.locator("#paragraph-0 .word").first).to_be_attached()
        indicator=p.locator("#reading-progress")
        p.wait_for_timeout(300)  # Let the initial anchor be saved before checking zero.
        expect(indicator).to_have_text("0% · абзац 1 / 1")
        scroll=p.locator("#reading-scroll")
        geometry=scroll.evaluate("""el=>{
          const para=el.querySelector('#paragraph-0');
          const start=Math.max(0,el.scrollTop+para.getBoundingClientRect().top-el.getBoundingClientRect().top-22);
          const maximum=el.scrollHeight-el.clientHeight;el.scrollTop=Math.round(start+(maximum-start)*.55);
          return {maximum,offset:el.scrollTop};
        }""")
        assert geometry["maximum"]>1000, geometry
        expect(indicator).to_have_text("55% · абзац 1 / 1",timeout=2000)

        p.locator("#reader-back").tap()
        p.locator("[data-view=home]:visible").first.tap()
        card=p.locator("#continue-card button")
        expect(card).to_contain_text("One passage")
        expect(card.locator(".continue-progress")).to_contain_text("55%")
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(card.locator(".continue-progress")).to_contain_text("55%")
        card.tap()
        expect(indicator).to_have_text("55% · абзац 1 / 1")
        p.wait_for_function("(offset)=>Math.abs(document.getElementById('reading-scroll').scrollTop-offset)<=2",
                            arg=geometry["offset"])
        scroll.evaluate("el=>{el.scrollTop=el.scrollHeight;}")
        expect(indicator).to_have_text("100% · абзац 1 / 1")
        assert not errors,errors
        print("One long paragraph: reader and cold Continue agree at 55%, exact anchor restored, end reaches 100%.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
