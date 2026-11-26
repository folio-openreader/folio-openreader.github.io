"""Read and resume two local books in simultaneously open tabs."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT = "\n\n".join(f"Paragraph {i}. The shore is quiet while the ferry pulls away and the passengers watch the deep water." for i in range(1, 31))


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                      has_touch=True, service_workers="block")
        context.route("**/*", lambda r: r.continue_()
                      if r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        errors = []
        def page():
            p = context.new_page()
            p.set_default_timeout(12000)
            p.on("pageerror", lambda e: errors.append(str(e)))
            p.goto(origin + "/app.html#library")
            p.locator("#folio-boot").wait_for(state="detached")
            return p

        def pick(p, title):
            p.locator("[data-view=home]:visible").first.click()
            p.locator(".book-open").filter(has_text=title).click()
            expect(p.locator("#book-title")).to_have_text(title)
            p.locator("#paragraph-0").wait_for(state="attached")
            p.evaluate("document.fonts.ready")

        def read(p, row):
            p.bring_to_front()
            p.evaluate("""(row) => {
                const sc = document.querySelector('#reading-scroll');
                const paragraph = document.querySelector('#paragraph-' + row);
                sc.scrollTop += paragraph.getBoundingClientRect().top - sc.getBoundingClientRect().top - 24;
            }""", row)
            expect(p.locator("#reading-progress")).to_contain_text(f"абзац {row + 1} / 30")
            p.locator("#reader-back").click()
            expect(p.locator("#reader")).to_be_hidden()

        setup = page()
        setup.locator("[data-lang-continue]").first.click()
        for title in ("First fixture", "Second fixture"):
            setup.locator("#import-open").click()
            setup.locator("#original-file").set_input_files({"name": title + ".txt",
                "mimeType": "text/plain", "buffer": TEXT.encode("utf-8")})
            setup.locator("#preview-import").click()
            setup.locator("#save-import").click()
            expect(setup.locator("#book-title")).to_have_text(title)
            setup.locator("#reader-back").click()
            expect(setup.locator("#reader")).to_be_hidden()
        setup.close()

        a, b = page(), page()
        pick(a, "First fixture")
        pick(b, "Second fixture")
        read(a, 11)
        read(b, 17)
        a.close()
        b.close()

        for title, row in (("First fixture", 11), ("Second fixture", 17)):
            check = page()
            pick(check, title)
            expect(check.locator("#reading-progress")).to_contain_text(f"абзац {row + 1} / 30")
            expect(check.locator(f"#paragraph-{row}.active")).to_be_attached()
            check.close()

        assert not errors, errors
        print("Independent book checkpoints survived two simultaneous tabs and actual shelf reopen.")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
