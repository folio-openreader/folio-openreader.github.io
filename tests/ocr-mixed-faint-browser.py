"""Automatic OCR should find a light raster caption beside real native PDF text."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import expect, sync_playwright
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
CAPTION = "Follow the river."
HEAD = "Native text remains available."
CONTROL = "A white picture does not need recognition."
GRAY = "A uniform tinted picture is not text."


def fixture():
    content = BytesIO()
    pdf = Canvas(content, pagesize=(500,350), invariant=1)
    white = Image.new("RGB", (1000,380), "white")
    faint = white.copy()
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 56)
    ImageDraw.Draw(faint).text((65,150), CAPTION, fill=(205,205,205), font=font)
    uniform = Image.new("RGB", (1000,380), (213,213,213))
    for image, title in ((faint, HEAD), (white, CONTROL), (uniform, GRAY)):
        pdf.setFont("Helvetica",18)
        pdf.drawString(45,308,title)
        pdf.drawImage(ImageReader(image),40,35,width=420,height=160)
        pdf.showPage()
    pdf.save()
    return content.getvalue()


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,service_workers="block")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""
          window.fixtureJobs=0;
          const Original=window.Worker;
          window.Worker=class extends Original{
            constructor(url,...args){super(url,...args);this.fixtureOCR=String(url).endsWith('/ocr-v1/worker.min.js')}
            postMessage(data,...args){if(this.fixtureOCR&&data.action==='recognize')fixtureJobs++;return super.postMessage(data,...args)}
          };
        """)
        p=c.new_page()
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files({"name":"Mixed captions.pdf","mimeType":"application/pdf","buffer":fixture()})
        p.locator("#preview-import").click()
        preview=p.locator("#import-preview")
        expect(preview).to_be_visible(timeout=25000)
        assert p.evaluate("window.fixtureJobs")==1, ("automatic OCR jobs",p.evaluate("window.fixtureJobs"))
        expect(preview.locator(".ocr-review")).to_contain_text(CAPTION)
        p.locator("#save-import").click()
        expect(p.locator("#passage .reading-paragraph")).to_have_text([HEAD,CAPTION])
        p.locator("#next-chapter").click()
        expect(p.locator("#passage .reading-paragraph")).to_have_text([CONTROL])
        p.locator("#next-chapter").click()
        expect(p.locator("#passage .reading-paragraph")).to_have_text([GRAY])
        assert not errors,errors
        print("Automatic local OCR recovered a light caption on a mixed PDF; white and uniformly tinted images did not trigger additional jobs.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
