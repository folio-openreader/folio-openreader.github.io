"""Reader AI settings preserve the original library return and browser history."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
BOOK="starter-squirrel-nutkin"


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path=chromium,args=["--disable-dev-shm-usage"])
        ctx=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                                reduced_motion="reduce",service_workers="block")
        external=[]
        def route(r):
            if r.request.url.startswith((origin+"/","blob:","data:")):
                return r.continue_()
            external.append(r.request.url)
            return r.abort()
        ctx.route("**/*",route)
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
            readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=ctx.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator(f'[data-starter-book="{BOOK}"]').tap()
        title=p.locator("#book-title")
        expect(title).to_have_text("The Tale of Squirrel Nutkin")
        p.locator("#paragraph-0 [data-word]").first.tap()
        p.locator("#word-ai-entry").tap()
        expect(p).to_have_url(origin+"/app.html#profile/ai")
        expect(p.locator("#byok-heading")).to_be_focused()
        expect(p.locator("dialog[open]")).to_have_count(0)
        return_link=p.locator("#byok-return-reader")
        expect(return_link).to_be_visible()
        return_link.press("Enter")
        expect(p).to_have_url(origin+f"/app.html#read/{BOOK}")
        expect(title).to_have_text("The Tale of Squirrel Nutkin")
        expect(p.locator("#reading-scroll")).to_be_focused()
        p.locator("#reader-back").tap()
        expect(p.locator("#library-view")).to_be_visible(timeout=1600)
        expect(p).to_have_url(origin+"/app.html#library")
        p.evaluate("history.forward()")
        expect(p).to_have_url(origin+f"/app.html#read/{BOOK}")
        p.evaluate("history.forward()")
        expect(p).to_have_url(origin+"/app.html#profile/ai")
        expect(return_link).to_be_visible()
        p.locator("[data-profile-up]:visible").tap()
        expect(p).to_have_url(origin+"/app.html#profile")
        p.locator("[data-profile-open=ai]").tap()
        expect(p).to_have_url(origin+"/app.html#profile/ai")
        expect(return_link).to_be_hidden()

        other=ctx.new_page()
        other.goto(origin+"/app.html#profile/ai")
        other.locator("#folio-boot").wait_for(state="detached")
        expect(other.locator("#byok-return-reader")).to_be_hidden()
        assert not external,external
        assert not errors,errors
        print("Reader-origin AI settings return without duplicating history or losing the library; direct settings do not invent a reader.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
