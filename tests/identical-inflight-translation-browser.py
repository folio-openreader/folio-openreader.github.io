"""An active local translation also updates an identical visible paragraph."""
from argparse import ArgumentParser
from pathlib import Path
import runpy, time
from playwright.sync_api import expect, sync_playwright

h=runpy.run_path(str(Path(__file__).with_name("paragraph-cache-browser.py")))
serve,MODEL_MOCK,COUNT_CACHE=(h[n] for n in ("serving","MODEL_MOCK","COUNT_CACHE"))
REPEAT="The current carries whatever falls into the water."
OTHER=("The lighthouse stands above the rocks. A bright beam swings over the evening landscape. "*8).strip()
NEW=("The vessel finally reached the small northern island. "*13).strip()


def run(dist,chromium,paused):
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
        def cache_size(expected):
            deadline=time.monotonic()+5
            while time.monotonic()<deadline:
                if p.evaluate(COUNT_CACHE)==expected:return
                p.wait_for_timeout(25)
            assert p.evaluate(COUNT_CACHE)==expected

        p.evaluate("window.holdNextParagraph=true")
        p.locator("#translation-full").tap()
        start=p.locator("#local-translation-start")
        status=p.locator("#local-translation-status")
        start.tap()
        p.wait_for_function("typeof window.releaseParagraph==='function'")
        assert calls()==[{"text":REPEAT,"allowNetwork":True}],calls()
        sheet.locator("[data-sheet-handle]").tap()
        expect(toggle).to_have_text("Пауза")
        if paused:
            toggle.tap()  # Stop future automatic jobs, not the explicit request.
            expect(toggle).not_to_have_text("Пауза")
        select(2)
        expect(ribbon).to_have_text("Нет готового перевода." if paused else "Переводим на устройстве…")
        for _ in range(2):
            p.locator("#translation-full").tap()
            expect(sheet.locator("#translation-original")).to_have_text(REPEAT)
            expect(status).to_have_text("Переводим на устройстве…")
            expect(start).to_have_attribute("aria-disabled","true")
            assert len(calls())==1,calls()
            if _==0:sheet.locator("[data-sheet-handle]").tap()
        # Try activation again while the same result is running; no extra queued job.
        p.locator("#local-translation-start").evaluate("button=>{button.click();button.click()}")
        p.evaluate("window.releaseParagraph()")
        expect(sheet.locator(".machine-result")).to_have_text("Синтетический перевод: "+REPEAT)
        expect(ribbon).to_have_text("Синтетический перевод: "+REPEAT)
        cache_size(1)
        sheet.locator("[data-sheet-handle]").tap()
        mode="Продолжить" if paused else "Пауза"
        expect(toggle).to_have_text(mode)
        if paused:
            select(3)
            expect(ribbon).to_have_text("Нет готового перевода.")
            select(2)
        assert len(calls())==1,calls()
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(p.locator("#reading-progress")).to_contain_text("абзац 3 / 4")
        expect(ribbon).to_have_text("Синтетический перевод: "+REPEAT)
        expect(toggle).to_have_text(mode)
        expect(sheet).to_be_hidden()
        cache_size(1)
        assert not calls() and not external and not errors,(calls(),external,errors)
        b.close()
    print(f"320px ({'paused' if paused else 'automatic'}): one held local result updates the identical sheet and ribbon, survives reload, and preserves the selected mode.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    for paused in (True,False):
        run(a.dist.resolve(),a.chromium,paused)
