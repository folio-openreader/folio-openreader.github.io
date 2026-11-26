"""Fresh chapters include the heading; only an existing mid-chapter spot resumes."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
epub = runpy.run_path(str(Path(__file__).with_name("chapter-translation-browser.py")))["epub"]
epub.__globals__.update(CHAPTERS=3, ROWS=30)
GEOMETRY = """() => {
    const sc=document.querySelector('#reading-scroll'),h=document.querySelector('#chapter-heading');
    const box=sc.getBoundingClientRect(),heading=h.getBoundingClientRect();
    return {scroll:sc.scrollTop,top:heading.top-box.top,bottom:box.bottom-heading.bottom};
}"""


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(headless=True,executable_path=chromium,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        service_workers="block",reduced_motion="reduce")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
            JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        errors=[]
        p.on("pageerror",lambda error:errors.append(str(error)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Chapter openings.epub",
            "mimeType":"application/epub+zip","buffer":epub(False)})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()

        def chapter_top(number):
            expect(p.locator("#chapter-heading")).to_have_text(f"Chapter {number}")
            expect(p.locator("#paragraph-0")).to_have_class("reading-paragraph active")
            data=p.evaluate(GEOMETRY)
            assert data["scroll"]<=1 and data["top"]>=0 and data["bottom"]>=0,data

        chapter_top(1)
        p.locator("#chapter-open").tap()
        p.locator("#chapter-list .chapter-row").nth(1).press("Enter")
        expect(p.locator("#chapter-heading")).to_be_focused()
        chapter_top(2)
        p.locator("#next-chapter").tap()
        chapter_top(3)
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        chapter_top(3)

        p.evaluate("""() => {
          const sc=document.querySelector('#reading-scroll'), row=document.querySelector('#paragraph-10');
          sc.scrollTop+=row.getBoundingClientRect().top-sc.getBoundingClientRect().top-18;
        }""")
        expect(p.locator("#paragraph-10")).to_have_class("reading-paragraph active")
        pos=p.evaluate(GEOMETRY)["scroll"]
        assert pos>500,pos
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(p.locator("#paragraph-10")).to_have_class("reading-paragraph active")
        assert abs(p.evaluate(GEOMETRY)["scroll"]-pos)<2
        assert not errors,errors
        print("Chapter heading is visible at import, keyboard contents, next, and reload; an actual mid-chapter point still resumes exactly.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
