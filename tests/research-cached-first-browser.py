"""A downloaded science paper is available from its catalog tab without a reachable manifest."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True,args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                          service_workers="block",reduced_motion="reduce")
        manifests, papers, errors = [], [], []
        stalled = False
        def fence(r):
            url = r.request.url
            if url == origin + "/research/manifest.json" and stalled:
                manifests.append(r)
                return
            if url.startswith(origin + "/research/papers/"):
                papers.append(url)
                if stalled:
                    return r.abort()
            return r.continue_() if url.startswith((origin + "/", "blob:", "data:")) else r.abort()
        c.route("**/*", fence)
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
          JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")

        def catalog_page():
            p=c.new_page()
            p.set_default_timeout(6500)
            p.on("pageerror", lambda e: errors.append(str(e)))
            p.goto(origin+"/app.html#library")
            p.locator("#folio-boot").wait_for(state="detached")
            p.locator("[data-catalog=research]").tap()
            return p

        source=catalog_page()
        first=source.locator("#research-catalog .research-open").first
        expect(first).to_be_visible()
        title=first.locator("strong").text_content()
        first.tap()
        expect(source.locator("#book-title")).to_have_text(title)
        body=source.locator("#paragraph-0")
        expect(body).to_be_visible()
        original=body.text_content()
        assert len(papers)==1, papers
        source.close()  # Only the saved browser store survives into the fresh page.

        stalled=True
        fresh=catalog_page()
        shelf=fresh.locator("#research-catalog")
        card=shelf.get_by_role("button",name="Читать: "+title,exact=True)
        try:
            expect(card).to_be_visible(timeout=1700)
            assert manifests, "an actual manifest request must still be pending"
            expect(shelf.locator(".research-open")).to_have_count(1)
            expect(card).to_contain_text("На устройстве")
            manifests.pop().abort()
            expect(shelf.locator('[role="status"]')).to_contain_text("Показан сохранённый список")
            expect(shelf.locator("[data-research-retry]")).to_be_visible()
            card.tap()
            expect(fresh.locator("#book-title")).to_have_text(title)
            expect(fresh.locator("#paragraph-0")).to_have_text(original)
            with fresh.expect_request(origin + "/research/manifest.json"):
                fresh.locator("#reader-back").press("Enter")
            expect(card).to_be_focused()
            assert manifests, "re-entering the shelf retries a failed manifest"
            stalled=False
            manifests.pop().continue_()
            expect(shelf.locator(".research-open")).to_have_count(5)
            expect(card).not_to_contain_text("На устройстве")
            expect(card).to_be_focused()
        finally:
            for request in manifests:
                request.abort()
        assert len(papers)==1 and not errors, (papers,errors)
        print("Saved article visible before manifest resolved and still read locally after failure, with retry visible.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
