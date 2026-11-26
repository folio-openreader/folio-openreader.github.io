"""A rejected local narrator does not trap the reader on the same broken voice."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                      has_touch=True, service_workers="block")
        context.route("**/*", lambda r: r.continue_()
                      if r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        context.add_init_script("""
            localStorage.setItem('folio-v2',JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
            localStorage.setItem('folio.voice.1.en-Latn',JSON.stringify({voice:'fixture-primary',rate:1.25}));
            window.fixtureAttempts=[];
            const voice=(name,lang,localService=true)=>({name,voiceURI:name,lang,localService});
            Object.defineProperty(window,'speechSynthesis',{value:{
              getVoices:()=>[voice('fixture-remote','en-US',false),voice('fixture-wrong-language','ru'),
                voice('fixture-primary','en-US'), voice('fixture-backup','en-GB')],
              addEventListener(){},cancel(){},
              speak(u){
                const id=u.voice?.voiceURI;
                fixtureAttempts.push({id, rate:u.rate, text:u.text});
                if(id==='fixture-primary')u.onerror?.({error:'voice-unavailable'});
                else u.onstart?.();
              }
            }});
            Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {constructor(text){this.text=text}}});
        """)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(origin + "/app.html#read/folio-night-ferry")
        page.locator("#folio-boot").wait_for(state="detached")
        listen = page.locator("#reader-listen")
        listen.tap()
        expect(page.locator("#toast")).to_contain_text("Выбранный голос не запустился")
        assert [a["id"] for a in page.evaluate("window.fixtureAttempts")] == ["fixture-primary"]
        listen.tap()
        attempts = page.evaluate("window.fixtureAttempts")
        assert [a["id"] for a in attempts] == ["fixture-primary", "fixture-backup"], attempts
        assert attempts[0]["text"] == attempts[1]["text"] and attempts[0]["rate"] == attempts[1]["rate"] == 1.25
        expect(listen).to_have_attribute("aria-label", "Приостановить чтение")
        listen.tap()
        expect(listen).to_have_attribute("aria-label", "Продолжить слушать")
        listen.tap()
        assert page.evaluate("window.fixtureAttempts.at(-1).id") == "fixture-backup"
        assert page.evaluate("JSON.parse(localStorage.getItem('folio.voice.1.en-Latn'))") == {
            "voice":"fixture-primary","rate":1.25}
        assert not errors, errors
        print("Rejected native voice → same paragraph at 1.25× using compatible local alternate on retry; stored preference unchanged.")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
