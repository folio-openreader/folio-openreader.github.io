"""Missing local reading links must not replace the latest book with the demo."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
UNKNOWN = "book-7d4b43f5-2fb4-4ee4-9837-ce2368ef00d5"


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 390, "height": 844},
                                      is_mobile=True, has_touch=True, service_workers="block")
        context.route("**/*", lambda r: r.continue_()
                      if r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        errors = []

        def open_page(route):
            p = context.new_page()
            p.set_default_timeout(9000)
            p.on("pageerror", lambda e: errors.append(str(e)))
            p.goto(origin + "/app.html" + route)
            p.locator("#folio-boot").wait_for(state="detached")
            return p

        seed = open_page("#library")
        seed.locator("[data-lang-continue]").first.click()
        seed.locator("#import-open").click()
        seed.locator("#original-file").set_input_files({"name": "Kept fixture.txt", "mimeType": "text/plain",
            "buffer": b"The ferry took us across the water.\n\nThe shore was quiet the following day."})
        seed.locator("#preview-import").click()
        seed.locator("#save-import").click()
        expect(seed.locator("#book-title")).to_have_text("Kept fixture")
        correct_link = seed.url
        seed.close()

        for route in ("#read/" + UNKNOWN, "#read/%ZZ"):
            p = open_page(route)
            expect(p.locator("#reader")).to_be_hidden()
            expect(p.locator("#toast")).to_contain_text("Этой книги нет на этом устройстве")
            expect(p.locator("#continue-card button")).to_contain_text("Kept fixture")
            assert p.url.endswith("#home")
            p.locator("#continue-card button").click()
            expect(p.locator("#book-title")).to_have_text("Kept fixture")
            assert p.url == correct_link
            p.close()

        demo = open_page("#read/demo")
        expect(demo.locator("#book-title")).to_have_text("The Night Ferry")
        expect(demo.locator("#reader")).to_be_visible()
        assert demo.url.endswith("#read/folio-night-ferry")
        demo.close()
        catalog = open_page("#read/starter-peter-rabbit")
        expect(catalog.locator("#book-title")).to_have_text("The Tale of Peter Rabbit")
        expect(catalog.locator("#reader")).to_be_visible()
        assert not errors, errors
        print("Unknown and malformed links return to shelf without changing last book; legacy demo link still works.")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
