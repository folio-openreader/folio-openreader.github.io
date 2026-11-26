"""Import a static WebP through the book picker and run real local OCR."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def frame(text):
    im = Image.new("RGB", (900, 260), "white")
    ImageDraw.Draw(im).text((50, 82), text, fill="black", font=ImageFont.truetype(FONT, 52))
    return im


def fixture(animated=False):
    content = BytesIO()
    image = frame("Follow the river.")
    if animated:
        image.save(content, "WEBP", save_all=True, append_images=[frame("Watch the boat.")],
                   duration=150, loop=0, lossless=True)
    else:
        image.save(content, "WEBP", lossless=True)
    return content.getvalue()


def run(dist, chromium, without_bitmap=False):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                      has_touch=True, service_workers="block")
        if without_bitmap:
            context.add_init_script("Object.defineProperty(window,'createImageBitmap',{value:undefined});")
        launches = []
        def route(r):
            url = r.request.url
            if url.startswith(origin + "/vendor/ocr-v1/worker.min.js"): launches.append(url)
            if url.startswith((origin + "/", "blob:", "data:")):
                return r.continue_()
            return r.abort()
        context.route("**/*", route)
        p = context.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        picker = p.locator("#original-file")
        for animated in (True, False):
            picker.set_input_files({"name":"River scan.webp", "mimeType":"image/webp", "buffer":fixture(animated)})
            expect(p.locator("#original-file-label")).to_contain_text("River scan.webp")
            p.locator("#preview-import").click()
            if animated:
                expect(p.locator("#import-status")).to_contain_text("Анимированный WebP")
                expect(p.locator("#import-preview")).to_be_hidden()
                assert not launches, launches
            else:
                p.wait_for_function("""() => ['ready','error'].includes(document.querySelector('#import-status').dataset.state)""",
                                    timeout=25000)
                expect(p.locator("#import-status")).to_have_attribute("data-state","ready")
                expect(p.locator("#import-preview .ocr-review")).to_contain_text("Follow the river.")
                p.locator("#save-import").click()
                expect(p.locator("#book-title")).to_have_text("River scan")
                expect(p.locator("#paragraph-0")).to_have_text("Follow the river.")
                assert len(launches) == 1, launches
        assert not errors, errors
        print("Real WebP scan OCR succeeded " + ("without createImageBitmap" if without_bitmap else "with native bitmap") +
              "; animated WebP rejected before the OCR worker.")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    parser.add_argument("--without-bitmap", action="store_true")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium, a.without_bitmap)
