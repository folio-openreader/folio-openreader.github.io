"""An old automatic paragraph must not block an explicit translation in a new book."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

suite = runpy.run_path(str(Path(__file__).with_name("paragraph-cache-browser.py")))
serve, COUNT_CACHE = suite["serving"], suite["COUNT_CACHE"]
MODEL_STUB = r"""
export function createLocalTranslator(){
  const memory=new Map(), key=(t,p)=>p.source+'/'+p.target+'/'+t;
  window.folioTestTranslationCalls=[];window.folioTestTranslationStops=0;
  let rejectHeld=null;
  return {
    capabilities:()=>true,installed:async()=>true,modelStorage:async()=>({state:'cached'}),
    peek:(t,p)=>memory.get(key(t,p)),prime:(t,v,p)=>memory.set(key(t,p),v),
    translate:async(t,p)=>{
      folioTestTranslationCalls.push({text:t,explicit:p.allowNetwork});
      if(window.folioTestHoldOld&&!p.allowNetwork){
        window.folioTestHoldOld=false;
        await new Promise((_,reject)=>{rejectHeld=reject});
      }
      const v='Синтетический перевод: '+t;memory.set(key(t,p),v);return v;
    },
    stop:()=>{
      folioTestTranslationStops++;
      const reject=rejectHeld;rejectHeld=null;
      reject?.(new DOMException('Aborted','AbortError'));
    }
  };
}
"""
OLD_TEXT = "The silver river enters the sea.\n\nThe sailors tie the ropes.\n\nAn oar rests beside the old ship."
NEW_TEXT = "The blue kite rises over the garden."


def run(dist, chromium):
    signature = "export function createLocalTranslator("
    model = (dist/"local-translation.js").read_text("utf-8").replace(signature,"function originalTranslator(",1)+MODEL_STUB
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                          service_workers="block",reduced_motion="reduce")
        downloads=[]
        def fence(r):
            url=r.request.url
            if url==origin+"/local-translation.js":
                return r.fulfill(content_type="text/javascript; charset=utf-8",body=model)
            if url.startswith(origin+"/vendor/bergamot/"):
                downloads.append(url);return r.abort()
            return r.continue_() if url.startswith((origin+"/","blob:","data:")) else r.abort()
        c.route("**/*",fence)
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
          JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")

        def import_book(title, text):
            p.locator("#import-open").tap()
            p.locator("#original-file").set_input_files({"name":title+".txt","mimeType":"text/plain","buffer":text.encode()})
            p.locator("#preview-import").tap()
            expect(p.locator("#save-import")).to_be_enabled()
            p.locator("#save-import").tap()
            expect(p.locator("#book-title")).to_have_text(title)

        sheet=p.locator("#translation-dialog")
        def translate():
            p.locator("#translation-full").tap()
            p.locator("#local-translation-start").tap()
        import_book("Old river",OLD_TEXT)
        old_link=p.url
        translate()
        expect(sheet.locator(".machine-result")).to_contain_text("The silver river")
        p.wait_for_function(f"async () => (await ({COUNT_CACHE})()) === 1")
        sheet.locator("[data-sheet-handle]").tap()
        expect(sheet).to_be_hidden()
        p.evaluate("window.folioTestHoldOld=true")
        p.locator("#paragraph-1 .word").first.tap()
        p.locator("#word-dialog [data-sheet-handle]").tap()
        p.wait_for_function("folioTestTranslationCalls.length===2")
        assert p.evaluate("folioTestTranslationCalls[1]") == {"text":"The sailors tie the ropes.","explicit":False}
        p.locator("#reader-back").tap()
        import_book("New kite",NEW_TEXT)
        new_link=p.url
        translate()
        expect(sheet.locator(".machine-result")).to_contain_text(NEW_TEXT,timeout=1500)
        assert p.evaluate("folioTestTranslationStops")==1
        assert p.evaluate("folioTestTranslationCalls.at(-1)")=={"text":NEW_TEXT,"explicit":True}
        p.wait_for_function(f"async () => (await ({COUNT_CACHE})()) === 2")
        sheet.locator("[data-sheet-handle]").tap()
        p.evaluate("(target) => location.hash=new URL(target).hash",old_link)
        expect(p.locator("#book-title")).to_have_text("Old river")
        expect(p.locator("#local-translation-open")).to_have_text("Пауза")
        p.wait_for_function("folioTestTranslationCalls.length===4")
        assert p.evaluate("folioTestTranslationCalls.at(-1)")=={"text":"The sailors tie the ropes.","explicit":False}
        p.evaluate("window.folioTestHoldOld=true")
        p.locator("#paragraph-2 .word").first.tap()
        p.locator("#word-dialog [data-sheet-handle]").tap()
        p.wait_for_function("folioTestTranslationCalls.length===5")
        p.evaluate("(target) => location.hash=new URL(target).hash",new_link)
        expect(p.locator("#book-title")).to_have_text("New kite")
        assert p.evaluate("folioTestTranslationStops")==2
        assert p.evaluate("folioTestTranslationCalls.length")==5  # New kite is already cached.
        assert not downloads and not errors,(downloads, errors)
        print("Navigation stopped only the old automatic job, new manual result arrived, and old per-book opt-in survived.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
