"""A dictionary lookup pauses narration without discarding its position."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True,
                                     args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                                      reduced_motion="reduce", service_workers="block")
        context.route("**/*", lambda r: r.continue_() if
                      r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        context.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
          readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          window.fixtureTalk=[];
          const voice={lang:'en-US',name:'Fixture voice',voiceURI:'fixture',localService:true};
          Object.defineProperty(window,'speechSynthesis',{value:{
            getVoices:()=>[voice],addEventListener(){},
            cancel(){fixtureTalk.at(-1)?.onerror?.({error:'canceled'})},
            speak(utterance){fixtureTalk.push(utterance);utterance.onstart?.()}
          }});
          Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class{
            constructor(text){this.text=text}
          }});
        """)
        p = context.new_page()
        p.set_default_timeout(6500)
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#read/folio-night-ferry")
        p.locator("#folio-boot").wait_for(state="detached")
        listen = p.locator("#reader-listen")
        sheet = p.locator("#word-dialog")
        spoken = lambda: p.evaluate("fixtureTalk.map(x=>x.text)")
        listen.tap()
        original = spoken()[0]
        cutoff = original.index("lantern")
        assert cutoff > 0
        expected_suffix = original[cutoff:]
        p.evaluate("(cutoff)=>fixtureTalk[0].onboundary({charIndex:cutoff})", cutoff)
        p.locator("#paragraph-0").get_by_role("button",name="lantern",exact=True).tap()
        expect(sheet).to_be_visible()
        expect(listen).to_have_attribute("aria-label", "Продолжить слушать",timeout=1700)
        assert spoken() == [original], "Opening the dictionary should not speak by itself"
        sheet.locator("#word-speech").tap()
        assert spoken() == [original,"lantern"], spoken()
        sheet.locator("[data-sheet-handle]").tap()
        expect(sheet).to_be_hidden()
        expect(listen).to_have_attribute("aria-label", "Продолжить слушать")
        assert spoken() == [original,"lantern"], "Closing the dictionary should not autoplay"
        listen.tap()
        assert spoken() == [original,"lantern",expected_suffix], spoken()

        # Looking up a word in another paragraph changes the reading target.
        next_p = p.locator("#paragraph-1")
        next_p.get_by_role("button",name="bell",exact=True).tap()
        expect(sheet).to_be_visible()
        sheet.locator("[data-sheet-handle]").tap()
        expect(sheet).to_be_hidden()
        listen.tap()
        assert spoken()[-1].startswith("A bell rang"), spoken()
        assert not errors, errors
        print("Mobile dictionary pause, individual word pronunciation, exact native-boundary resume and intentional paragraph change passed.")
        browser.close()


def run_neural(dist, chromium):
    """Use the shipped local model, worker and AudioContext, not a voice mock."""
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True,
                                     args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                                      reduced_motion="reduce", service_workers="block")
        context.route("**/*", lambda r: r.continue_() if
                      r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        context.add_init_script("""localStorage.setItem('folio-v2', JSON.stringify({prefs:{
            readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          window.fixtureAudio = [];
          const start = AudioBufferSourceNode.prototype.start;
          AudioBufferSourceNode.prototype.start = function(when, offset, ...args){
            fixtureAudio.push({buffer:this.buffer,offset:offset||0});
            return start.call(this,when,offset,...args);
          };
        """)
        p = context.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#read/folio-night-ferry")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#reader-prefs").tap()
        prefs = p.locator("#preferences")
        prefs.get_by_role("button",name="Скачать английские голоса",exact=False).tap()
        expect(prefs.get_by_role("button",name="Удалить английские голоса")).to_be_visible(timeout=50000)
        prefs.locator("[data-sheet-handle],[data-prefs-handle]").first.tap()
        expect(prefs).to_be_hidden()
        listen = p.locator("#reader-listen")
        listen.tap()
        p.wait_for_function("fixtureAudio.length===1",timeout=50000)
        expect(listen).to_have_attribute("aria-label","Приостановить чтение")
        p.wait_for_timeout(300)
        p.locator("#paragraph-0").get_by_role("button",name="lantern",exact=True).tap()
        sheet = p.locator("#word-dialog")
        expect(listen).to_have_attribute("aria-label","Продолжить слушать")
        assert p.evaluate("fixtureAudio.length") == 1
        sheet.locator("#word-speech").tap()
        p.wait_for_function("fixtureAudio.length===2",timeout=50000)
        assert p.evaluate("fixtureAudio[1].buffer!==fixtureAudio[0].buffer")
        sheet.locator("[data-sheet-handle]").tap()
        expect(sheet).to_be_hidden()
        assert p.evaluate("fixtureAudio.length") == 2
        listen.tap()
        p.wait_for_function("fixtureAudio.length===3",timeout=50000)
        actual = p.evaluate("""({same:fixtureAudio[2].buffer===fixtureAudio[0].buffer,
            offset:fixtureAudio[2].offset,length:fixtureAudio[0].buffer.duration})""")
        assert actual["same"] and 0.1 < actual["offset"] < actual["length"],actual
        assert not errors, errors
        print(f"Shipped neural voice resumed the exact decoded buffer at {actual['offset']:.3f}s after word pronunciation.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    parser.add_argument("--real-neural",action="store_true",
                        help="Also verify the shipped 41 MiB model and AudioContext.")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
    if args.real_neural:
        run_neural(args.dist.resolve(),args.chromium)
