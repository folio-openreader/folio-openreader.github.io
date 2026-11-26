"""Appending saved words preserves previously presented rows and their controls."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=chromium,args=["--disable-dev-shm-usage"])
        ctx=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                                reduced_motion="reduce",service_workers="block")
        ctx.route("**/*",lambda r:r.continue_() if
                  r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
          readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          const rows=Array.from({length:112},(_,i)=>{
            const word='fixture'+String.fromCharCode(97+Math.floor(i/26),97+i%26);
            return [word,'en',100+i,0,0,0,0,100+i,{}]
          });
          localStorage.setItem('folio-learning-v1',JSON.stringify({version:1,rows}));
        """)
        p=ctx.new_page()
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#words")
        p.locator("#folio-boot").wait_for(state="detached")
        listbox=p.locator("#saved-list")
        rows=listbox.locator(".saved-row")
        expect(rows).to_have_count(48)
        listbox.evaluate("""list=>{
          window.fixtureRows=Array.from(list.children);
          window.fixtureWordMutations={removed:0,added:0};
          new MutationObserver(entries=>{
            for(const m of entries) {
              fixtureWordMutations.removed+=m.removedNodes.length;
              fixtureWordMutations.added+=m.addedNodes.length;
            }
          }).observe(list,{childList:true});
        }""")
        more=p.locator("#words-more")
        for before,after in ((48,96),(96,112)):
            more.press("Enter")
            expect(rows).to_have_count(after)
            expect(rows.nth(before).locator(".word-card-know")).to_be_focused()
            assert listbox.evaluate("list=>fixtureRows.every((prev,i)=>list.children[i]===prev)")
            assert p.evaluate("fixtureWordMutations")=={"removed":0,"added":after-48}
        expect(more).to_be_hidden()
        # A query is a new rendered result, not a pagination append.
        p.locator("#word-search-toggle").tap()
        p.locator("#word-search").fill("fixtureak")
        expect(rows.locator("strong")).to_have_text(["fixtureak"])
        assert not errors,errors
        print("Pagination added 48 then 16 rows without replacing any existing nodes; keyboard focus and filtering remained correct.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
