"""Use real local OCR to preview a pair without re-reading an unchanged scan."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

HERE = Path(__file__).parent
serve = runpy.run_path(str(HERE / "sync-browser.py"))["serving"]
scan = runpy.run_path(str(HERE / "webp-ocr-browser.py"))["fixture"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width":390,"height":844}, is_mobile=True,
                          has_touch=True, service_workers="block")
        worker_starts = []
        def route(r):
            url = r.request.url
            if url.startswith(origin + "/vendor/ocr-v1/worker.min.js"):
                worker_starts.append(url)
            return r.continue_() if url.startswith((origin+"/", "blob:", "data:")) else r.abort()
        c.route("**/*", route)
        c.add_init_script("""
          const read=File.prototype.arrayBuffer;
          window.fixtureReads={};
          File.prototype.arrayBuffer=function(...args){
            fixtureReads[this.name]=(fixtureReads[this.name]||0)+1;
            return read.apply(this,args);
          };
        """)
        p = c.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        original=p.locator("#original-file")
        translation=p.locator("#translation-file")
        preview=p.locator("#preview-import")
        status=p.locator("#import-status")
        original.set_input_files({"name":"River scan.webp","mimeType":"image/webp","buffer":scan()})
        translation.set_input_files({"name":"Translation.txt","mimeType":"text/plain","buffer":b"\xff"})
        ocr=p.locator("#ocr-original")
        p.locator("#ocr-panel summary").click()
        ocr.select_option("eng")
        preview.click()
        expect(status).to_contain_text("Не удалось прочитать текст", timeout=25000)
        assert len(worker_starts)==1 and p.evaluate("fixtureReads['River scan.webp']")==1
        translation.set_input_files({"name":"Translation.txt","mimeType":"text/plain","buffer":"Идите вдоль реки.".encode()})
        selected_before=ocr.input_value()
        preview.click()
        expect(p.locator("#import-preview")).to_be_visible(timeout=25000)
        expect(p.locator("#import-preview .ocr-review")).to_contain_text("Follow the river.")
        expect(p.locator("#import-preview .translation-preview")).to_have_text("Идите вдоль реки.")
        reads=p.evaluate("fixtureReads")
        assert reads["River scan.webp"]==1 and len(worker_starts)==1, (reads, len(worker_starts))
        assert selected_before=="eng", selected_before
        # A changed OCR selection invalidates precisely that successful parse.
        p.locator("#ocr-panel").evaluate("x => {x.open=true}")
        ocr.select_option("")
        preview.click()
        expect(p.locator("#import-preview")).to_be_visible(timeout=25000)
        expect(p.locator("#import-preview .ocr-review")).to_contain_text("Follow the river.")
        expect(p.locator("#import-preview .translation-preview")).to_have_text("Идите вдоль реки.")
        reads=p.evaluate("fixtureReads")
        assert reads=={"River scan.webp":2,"Translation.txt":2}, reads
        expect(p.locator("#import-preview")).not_to_have_attribute("aria-busy", "true")
        p.locator("#alignment-check").check()
        p.locator("#save-import").click()
        expect(p.locator("#paragraph-0")).to_have_text("Follow the river.")
        assert not errors, errors
        print("Original OCR ran once through bad/replaced translation; changing original OCR reran only original; pair saved.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
