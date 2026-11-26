"""Tagged Simplified and Traditional EPUBs make each Chinese word selectable."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("rtl-reader-sheets-browser.py")))
serve, epub=fixture["serve"],fixture["epub"]
BOOKS=[
    ("zh-Hans","📚今天我们去公园。明天我们还去公园。 Jean-Luc","今天","公园"),
    ("zh-Hant","📚我們明天去公園。後天我們再去公園。 Jean-Luc","我們","公園"),
]


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        service_workers="block",reduced_motion="reduce")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        for lang,text,first,token in BOOKS:
            p.locator("#import-open").tap()
            p.locator("#original-file").set_input_files({"name":lang+".epub",
                "mimeType":"application/epub+zip","buffer":epub("Chinese fixture "+lang,lang,text)})
            p.locator("#preview-import").tap()
            p.locator("#save-import").tap()
            row=p.locator("#paragraph-0")
            expect(row).to_have_attribute("lang",lang)
            expect(row).to_have_text(text)
            words=row.locator("button.word")
            expect(words.first).to_have_text(first,timeout=1800)
            expect(words.last).to_have_text("Jean-Luc")
            assert row.locator("button.word[tabindex='0']").count()==1
            words.first.press("ArrowRight")
            expect(words.nth(1)).to_be_focused()
            targets=row.get_by_role("button",name=token,exact=True)
            expect(targets).to_have_count(2)
            last=targets.last
            offset=len(text[:text.rindex(token)].encode("utf-16-le"))//2
            expect(last).to_have_attribute("data-offset",str(offset))
            last.tap()
            expect(p.locator("#word-sheet-heading")).to_have_text(token)
            p.locator("#word-context-toggle").tap()
            excerpt=p.locator("#word-context .word-original")
            expect(excerpt).to_have_text(text)
            expect(excerpt.locator("mark")).to_have_text(token)
            assert excerpt.locator("mark").evaluate("el=>el.nextSibling.textContent")=="。 Jean-Luc"
            p.locator("#word-dialog [data-sheet-handle]").tap()
            p.locator("#reader-back").tap()
            expect(p).to_have_url(origin+"/app.html#library")
        assert not errors,errors
        print("Tagged Simplified and Traditional EPUB: individual word controls, exact repeated-word highlights, native keyboard navigation and unchanged Latin phrases.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
