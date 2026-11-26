"""Comic reading position regression through the actual import and reader UI.

Requires Playwright and Chromium. Creates a synthetic PNG in memory. Only OCR
inference is replaced by deterministic fixture text; all app/DB/reader code runs.
"""
from argparse import ArgumentParser
from pathlib import Path
from struct import pack
import runpy
import zlib

from playwright.sync_api import sync_playwright, expect

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def tall_panel():
    width, height = 720, 6000
    def chunk(tag, data):
        return pack(">I", len(data)) + tag + data + pack(">I", zlib.crc32(tag + data))
    rows = b"".join((b"\0" + bytes((35 + stripe * 5, 55 + stripe * 7, 95 + stripe * 6)) * width) * 300
                    for stripe in range(20))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)) + \
        chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


OCR = """export async function recognizeComicPage() {
    return {paragraphs: [{text: 'This transcript intentionally pushes the comic image down. '.repeat(42)}], words: []};
}"""
MEASURE = """() => {
    const sc = document.querySelector('#reading-scroll');
    const frame = document.querySelector('.comic-frame').getBoundingClientRect();
    const bar = document.querySelector('.comic-bar');
    const top = sc.getBoundingClientRect().top + bar.offsetHeight;
    return {offset: Math.max(0, top - frame.top), toEnd: sc.scrollHeight - sc.clientHeight - sc.scrollTop};
}"""


def run(dist, chromium, scenario):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                  has_touch=True, service_workers="block")
        def fence(route):
            url = route.request.url
            if url == origin + "/comic-ocr.js":
                return route.fulfill(content_type="text/javascript", body=OCR)
            if url.startswith((origin + "/", "blob:", "data:")):
                return route.continue_()
            return route.abort()
        ctx.route("**/*", fence)
        p = ctx.new_page()
        p.set_default_timeout(12000)
        errors = []
        p.on("pageerror", lambda error: errors.append(str(error)))
        p.goto(origin + "/app.html#home")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("[data-view=library]:visible").first.click()
        p.locator("#comic-import-open").click()
        p.locator("#comic-files").set_input_files([
            {"name": name, "mimeType": "image/png", "buffer": tall_panel()}
            for name in ("01.png", "02.png")
        ])
        p.locator("#comic-import-start").click()
        p.locator(".comic-art").wait_for(state="visible")
        p.locator(".comic-next").click()
        expect(p.locator("#chapter-title")).to_have_text("Страница 2 из 2")
        p.wait_for_function("document.querySelector('.comic-art')?.alt === 'Страница 2'")
        if scenario == "transcript":
            p.locator(".comic-scan").click()
            toggle = p.locator(".comic-text-toggle")
            expect(toggle).to_be_visible()
            toggle.click()
            expect(toggle).to_have_attribute("aria-expanded", "true")
            p.evaluate("document.querySelector('#reading-scroll').scrollTop = 1770")
        else:
            p.evaluate("const sc = document.querySelector('#reading-scroll'); sc.scrollTop = sc.scrollHeight")
        p.wait_for_timeout(220)
        expected = p.evaluate(MEASURE)
        if scenario == "bottom":
            assert expected["toEnd"] <= 1, expected
        # Exit via reader's actual back button, then start a fresh browser tab.
        # Also exercises the no-scroll-event / no-debounce path below.
        p.locator("#reader-back").click()
        expect(p.locator("#reader")).to_be_hidden()
        p.close()
        p = ctx.new_page()
        p.on("pageerror", lambda error: errors.append(str(error)))
        p.goto(origin + "/app.html#home")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#continue-card button").click()
        expect(p.locator("#chapter-title")).to_have_text("Страница 2 из 2")
        p.wait_for_function("document.querySelector('.comic-art')?.naturalHeight === 6000")
        p.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        actual = p.evaluate(MEASURE)
        if scenario == "bottom":
            assert actual["toEnd"] <= 1, (expected, actual)
        else:
            expect(p.locator(".comic-text-toggle")).to_have_attribute("aria-expanded", "false")
            assert abs(expected["offset"] - actual["offset"]) <= 2, (expected, actual)
            # Scroll and click Back synchronously, before debounced save. Explicit
            # navigation must still checkpoint the new image location.
            shifted = p.evaluate("""() => {
                document.querySelector('#reading-scroll').scrollTop += 300;
                const measurement = (""" + MEASURE + """)();
                document.querySelector('#reader-back').click();
                return measurement;
            }""")
            p.goto(origin + "/app.html#home")
            p.locator("#folio-boot").wait_for(state="detached")
            p.locator("#continue-card button").click()
            p.wait_for_function("document.querySelector('.comic-art')?.naturalHeight === 6000")
            p.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
            immediate = p.evaluate(MEASURE)
            assert abs(shifted["offset"] - immediate["offset"]) <= 2, (shifted, immediate)
        assert not errors, errors
        print(scenario + ": reopened on page 2; artwork anchor and page-end preserved",
              expected, actual)
        browser.close()


if __name__ == "__main__":
    args = ArgumentParser(description=__doc__)
    args.add_argument("dist", type=Path)
    args.add_argument("--chromium", default=None)
    args.add_argument("--scenario", choices=("bottom", "transcript"))
    options = args.parse_args()
    for scenario in (options.scenario,) if options.scenario else ("bottom", "transcript"):
        run(options.dist.resolve(), options.chromium, scenario)
