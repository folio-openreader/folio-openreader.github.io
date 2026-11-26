"""Catalog Retry remains focused until it can hand off to loaded content."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=chromium,args=["--disable-dev-shm-usage"])
        ctx=browser.new_context(viewport={"width":390,"height":844}, is_mobile=True,has_touch=True,
                                reduced_motion="reduce",service_workers="block")
        requests,held,papers=[],[],[]
        def route(r):
            url=r.request.url
            if url==origin+"/research/manifest.json":
                requests.append(url)
                if len(requests)==1:
                    return r.abort()
                held.append(r)
                return
            if url.startswith(origin+"/research/papers/"):
                papers.append(url)
            return r.continue_() if url.startswith((origin+"/","blob:","data:")) else r.abort()
        ctx.route("**/*",route)
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
            readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=ctx.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-catalog=research]").press("Enter")
        shelf=p.locator("#research-catalog")
        retry=shelf.locator("[data-research-retry]")
        status=shelf.locator("[role=status]")
        expect(retry).to_be_visible()
        expect(status).to_have_text("Каталог недоступен.")
        try:
            with p.expect_request(origin+"/research/manifest.json"):
                retry.press("Enter")
            expect(retry).to_be_visible(timeout=1500)
            expect(retry).to_be_focused()
            expect(retry).to_have_attribute("aria-busy","true")
            assert len(held)==1
            p.keyboard.press("Enter")
            assert len(requests)==2
            held.pop().abort()
            expect(status).to_have_text("Каталог недоступен.")
            expect(retry).to_be_focused()
            expect(retry).not_to_have_attribute("aria-busy","true")

            with p.expect_request(origin+"/research/manifest.json"):
                retry.press("Enter")
            held.pop().continue_()
            expect(shelf.locator(".research-open")).to_have_count(5)
            expect(retry).to_be_hidden()
            expect(shelf.locator(".research-open").first).to_be_focused()
        finally:
            for request in held:
                request.abort()
        assert len(requests)==3 and not papers and not errors,(requests,papers,errors)
        print("Catalog keyboard Retry preserved focus on failure and passed it to the first article on success, without duplicate or article fetches.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
