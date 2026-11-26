"""Saved daily news should be readable even while a network refresh is stalled."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
LINE = "News fixture: local astronomy club observes a bright comet near the horizon."


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,service_workers="block")
        pending=[]; requests=[]
        def route(r):
            url=r.request.url
            if url.startswith("https://en.wikipedia.org/w/api.php"):
                requests.append(url)
                pending.append(r)
                return
            return r.continue_() if url.startswith((origin+"/","blob:","data:")) else r.abort()
        c.route("**/*",route)
        c.add_init_script("""
          const date=new Date().toISOString().slice(0,10);
          localStorage.setItem('folio.news.days.v1',JSON.stringify({
            checked:Date.now()-2*3600000,partial:false,rows:[{
              date,rev:42,groups:[{name:'Science',events:[{
                text:'News fixture: local astronomy club observes a bright comet near the horizon.',
                links:[{label:'Fixture source',url:'https://example.com/fixture'}]
              }]}]
            }]
          }));
          localStorage.setItem('folio-v2',JSON.stringify({
            prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}
          }));
        """)
        p=c.new_page()
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        try:
            p.locator("[data-catalog=news]").tap()
            card=p.locator("#news-catalog button.research-open").first
            expect(card).to_be_visible(timeout=1600)
            expect(p.locator("#news-freshness")).to_contain_text("сохранённая версия")
            assert 1<=len(pending)<=3
            card.tap()
            expect(p.locator("#paragraph-0")).to_have_text(LINE,timeout=3500)
            assert requests, requests
        finally:
            for r in pending:
                r.abort()
        assert not errors,errors
        print("Cached daily news opened at once in the reader while Wikipedia refresh was still unresolved.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
