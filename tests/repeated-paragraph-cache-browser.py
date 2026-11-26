"""Audit auto-translate and identical in-book paragraphs across full mobile reloads."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

h=runpy.run_path(str(Path(__file__).with_name("paragraph-cache-browser.py")))
serve,MODEL_MOCK,COUNT_CACHE=(h[n] for n in ("serving","MODEL_MOCK","COUNT_CACHE"))
REPEAT="The current carries whatever falls into the water."
OTHER=("The lighthouse stands above the rocks. A bright beam swings over the evening landscape. "*8).strip()
NEW=("The vessel finally reached the small northern island. "*13).strip()


def run(dist,chromium):
    source=(dist/"local-translation.js").read_text("utf-8")
    adapter=source.replace("export function createLocalTranslator(","function realLocalTranslator(",1)
    adapter+=MODEL_MOCK.replace("{allowNetwork:p.allowNetwork}", "{text,allowNetwork:p.allowNetwork}")
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        external,errors=[],[]
        def route(r):
            u=r.request.url
            if u==origin+"/local-translation.js":
                return r.fulfill(content_type="text/javascript",body=adapter)
            if u.startswith(origin+"/vendor/bergamot/") or not u.startswith((origin+"/","blob:","data:")):
                external.append(u)
                return r.abort()
            return r.continue_()
        c.route("**/*",route)
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
          JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page();p.set_default_timeout(5200)
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Repeating lines.txt","mimeType":"text/plain",
          "buffer":("\n\n".join([REPEAT,OTHER,REPEAT,NEW])).encode()})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        sheet=p.locator("#translation-dialog")
        ribbon=p.locator("#translation-track .translation-empty")
        toggle=p.locator("#local-translation-open")

        def calls():return p.evaluate("window.paragraphModelCalls")
        def cached(n):
            p.wait_for_function(f"async () => (await ({COUNT_CACHE})()) === {n}")
        def select(i):
            p.locator("#reading-scroll").evaluate("""(sc,i)=>{
              const row=sc.querySelector('#paragraph-'+i);
              sc.scrollTop+=row.getBoundingClientRect().top-sc.getBoundingClientRect().top-30;
            }""",i)
            expect(p.locator("#reading-progress")).to_contain_text(f"абзац {i+1} / 4")
            p.wait_for_function("""i=>{
              const state=JSON.parse(localStorage.getItem('folio-v2'));
              return state.positions?.[state.lastBook]?.paragraph===i;
            }""",arg=i)
        def reload_at(i):
            p.reload()
            p.locator("#folio-boot").wait_for(state="detached")
            expect(p.locator("#reading-progress")).to_contain_text(f"абзац {i+1} / 4")
            expect(toggle).to_have_accessible_name("Приостановить автоперевод")
            expect(sheet).to_be_hidden()

        p.locator("#translation-full").tap()
        p.locator("#local-translation-start").tap()
        expect(sheet.locator(".machine-result")).to_contain_text(REPEAT)
        cached(1)
        sheet.locator("[data-sheet-handle]").tap()
        select(1)
        expect(ribbon).to_contain_text("Синтетический перевод: "+OTHER[:46])
        cached(2)
        assert calls()==[{"text":REPEAT,"allowNetwork":True},{"text":OTHER,"allowNetwork":False}],calls()

        reload_at(1)
        expect(ribbon).to_contain_text("Синтетический перевод: "+OTHER[:46])
        assert calls()==[],calls()
        print("Plain mobile reload: auto preference stayed on and existing paragraph reused without opening the translation sheet.")

        select(0)
        expect(ribbon).to_contain_text("Синтетический перевод: "+REPEAT)
        select(2)
        expect(ribbon).to_contain_text("Синтетический перевод: "+REPEAT)
        assert calls()==[],calls()
        # The repeated text only had a sidecar for its first occurrence.
        cached(2)
        reload_at(2)
        expect(ribbon).to_contain_text("Синтетический перевод: "+REPEAT)
        assert calls()==[],f"Cold reopening repeated text triggered a second inference: {calls()}"

        toggle.tap()
        expect(toggle).to_have_text("Продолжить")
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(ribbon).to_contain_text("Синтетический перевод: "+REPEAT)
        expect(toggle).to_have_text("Продолжить")
        expect(sheet).to_be_hidden()
        assert calls()==[]
        toggle.tap()
        expect(toggle).to_have_text("Пауза")
        expect(sheet).to_be_hidden()

        # A genuinely new paragraph still auto-translates using only the
        # already available model, not a download or a new consent dialog.
        select(3)
        expect(ribbon).to_contain_text("Синтетический перевод: "+NEW)
        cached(3)
        assert calls()==[{"text":NEW,"allowNetwork":False}],calls()
        reload_at(3)
        expect(ribbon).to_contain_text("Синтетический перевод: "+NEW)
        assert not calls() and not external and not errors,(calls(),external,errors)
        b.close()
    print("320px auto mode persisted across successive reloads; repeating text reused exact same-book IndexedDB result without inference.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
