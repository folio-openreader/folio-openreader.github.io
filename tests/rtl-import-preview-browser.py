"""Paired-file import preview isolates each passage's direction and language."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
fixtures = runpy.run_path(str(Path(__file__).with_name("rtl-reader-sheets-browser.py")))
epub = fixtures["epub"]
ARABIC = fixtures["ARABIC"]
ENGLISH = fixtures["ENGLISH"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True,
                                     args=["--disable-dev-shm-usage"])
        ctx = browser.new_context(viewport={"width":320,"height":640}, is_mobile=True, has_touch=True,
                                  reduced_motion="reduce", service_workers="block")
        ctx.route("**/*", lambda r: r.continue_() if
                  r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        ctx.add_init_script("""localStorage.setItem('folio-v2', JSON.stringify({prefs:{
            readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        errors = []
        p = ctx.new_page()
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.set_default_timeout(6500)
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        ar = ("دفتر 2026", "ar", ARABIC)
        en = ("Road notes", "en", ENGLISH)

        for original, parallel in ((ar,en), (en,ar)):
            p.locator("#import-open").tap()
            for field, item in (("original",original), ("translation",parallel)):
                p.locator(f"#{field}-file").set_input_files({"name":f"{field}.epub",
                    "mimeType":"application/epub+zip","buffer":epub(*item)})
            p.locator("#preview-import").tap()
            pane = p.locator("#import-preview")
            expect(pane).to_be_visible()
            pair = pane.locator(".preview-pair").first
            for passage, (title,lang,text) in ((pair.locator("p").first,original),
                                                (pair.locator(".translation-preview"),parallel)):
                expect(passage).to_have_text(text)
                expect(passage).to_have_css("direction", "rtl" if lang=="ar" else "ltr",timeout=1600)
                expect(passage).to_have_attribute("lang",lang)
            expect(pane.get_by_role("heading",name=original[0])).to_have_css(
                "direction", "rtl" if original[1]=="ar" else "ltr")
            expect(pair.locator("small")).to_have_css("direction","ltr")
            expect(p.locator("#import-status")).to_have_css("direction","ltr")
            p.locator("#alignment-check").check()
            p.locator("#save-import").tap()
            expect(p.locator("#book-title")).to_have_text(original[0])
            p.locator("#reader-back").tap()
            expect(p).to_have_url(origin + "/app.html#library")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"unknown.epub", "mimeType":"application/epub+zip",
            "buffer":epub("Notes", "und", "A small excerpt without language metadata.")})
        p.locator("#preview-import").tap()
        pane = p.locator("#import-preview")
        pick = pane.get_by_label("Язык оригинала (не указан в файле)")
        pick.select_option("fr")
        expect(pane.locator(".preview-pair p")).to_have_attribute("lang", "fr")
        expect(pane.locator("h3")).to_have_attribute("lang", "fr")
        assert not errors, errors
        print("320px import: Arabic and English preview passages kept independent direction and language in both pair orders.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
