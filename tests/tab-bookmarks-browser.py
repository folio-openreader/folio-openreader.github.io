"""Reading in two tabs must not drop or resurrect independently saved bookmarks."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,service_workers="block")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""
          if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',JSON.stringify({prefs:{
            readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'
          }}));
        """)
        errors=[]
        def page():
            p=c.new_page()
            p.on("pageerror",lambda e:errors.append(str(e)))
            p.goto(origin+"/app.html#read/folio-night-ferry")
            p.locator("#folio-boot").wait_for(state="detached")
            expect(p.locator("#book-title")).to_have_text("The Night Ferry")
            expect(p.locator("#passage .reading-paragraph.active")).to_be_attached()
            return p
        def marks(p):
            return p.evaluate("""() => (JSON.parse(localStorage.getItem('folio-v2')).bookmarks?.['folio-night-ferry']||[])
                .map(m=>[m.chapter,m.paragraph]).sort((a,b)=>a[0]-b[0])""")
        left,right=page(),page()
        left.bring_to_front()
        left.locator("#reader-bookmark").tap()
        expect(left.locator("#reader-bookmark")).to_have_attribute("aria-pressed","true")
        assert marks(left)==[[0,0]]
        right.bring_to_front()
        right.locator("#next-chapter").tap()
        expect(right.locator("#chapter-title")).to_contain_text("2 / 3")
        assert marks(right)==[[0,0]], ("chapter navigation overwrote the other tab's bookmark",marks(right))
        right.locator("#reader-bookmark").tap()
        expect(right.locator("#reader-bookmark")).to_have_attribute("aria-pressed","true")
        both=marks(right)
        assert [m[0] for m in both]==[0,1], both
        right_mark=both[1]
        # Left removes its bookmark while right has an older visible state.
        left.bring_to_front()
        left.locator("#reader-bookmark").tap()
        expect(left.locator("#reader-bookmark")).to_have_attribute("aria-pressed","false")
        assert marks(left)==[right_mark], marks(left)
        right.bring_to_front()
        right.locator("#next-chapter").tap()
        expect(right.locator("#chapter-title")).to_contain_text("3 / 3")
        assert marks(right)==[right_mark], marks(right)
        fresh=page()
        fresh.locator("#chapter-open").tap()
        expect(fresh.locator("#bookmarks-list .bookmark-row")).to_have_count(1)
        expect(fresh.locator("#bookmarks-list .bookmark-row .chapter-row")).to_contain_text(f"абзац {right_mark[1]+1}")
        assert not errors,errors
        print("Two tabs saved distinct marks, removed only the chosen mark, and kept the result through later navigation and reload.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
