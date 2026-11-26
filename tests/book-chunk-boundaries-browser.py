"""Long original sentences are not broken after a title or initial in the reader."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT = ("Dr. A. Morgan said that the final ferry carried supplies to the island while the crew waited "
        "for the tide to turn and the lighthouse began to shine across the still water before dawn. Captain Mara called from the quay.")


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                          reduced_motion="reduce", service_workers="block")
        c.route("**/*", lambda r: r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
          readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          window.spokenChunks=[];
          Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {constructor(text){this.text=text}}});
          Object.defineProperty(window,'speechSynthesis',{value:{
            getVoices:()=>[{name:'Local test voice',voiceURI:'fixture',lang:'en-US',localService:true}],
            addEventListener(){},cancel(){},
            speak(u){window.currentUtterance=u;spokenChunks.push(u.text);u.onstart?.();}
          }});
        """)
        p = c.new_page()
        errors = []
        p.on("pageerror", lambda error: errors.append(str(error)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Narrator boundaries.txt","mimeType":"text/plain",
                                                    "buffer":TEXT.encode()})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        listen = p.locator("#reader-listen")
        listen.tap()
        expect(listen).to_have_attribute("aria-label","Приостановить чтение")
        first = p.evaluate("spokenChunks[0]")
        assert first.startswith("Dr. A. Morgan said that"), f"Premature narration start: {first!r}"
        for _ in range(4):
            if listen.get_attribute("aria-label") != "Приостановить чтение":
                break
            p.evaluate("currentUtterance.onend()")
        chunks = p.evaluate("spokenChunks")
        assert all(0 < len(chunk) <= 160 for chunk in chunks), chunks
        assert " ".join(chunks) == TEXT, chunks
        assert not errors, errors
        print("Mobile book playback preserved the full original without isolating the title or initial.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
