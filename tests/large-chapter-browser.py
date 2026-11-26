"""Reader Back gets an event-loop turn during construction of a very large chapter."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
ROWS = 5000
TEXT = "\n\n".join(f"Paragraph {i}. The ferry crossed the water just after dawn." for i in range(1, ROWS + 1))


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                          has_touch=True, service_workers="block")
        c.route("**/*", lambda r: r.continue_()
                if r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        c.add_init_script("""(() => {
          const Base=window.IntersectionObserver;
          window.fixtureRows=0;window.fixtureBackAt=null;window.fixtureArmed=true;
          window.IntersectionObserver=class extends Base {
            observe(target){
              if(target.classList.contains('reading-paragraph')){
                window.fixtureRows++;
                if(window.fixtureArmed){
                  window.fixtureArmed=false;
                  // Queue the normal Back control as construction starts.
                  setTimeout(()=>{
                    window.fixtureBackAt=window.fixtureRows;
                    document.querySelector('#reader-back').click();
                  },0);
                }
              }
              return super.observe(target);
            }
          };
        })()""")
        p = c.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files({"name":"Large reader fixture.txt",
            "mimeType":"text/plain","buffer":TEXT.encode("utf-8")})
        p.locator("#preview-import").click()
        expect(p.locator("#import-preview")).to_contain_text(f"Абзацев: {ROWS}")
        p.locator("#save-import").click()
        p.wait_for_function("window.fixtureBackAt!==null")
        at_back = p.evaluate("window.fixtureBackAt")
        assert 0 < at_back < ROWS, f"Back waited until {at_back} of {ROWS} rows were built"
        expect(p.locator("#reader")).to_be_hidden()
        p.wait_for_timeout(150)
        assert p.evaluate("window.fixtureRows") == at_back, "A closed reader kept constructing stale rows"
        p.locator("[data-view=home]:visible").first.click()
        p.locator("#continue-card button").click()
        expect(p.locator("#book-title")).to_have_text("Large reader fixture")
        expect(p.locator("#passage .reading-paragraph")).to_have_count(ROWS, timeout=16000)
        expect(p.locator("#paragraph-0.active")).to_be_attached()
        expect(p.locator("#paragraph-4999")).to_have_text("Paragraph 5000. The ferry crossed the water just after dawn.")
        assert not errors, errors
        print(f"Back acted after {at_back}/{ROWS} rows; stale build stopped; reopen displayed all {ROWS}.")
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
