"""A discretionary hyphen does not split a word or poison its dictionary key."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
WORD = "lan\u00adtern"
TEXT = "Mara lit the " + WORD + " at dawn and put the lantern beside the gate."


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width":390,"height":844}, is_mobile=True,
                          has_touch=True, service_workers="block")
        c.route("**/*", lambda r: r.continue_() if
                r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        p=c.new_page()
        errors=[]
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files({"name":"Hyphen fixture.txt","mimeType":"text/plain","buffer":TEXT.encode()})
        p.locator("#preview-import").click()
        expect(p.locator("#import-preview")).to_be_visible()
        p.locator("#save-import").click()
        row=p.locator("#paragraph-0")
        expect(row).to_have_text(TEXT)
        expect(row.locator(".word").first).to_be_visible()
        keys=row.locator(".word").evaluate_all("items => items.map(i => i.dataset.word)")
        assert keys.count("lantern")==2 and "lan" not in keys and "tern" not in keys, keys
        first=row.locator(".word[data-word=lantern]").first
        first.tap()
        expect(p.locator(".word-lookup")).to_contain_text("фонарь")
        expect(p.locator("#word-save")).to_have_attribute("aria-pressed","true")
        p.locator("#word-context-toggle").click()
        context=p.locator("#word-context .word-original")
        expect(context).to_have_text(TEXT)
        expect(context.locator("mark")).to_have_text(WORD)
        p.keyboard.press("Escape")
        expect(p.locator("#word-dialog")).to_be_hidden()
        p.locator("#reader-back").click()
        p.locator("[data-view=words]:visible").first.click()
        words=p.locator("#saved-list .saved-row strong")
        expect(words).to_have_count(1)
        expect(words.first).to_have_text("lantern")
        assert not errors, errors
        print("Imported soft-hyphen word uses normal dictionary entry, exact context highlight, and one canonical saved word.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
