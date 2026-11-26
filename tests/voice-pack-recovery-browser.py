"""Reader voice selection survives a transient unavailable local voice pack."""
from argparse import ArgumentParser
from pathlib import Path
import json
import re
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
VOICE_KEY = "folio.voice.1.en-Latn"
DESIRED = "folio:en-v1:jasper"


def run(dist, chromium):
    files = re.findall(r'"file": "([^"]+)"', (dist / "neural-assets.js").read_text("utf-8"))
    assert files
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                                      has_touch=True, service_workers="block")
        shipped = []
        def route(r):
            url = r.request.url
            if url.startswith(origin + "/voices/en-v1/"):
                shipped.append(url)
                return r.abort()
            if url.startswith((origin + "/", "blob:", "data:")):
                return r.continue_()
            return r.abort()
        context.route("**/*", route)
        context.add_init_script("""
            localStorage.setItem('folio-v2',JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
            localStorage.setItem(""" + json.dumps(VOICE_KEY) + """,JSON.stringify({voice:""" + json.dumps(DESIRED) + """,rate:1.25}));
            const files=""" + json.dumps(files + ["installed"]) + """;
            window.folioVoiceCacheReady=false;window.folioVoiceProbe=0;window.folioNativeSpeech=[];
            const local={name:'Fixture local US',voiceURI:'fixture-device-en',lang:'en-US',localService:true,default:true};
            const remote={name:'Fixture remote',voiceURI:'fixture-remote-en',lang:'en-US',localService:false,default:true};
            Object.defineProperty(window,'speechSynthesis',{value:{
              getVoices:()=>[remote,local],addEventListener(){},cancel(){},
              speak(u){folioNativeSpeech.push({voice:u.voice?.voiceURI,rate:u.rate});u.onstart?.()}
            }});
            Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {constructor(text){this.text=text}}});
            const has=CacheStorage.prototype.has,open=CacheStorage.prototype.open;
            CacheStorage.prototype.has=function(key){
              if(!key.startsWith('folio-voices-'))return has.call(this,key);
              window.folioVoiceProbe++;
              return folioVoiceCacheReady?Promise.resolve(true):Promise.reject(new Error('Temporary cache read failure'));
            };
            CacheStorage.prototype.open=function(key){
              if(!key.startsWith('folio-voices-'))return open.call(this,key);
              return Promise.resolve({keys:async()=>files.map(name=>({url:new URL('/voices/en-v1/'+name,location.origin).href}))});
            };
        """)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(origin + "/app.html#read/folio-night-ferry")
        page.locator("#folio-boot").wait_for(state="detached")
        page.wait_for_function("window.folioVoiceProbe>0")
        page.locator("#reader-listen").click()
        page.wait_for_function("window.folioNativeSpeech.length===1")
        assert page.evaluate("window.folioNativeSpeech[0]") == {"voice": "fixture-device-en", "rate": 1.25}
        actual = page.evaluate("(key) => JSON.parse(localStorage.getItem(key))", VOICE_KEY)
        assert actual == {"voice": DESIRED, "rate": 1.25}, actual
        page.locator("#reader-prefs").click()
        note = page.locator("#preferences .voice-download [role=status]")
        expect(note).to_contain_text("Голос Jasper сейчас недоступен")
        selection = page.locator("#preferences [data-voice-controls] select").nth(1)
        expect(selection).to_have_value("")
        page.evaluate("window.folioVoiceCacheReady=true; window.dispatchEvent(new Event('focus'))")
        expect(selection).to_have_value(DESIRED)
        assert not shipped, shipped
        assert not errors, errors
        print("native local fallback, preserved Jasper and rate, restored picker after cache recovered")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
