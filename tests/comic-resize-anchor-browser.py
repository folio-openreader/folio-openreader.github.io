"""Changing viewport width preserves the visible place on tall comic artwork."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

fixtures=runpy.run_path(str(Path(__file__).with_name("comic-resume-browser.py")))
serve,tall_panel=fixtures["serve"],fixtures["tall_panel"]
MEASURE="""() => {
  const sc=document.querySelector('#reading-scroll'), bar=document.querySelector('.comic-bar');
  const rect=document.querySelector('.comic-frame').getBoundingClientRect();
  return {offset:(sc.getBoundingClientRect().top+bar.offsetHeight-rect.top)/rect.height,
    pixel:sc.scrollTop,toEnd:sc.scrollHeight-sc.clientHeight-sc.scrollTop};
}"""
SAVED="""() => {
  const x=JSON.parse(localStorage.getItem('folio-v2'));
  return x.positions[x.lastBook]?.comicImageOffset;
}"""


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=chromium,args=["--disable-dev-shm-usage"])
        ctx=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                                reduced_motion="reduce",service_workers="block")
        ctx.route("**/*",lambda r: r.continue_() if
                  r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
            readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=ctx.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#comic-import-open").tap()
        p.locator("#comic-files").set_input_files(
            {"name":"One tall page.png","mimeType":"image/png","buffer":tall_panel()})
        p.locator("#comic-import-start").tap()
        p.wait_for_function("document.querySelector('.comic-art')?.naturalHeight===6000")
        p.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
        p.evaluate("document.querySelector('#reading-scroll').scrollTop=1200")
        p.wait_for_function("("+SAVED+")()>0.3")
        before=p.evaluate(MEASURE)
        p.set_viewport_size({"width":720,"height":420})
        p.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
        wide=p.evaluate(MEASURE)
        assert abs(wide["offset"]-before["offset"]) < .002, (before,wide)
        assert wide["pixel"] > before["pixel"]+600, (before,wide)

        p.evaluate("const sc=document.querySelector('#reading-scroll');sc.scrollTop=sc.scrollHeight")
        p.wait_for_function("("+SAVED+")()===1")
        p.set_viewport_size({"width":390,"height":844})
        p.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
        assert p.evaluate(MEASURE)["toEnd"] <= 1
        # Growing the page back should keep intentional page-end, not the old px position.
        p.set_viewport_size({"width":720,"height":420})
        p.evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))")
        assert p.evaluate(MEASURE)["toEnd"] <= 1
        assert not errors,errors
        print("Comic width changes preserved the normalized art location and explicit bottom in both directions.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
