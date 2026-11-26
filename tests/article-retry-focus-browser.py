"""Keyboard focus stays on a science article during loading and a failed retry."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width":980,"height":760}, service_workers="block")
        pending = []
        attempts = []
        def route(r):
            url = r.request.url
            if url.startswith(origin + "/research/papers/"):
                attempts.append(url)
                if len(attempts) == 1:
                    pending.append(r)
                    return
            return r.continue_() if url.startswith((origin+"/","blob:","data:")) else r.abort()
        c.route("**/*", route)
        p = c.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("[data-catalog=research]").click()
        card=p.locator("#research-catalog .research-open").first
        expect(card).to_be_visible()
        title=card.locator("strong").text_content()
        card.focus()
        p.keyboard.press("Enter")
        expect(card).to_have_attribute("aria-busy","true")
        try:
            expect(card).to_be_focused(timeout=1500)
            expect(card).to_have_attribute("aria-disabled","true")
            p.keyboard.press("Enter")
            p.wait_for_timeout(100)
            assert len(pending)==1 and len(attempts)==1, attempts
        finally:
            if pending:
                pending.pop().abort()
        expect(p.locator("#research-catalog [role=status]")).to_contain_text("Не удалось открыть")
        expect(card).to_be_focused()
        expect(card).not_to_have_attribute("aria-disabled","true")
        expect(card).to_have_attribute("aria-label","Читать: "+title)
        p.keyboard.press("Enter")
        expect(p.locator("#book-title")).to_have_text(title)
        assert len(attempts)==2, attempts
        p.locator("#reader-back").press("Enter")
        expect(card).to_be_visible()
        expect(card).to_be_focused()
        assert not errors, errors
        print("Article focus survived pending and failed request; repeat Enter deduped; keyboard retry and reader return worked.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
