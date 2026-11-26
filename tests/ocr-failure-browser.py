"""Exercise local PDF import when the OCR worker fails after initialization.
Requires Playwright, Pillow and ReportLab. Neither PDF nor worker fixture leaves loopback.
"""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from PIL import Image, ImageDraw
from playwright.sync_api import expect, sync_playwright
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
OCR_WORKER = """
self.onmessage = ({data}) => {
  const {jobId,action}=data;
  self.postMessage({jobId,status:action==='recognize'?'reject':'resolve',data:{}});
};"""


def fixture(mixed):
    stream = BytesIO()
    pdf = Canvas(stream, pagesize=(500, 360), invariant=1)
    bitmap = Image.new("RGB", (800, 440), "white")
    draw = ImageDraw.Draw(bitmap)
    for y in (60, 130, 200, 270, 340):
        for x in range(100, 680, 28):
            draw.rectangle((x, y, x + 16, y + 28), fill="black")
    if mixed:
        pdf.setFont("Helvetica", 18)
        pdf.drawString(40, 315, "Native text before the failed recognition.")
    pdf.drawImage(ImageReader(bitmap), 45, 38, 410, 220)
    pdf.showPage()
    if mixed:
        pdf.setFont("Helvetica", 18)
        pdf.drawString(40, 315, "Native text after the failed recognition.")
        pdf.showPage()
    pdf.save()
    return stream.getvalue()


def run(dist, chromium, mixed):
    with serve(dist) as origin, sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                has_touch=True, service_workers="block")
        requests = []
        def route(req):
            url = req.request.url
            if url == origin + "/vendor/ocr-v1/worker.min.js":
                requests.append(url)
                return req.fulfill(content_type="application/javascript", body=OCR_WORKER)
            if url.startswith((origin + "/", "data:", "blob:")):
                return req.continue_()
            return req.abort()
        c.route("**/*", route)
        page = c.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.set_default_timeout(10000)
        page.goto(origin + "/app.html#library")
        page.locator("#folio-boot").wait_for(state="detached")
        page.locator("[data-lang-continue]").first.click()
        page.locator("#import-open").click()
        page.locator("#original-file").set_input_files(
            {"name": "OCR recovery fixture.pdf", "mimeType": "application/pdf", "buffer": fixture(mixed)})
        page.locator("#preview-import").click()
        if mixed:
            preview = page.locator("#import-preview")
            expect(preview).to_be_visible()
            expect(preview).to_contain_text("Распознавание прервалось на странице 1")
            expect(preview).to_contain_text("Native text before the failed recognition.")
            expect(preview).to_contain_text("Native text after the failed recognition.")
            # A degraded parse is useful for this preview, but must not
            # satisfy the next request without attempting recognition again.
            page.locator("#preview-import").click()
            expect(preview).to_be_visible()
            expect(preview).to_contain_text("Распознавание прервалось на странице 1")
            page.locator("#save-import").click()
            expect(page.locator("#chapter-title")).to_have_text("1 / 2 · Страница 1")
            expect(page.locator("#paragraph-0")).to_have_text("Native text before the failed recognition.")
            page.locator("#next-chapter").click()
            expect(page.locator("#paragraph-0")).to_have_text("Native text after the failed recognition.")
        else:
            expect(page.locator("#import-status")).to_contain_text("Не удалось обработать страницу локальным OCR")
            expect(page.locator("#retry-ocr")).to_be_visible()
            expect(page.locator("#import-preview")).to_be_hidden()
            expect(page.locator("#save-import")).to_be_hidden()
        assert len(requests) == (2 if mixed else 1), requests
        assert not errors, errors
        print(("mixed PDF preserved both readable pages" if mixed else "scan-only PDF remains an explicit OCR error"))
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    parser.add_argument("--only", choices=("mixed", "scan"))
    a = parser.parse_args()
    for mixed in ((a.only == "mixed",) if a.only else (True, False)):
        run(a.dist.resolve(), a.chromium, mixed)
