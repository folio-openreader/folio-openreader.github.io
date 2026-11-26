"""A saved starter book still opens while a different download is stalled."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
CACHED = "starter-squirrel-nutkin"
SLOW = "starter-benjamin-bunny"
TITLE = "The Tale of Squirrel Nutkin"


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(headless=True, executable_path=chromium, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                          has_touch=True, service_workers="block")
        slow_url = origin + "/starter/books/" + SLOW + ".json"
        held, cached_fetches = [], []

        def fence(r):
            url = r.request.url
            if url == slow_url:
                held.append(r)
                return
            if url == origin + "/starter/books/" + CACHED + ".json":
                cached_fetches.append(url)
            if url.startswith((origin + "/", "blob:", "data:")):
                return r.continue_()
            return r.abort()

        c.route("**/*", fence)
        p = c.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        cached = p.locator(f'[data-starter-book="{CACHED}"]')
        slow = p.locator(f'[data-starter-book="{SLOW}"]')
        cached.click()
        expect(p.locator("#book-title")).to_have_text(TITLE)
        expect(p.locator("#reader")).to_be_visible()
        p.locator("#reader-back").click()
        expect(cached).to_have_attribute("title", "Продолжить")
        slow.click()
        expect(slow).to_have_attribute("aria-busy", "true")
        # Waiting on a download must not disable a previously saved title.
        assert cached.is_enabled(), "The pending download disabled the on-device book"
        cached.click()
        expect(p.locator("#reader")).to_be_visible()
        expect(p.locator("#book-title")).to_have_text(TITLE)
        assert len(held) == 1
        with p.expect_response(slow_url):
            held[0].continue_()
        # Deliver the fulfilled request after opening the cached title.
        p.wait_for_timeout(250)
        expect(p.locator("#book-title")).to_have_text(TITLE)
        p.locator("#reader-back").click()
        expect(slow).not_to_have_attribute("aria-busy", "true")
        expect(slow).to_have_attribute("title", "Скачать и читать")
        assert len(cached_fetches) == 1, cached_fetches
        assert not errors, errors
        print("Previously cached book opened without refetch; late download did not change reader or shelf.")
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
