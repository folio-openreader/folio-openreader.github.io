"""Dictionary status filters remain visible on phones with real four-digit counts."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
MEASURE="""el=>{
  const track=el.getBoundingClientRect();
  const result=document.querySelector('.wordbook-results').getBoundingClientRect();
  return {scroll:el.scrollWidth-el.clientWidth,width:track.width,list:result.width,
    cells:[...el.querySelectorAll('button')].map(b=>{
      const r=b.getBoundingClientRect();
      return {left:r.left-track.left,right:track.right-r.right,width:r.width,height:r.height};
    })};
}"""


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        context=browser.new_context(viewport={"width":320,"height":750},is_mobile=True,has_touch=True,
                                    reduced_motion="reduce",service_workers="block")
        context.route("**/*",lambda r:r.continue_() if
                      r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        context.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
          readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          const rows=Array.from({length:4000},(_,i)=>{
            const id=[Math.floor(i/676),Math.floor(i/26)%26,i%26].map(n=>String.fromCharCode(97+n)).join('');
            return ['fixture'+id,'en',100+i,i%4,0,0,0,100+i,{}];
          });
          localStorage.setItem('folio-learning-v1',JSON.stringify({version:1,rows}));
        """)
        p=context.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#words")
        p.locator("#folio-boot").wait_for(state="detached")
        rail=p.locator("#word-stage-filters")
        expect(rail.locator('[data-stage-count=all]')).to_have_text("4000")
        assert rail.locator("small").all_text_contents()==["4000","1000","1000","1000","1000"]
        p.evaluate("document.fonts.ready")
        print("320px",rail.evaluate(MEASURE))
        for width in [320,390,768,1440]:
            p.set_viewport_size({"width":width,"height":750})
            data=rail.evaluate(MEASURE)
            assert data["scroll"]<=1,(width,data)
            assert abs(data["width"]-data["list"])<=1,(width,data)
            assert all(r["left"]>=0 and r["right"]>=0 and r["width"]>=44 and r["height"]>=44
                       for r in data["cells"]),(width,data)
        p.set_viewport_size({"width":320,"height":750})
        known=rail.locator("[data-stage-filter=known]")
        known.press("Enter")
        expect(known).to_have_attribute("aria-pressed","true")
        expect(p.locator("#word-matches")).to_have_text("Найдено: 1000")
        p.evaluate("document.documentElement.style.fontSize='32px'")
        expect(known).to_be_focused()
        first=rail.locator("[data-stage-filter=all]")
        first.focus()
        known.focus()
        expect(known).to_be_focused()
        assert rail.evaluate(MEASURE)["cells"][-1]["right"]>=-1
        assert not errors,errors
        print("Widths 320/390/768/1440: all five full-width targets visible; real filtering and 200% text focus remain usable.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
