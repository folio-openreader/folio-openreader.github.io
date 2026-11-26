"""A long final paragraph does not count as read merely because it is reached."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT="\n\n".join([f"Passage {i}. The amber lamp lit the ferry at dusk." for i in range(1,5)]+[
    " ".join(["The ferry crossed the old harbor and brought several travelers home."]*55)])
METRICS="""() => {
    const sc=document.querySelector('#reading-scroll'), row=document.querySelector('#paragraph-4');
    return {scroll:sc.scrollTop, max:sc.scrollHeight-sc.clientHeight,
      height:row.offsetHeight,prefix:row.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop};
}"""


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
            JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
            window.fixtureNarration=[];
            const voice={lang:'en-US',name:'Fixture',voiceURI:'fixture',localService:true};
            Object.defineProperty(window,'speechSynthesis',{value:{
              getVoices:()=>[voice],addEventListener(){},cancel(){},
              speak(utterance){fixtureNarration.push(utterance);utterance.onstart?.()}
            }});
            Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{
              constructor(text){this.text=text}
            }});""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"End of the ferry.txt","mimeType":"text/plain","buffer":TEXT.encode()})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        row=p.locator("#paragraph-4")
        indicator=p.locator("#reading-progress")
        expect(indicator).to_have_text("0% · абзац 1 / 5")
        p.evaluate("document.fonts.ready")
        dims=p.evaluate(METRICS)
        assert dims["height"]>1800,dims
        def seek(y):
            p.locator("#reading-scroll").evaluate("(sc,y)=>sc.scrollTop=y",y)

        seek(dims["prefix"]-22)
        expect(row).to_have_class("reading-paragraph active")
        expect(indicator).to_have_text("80% · абзац 5 / 5",timeout=1400)
        seek(dims["prefix"]-22+.5*dims["height"])
        expect(indicator).to_have_text("90% · абзац 5 / 5")
        mid=p.evaluate(METRICS)["scroll"]
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(indicator).to_have_text("90% · абзац 5 / 5")
        assert abs(p.evaluate(METRICS)["scroll"]-mid)<3

        seek(p.evaluate(METRICS)["max"])
        expect(indicator).to_have_text("100% · абзац 5 / 5")
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(indicator).to_have_text("100% · абзац 5 / 5")
        p.wait_for_function("""() => {
            const sc=document.querySelector('#reading-scroll');
            return sc.scrollHeight-sc.clientHeight-sc.scrollTop<2;
        }""")
        p.set_viewport_size({"width":660,"height":844})
        p.wait_for_function("""() => {
            const sc=document.querySelector('#reading-scroll');
            return sc.scrollHeight-sc.clientHeight-sc.scrollTop<2;
        }""")
        expect(indicator).to_have_text("100% · абзац 5 / 5")
        seek(0)
        expect(indicator).to_have_text("0% · абзац 1 / 5")
        p.locator("#reader-listen").tap()
        spoken=p.evaluate("""() => {
          for(let i=0;i<fixtureNarration.length&&i<100;i++)fixtureNarration[i].onend();
          return fixtureNarration.length;
        }""")
        assert 10<spoken<100,spoken
        expect(p.locator("#toast")).to_have_text("Книга прослушана.")
        expect(indicator).to_have_text("100% · абзац 5 / 5")
        assert p.evaluate(METRICS)["max"]-p.evaluate(METRICS)["scroll"]<2
        assert not errors,errors
        print("Long final paragraph progresses 80→90→100; exact mid/end and reflow, backtracking, and completed narration passed.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
