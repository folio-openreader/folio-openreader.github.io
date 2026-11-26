"""Local regression for PDF pair alignment. Requires Playwright, reportlab, Chromium."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy

from playwright.sync_api import sync_playwright, expect
from reportlab.pdfgen.canvas import Canvas

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
ORIGINAL = ["Amber original paragraph.", "Birch original paragraph.", "Copper original paragraph."]
PAIRED = ["Amber paired paragraph.", None, "Copper paired paragraph."]


def pdf(lines):
    stream = BytesIO()
    canvas = Canvas(stream, pagesize=(500, 350), invariant=1)
    for line in lines:
        if line:
            canvas.setFont("Helvetica", 18)
            canvas.drawString(50, 210, line)
        canvas.showPage()
    canvas.save()
    return stream.getvalue()


def run(dist, chromium, scenario):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=chromium,
                                     args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 390, "height": 844},
                                      is_mobile=True, has_touch=True, service_workers="block")
        context.route("**/*", lambda route: route.continue_()
                      if route.request.url.startswith((origin + "/", "blob:", "data:"))
                      else route.abort())
        p = context.new_page()
        p.set_default_timeout(16000)
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files(
            {"name": "Original pages.pdf", "mimeType": "application/pdf", "buffer": pdf(ORIGINAL)})
        translation = PAIRED if scenario == "same" else ["Amber paired paragraph.", "Birch paired paragraph.", "Copper paired paragraph.", None]
        p.locator("#translation-file").set_input_files(
            {"name": "Paired pages.pdf", "mimeType": "application/pdf", "buffer": pdf(translation)})
        p.locator("#preview-import").click()
        examples = p.locator("#import-preview .preview-pair")
        expect(examples).to_have_count(3)
        translations = examples.locator(".translation-preview").all_text_contents()
        blank = "Нет сопоставленного перевода"
        expected = ["Amber paired paragraph.", blank, "Copper paired paragraph."] if scenario == "same" else [blank] * 3
        assert translations == expected, (scenario, translations, expected)
        report = p.locator("#import-preview")
        expect(report).to_contain_text("По номерам страниц сопоставлено 2" if scenario == "same"
                                       else "У PDF разное число страниц")
        p.locator("#alignment-check").check()
        p.locator("#save-import").click()
        expect(p.locator("#chapter-title")).to_have_text("1 / 3 · Страница 1")
        if scenario == "same":
            expect(p.locator("#translation-0-0.current")).to_contain_text("Amber paired paragraph.")
            p.locator("#next-chapter").click()
            expect(p.locator("#chapter-title")).to_have_text("2 / 3 · Страница 2")
            expect(p.locator("#translation-1-0.current")).to_contain_text("У этого абзаца нет перевода")
            p.locator("#next-chapter").click()
            expect(p.locator("#translation-2-0.current")).to_contain_text("Copper paired paragraph.")
        else:
            expect(p.locator("#translation-ribbon")).to_contain_text("Нет готового перевода.")
        assert not errors, errors
        print(scenario + ": verified three real PDF pages in import preview and reader")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    parser.add_argument("--scenario", choices=("same", "different"))
    a = parser.parse_args()
    for scenario in (a.scenario,) if a.scenario else ("same", "different"):
        run(a.dist.resolve(), a.chromium, scenario)
