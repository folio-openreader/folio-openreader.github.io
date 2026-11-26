"""A transient module download failure does not disable dictionaries for the tab."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from urllib.parse import urlsplit
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True,
                                     args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                                  reduced_motion="reduce", service_workers="block")
        blocked = True
        loads, packs = [], []
        def fence(route):
            url = route.request.url
            path = urlsplit(url).path
            if path.startswith("/packs/") and path != "/packs/catalog.js":
                packs.append(url)
                return route.abort()
            if path == "/lexicon.js":
                loads.append(url)
                if blocked:
                    return route.abort()
            if url.startswith((origin + "/", "blob:", "data:")):
                return route.continue_()
            return route.abort()
        ctx.route("**/*",fence)
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
            readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          window.fixtureOnline = 0;
          window.addEventListener('online', () => fixtureOnline++);
        """)
        p = ctx.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#profile/dictionaries")
        p.locator("#folio-boot").wait_for(state="detached")
        status = p.locator("#dictionary-status")
        field = p.locator("#dictionary-target")
        expect(status).to_contain_text("Модуль словарей недоступен")
        expect(field).to_be_disabled()
        assert loads == [origin + "/lexicon.js"],loads

        ctx.set_offline(True)
        blocked = False
        ctx.set_offline(False)
        p.wait_for_function("fixtureOnline===1")
        expect(field).to_be_enabled(timeout=2200)
        expect(status).to_have_text("")
        assert len(loads)==2 and loads[0]!=loads[1],loads

        # Once the module actually loads, navigation and lookup reuse it.
        p.locator("[data-view=home]:visible").first.tap()
        p.locator("#continue-card button").tap()
        p.locator("#paragraph-0").get_by_role("button",name="lantern",exact=True).tap()
        expect(p.locator(".word-lookup")).to_contain_text("фонарь")
        assert len(loads)==2,loads
        assert not packs,packs
        assert not errors,errors
        print("One failed dictionary module request recovered on browser reconnect without reload, duplicate loads, or a pack download.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
