"""A tagged book with a local voice can preview its voice even without a fixed Folio sample."""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
EXCERPT = "A raposa correu pelo bosque em silêncio."
TEXT = EXCERPT + " A cauda balançava atrás dela. " * 25


def epub():
    stream = BytesIO()
    with ZipFile(stream, "w", compression=ZIP_DEFLATED) as z:
        z.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        z.writestr("META-INF/container.xml", """<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>""")
        z.writestr("book.opf", """<package xmlns="http://www.idpf.org/2007/opf"
            xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="edition">
          <metadata><dc:identifier id="edition">folio-pt-voice</dc:identifier>
            <dc:title>Portuguese voice fixture</dc:title><dc:language>pt-BR</dc:language></metadata>
          <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
          <spine><itemref idref="chapter"/></spine>
        </package>""")
        z.writestr("chapter.xhtml", f"""<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
          <head><title>Fixture</title></head><body><p>{TEXT}</p></body>
        </html>""")
    return stream.getvalue()


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                          has_touch=True, service_workers="block")
        c.route("**/*", lambda r: r.continue_() if
                r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        c.add_init_script("""
            localStorage.setItem('folio-v2', JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
            const voices=[
              {name:'Fixture remote PT',voiceURI:'remote-pt',lang:'pt-BR',localService:false,default:true},
              {name:'Fixture local PT',voiceURI:'local-pt',lang:'pt-BR',localService:true},
              {name:'Fixture local EN',voiceURI:'local-en',lang:'en-US',localService:true}
            ];
            window.folioSampleCalls=[];window.folioSampleHasPortuguese=true;
            const speech=new EventTarget();
            speech.getVoices=()=>voices.filter(v=>v.voiceURI!=='local-pt'||folioSampleHasPortuguese);
            speech.speak=u=>{folioSampleCalls.push({text:u.text,voice:u.voice?.voiceURI,lang:u.lang,rate:u.rate});u.onstart?.();u.onend?.()};
            speech.cancel=()=>{};
            Object.defineProperty(window,'speechSynthesis',{value:speech});
            Object.defineProperty(window,'SpeechSynthesisUtterance',{value:class {constructor(text){this.text=text}}});
        """)
        p = c.new_page()
        p.set_default_timeout(6000)
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files({"name": "portuguese.epub",
            "mimeType": "application/epub+zip", "buffer": epub()})
        p.locator("#preview-import").click()
        expect(p.locator("#import-preview")).to_be_visible()
        p.locator("#save-import").click()
        expect(p.locator("#book-title")).to_have_text("Portuguese voice fixture")
        p.locator("#reader-prefs").tap()
        panel = p.locator("#preferences [data-voice-controls]")
        languages, voices, speed = (panel.locator("select").nth(n) for n in range(3))
        expect(languages).to_have_value("pt-BR")
        voices.select_option("local-pt")
        speed.select_option("0.9")
        preview = panel.locator("button").first
        expect(preview).to_be_enabled(timeout=1500)
        expect(preview).to_have_text("Послушать отрывок")
        preview.tap()
        assert p.evaluate("folioSampleCalls") == [{"text": EXCERPT, "voice": "local-pt", "lang":"pt-BR","rate":0.9}]
        languages.select_option("en")
        expect(preview).to_have_text("Послушать пример")
        preview.tap()
        assert p.evaluate("folioSampleCalls.at(-1)") == {
            "text": "Just one more page.", "voice": "local-en", "lang":"en-US", "rate":1}
        languages.select_option("pt-BR")
        p.evaluate("window.folioSampleHasPortuguese=false; speechSynthesis.dispatchEvent(new Event('voiceschanged'))")
        expect(preview).to_be_disabled()
        expect(voices).to_be_disabled()
        assert p.evaluate("folioSampleCalls.length") == 2
        assert not errors, errors
        print("Portuguese EPUB local excerpt preview, requested voice/rate, English control and remote-only refusal passed")
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
