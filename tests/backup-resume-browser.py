"""Verify Continue reading after restoring a local backup on a clean profile."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT = "\n\n".join(f"Paragraph {i}. The river is quiet while the departing ferry passes the empty pier." for i in range(1, 31))


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        errors = []

        def profile():
            c = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                    has_touch=True, service_workers="block", accept_downloads=True)
            c.route("**/*", lambda r: r.continue_()
                        if r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
            tab = c.new_page()
            tab.on("pageerror", lambda e: errors.append(str(e)))
            tab.goto(origin + "/app.html#library")
            tab.locator("#folio-boot").wait_for(state="detached")
            tab.locator("[data-lang-continue]").first.click()
            return tab

        def import_book(tab, title):
            tab.locator("#import-open").click()
            tab.locator("#original-file").set_input_files({"name": title + ".txt",
                "mimeType": "text/plain", "buffer": TEXT.encode("utf-8")})
            tab.locator("#preview-import").click()
            tab.locator("#save-import").click()
            expect(tab.locator("#book-title")).to_have_text(title)

        def backups(tab):
            tab.goto(origin + "/app.html#profile/backups")
            tab.locator("#folio-boot").wait_for(state="detached")
            expect(tab.locator("#open-backup")).to_be_visible()

        def restore(tab, data):
            backups(tab)
            tab.locator("#open-backup").click()
            tab.locator("#backup-file").set_input_files({"name": "synthetic-backup.json",
                "mimeType": "application/json", "buffer": data})
            tab.locator("#restore-backup").click()
            expect(tab.locator("#backup-dialog")).to_be_hidden()
            expect(tab.locator("#toast")).to_contain_text("Копия восстановлена")
            tab.locator("[data-view=home]:visible").first.click()

        source = profile()
        import_book(source, "Imported river fixture")
        source.locator("#paragraph-11").wait_for(state="attached")
        source.evaluate("document.fonts.ready")
        source.evaluate("""() => {
            const sc = document.querySelector('#reading-scroll'), row = document.querySelector('#paragraph-11');
            sc.scrollTop += row.getBoundingClientRect().top - sc.getBoundingClientRect().top - 24;
        }""")
        expect(source.locator("#reading-progress")).to_contain_text("абзац 12 / 30")
        source.locator("#reader-back").click()
        backups(source)
        with source.expect_download() as download:
            source.locator("#export-backup").click()
        data = Path(download.value.path()).read_bytes()
        assert b"Imported river fixture" in data

        fresh = profile()
        restore(fresh, data)
        fresh.reload()
        fresh.locator("#folio-boot").wait_for(state="detached")
        continue_card = fresh.locator("#continue-card button")
        expect(continue_card).to_contain_text("Imported river fixture")
        continue_card.click()
        expect(fresh.locator("#reading-progress")).to_contain_text("абзац 12 / 30")

        populated = profile()
        import_book(populated, "Existing local fixture")
        populated.locator("#reader-back").click()
        restore(populated, data)
        expect(populated.locator("#continue-card button")).to_contain_text("Existing local fixture")
        expect(populated.locator("#books")).to_contain_text("Imported river fixture")
        assert not errors, errors
        print("Fresh restore resumed synthetic backup at paragraph 12; nonempty profile kept its local book.")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
