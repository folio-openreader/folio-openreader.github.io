"""Regression: a real TXT import survives fresh reader DOM and browser process.

python tests/reader-cold-resume-browser.py dist [--chromium /path/to/chromium]
Uses Playwright and a disposable profile, local content only. No production data.
"""
import argparse
from contextlib import contextmanager
from pathlib import Path
import runpy
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright, expect

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT = "\n\n".join(
    f"Paragraph {i}. The river enters the sea; the travellers along the shore "
    "watched the changing light and waited for the ferry." for i in range(1, 31)
)
METRICS = """() => {
  const scroll = document.querySelector('#reading-scroll').getBoundingClientRect();
  const rows = [...document.querySelectorAll('.reading-paragraph')];
  return {
    first: rows.findIndex(row => row.getBoundingClientRect().bottom > scroll.top + 22),
    offset: rows[11].getBoundingClientRect().top - scroll.top,
    active: rows.findIndex(row => row.classList.contains('active'))
  };
}"""


def run(dist, executable):
    errors = []
    with TemporaryDirectory(prefix="folio-reader-") as profile, serve(dist) as origin, sync_playwright() as pw:
        @contextmanager
        def launch():
            ctx = pw.chromium.launch_persistent_context(
                profile, headless=True, executable_path=executable,
                viewport={"width": 390, "height": 844}, device_scale_factor=2,
                has_touch=True, is_mobile=True, service_workers="block",
                args=["--disable-dev-shm-usage"])
            ctx.route("**/*", lambda route: route.continue_()
                      if route.request.url.startswith((origin + "/", "blob:", "data:")) else route.abort())
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.set_default_timeout(12000)
            page.on("pageerror", lambda error: errors.append(str(error)))
            try:
                yield page
            finally:
                ctx.close()

        def measure(page):
            expect(page.locator("#book-title")).to_have_text("River test")
            page.locator("#paragraph-11").wait_for(state="attached")
            page.evaluate("document.fonts.ready")
            # Let viewport materialization, word hydration and the debounced save settle.
            page.wait_for_timeout(650)
            return page.evaluate(METRICS)

        with launch() as page:
            page.goto(origin + "/app.html#home")
            page.locator("#folio-boot").wait_for(state="detached")
            page.locator("[data-lang-continue]").first.click()
            page.locator("[data-view=library]:visible").first.click()
            page.locator("#import-open").click()
            page.locator("#original-file").set_input_files(
                {"name": "River test.txt", "mimeType": "text/plain", "buffer": TEXT.encode()})
            page.locator("#preview-import").click()
            page.locator("#save-import").click()
            page.locator("#paragraph-11").wait_for(state="attached")
            page.evaluate("document.fonts.ready")
            page.wait_for_timeout(250)
            page.evaluate("""() => {
              const sc = document.querySelector('#reading-scroll');
              sc.scrollTop += document.querySelector('#paragraph-11').getBoundingClientRect().top
                              - sc.getBoundingClientRect().top - 24;
            }""")
            expect(page.locator("#reading-progress")).to_contain_text("абзац 12 / 30")
            expected = measure(page)
            assert expected["first"] == expected["active"] == 11, expected
            reader_url = page.url

        for entry in ("continue card", "direct reader link"):
            with launch() as page:
                page.goto(origin + "/app.html#home" if entry == "continue card" else reader_url)
                page.locator("#folio-boot").wait_for(state="detached")
                if entry == "continue card":
                    card = page.locator("#continue-card button")
                    expect(card).to_contain_text("River test")
                    card.click()
                actual = measure(page)
                assert actual["first"] == actual["active"] == expected["first"], (entry, expected, actual)
                assert abs(actual["offset"] - expected["offset"]) <= 2, (entry, expected, actual)
                print(f"{entry}: paragraph 12, offset {actual['offset']:.2f}px (baseline {expected['offset']:.2f}px)")
        assert not errors, errors


if __name__ == "__main__":
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument("dist", type=Path)
    args.add_argument("--chromium", default=None)
    options = args.parse_args()
    run(options.dist.resolve(), options.chromium)
