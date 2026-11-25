"""Run with an installed browser: python tests/paragraph-cache-browser.py dist.

Uses localhost and fresh profiles, including real IndexedDB across connections.
No credentials, external requests, downloads, or model files. Only the model's
result is stubbed in the UI test; the persistence path is the shipped source.
"""
from argparse import ArgumentParser
from pathlib import Path
from urllib.parse import urlsplit
import runpy
import shutil
from playwright.sync_api import sync_playwright, expect

serving = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]

MODEL_MOCK = r"""
export function createLocalTranslator(){
  const memory=new Map(), key=(text,p)=>p.source+'/'+p.target+'/'+text;
  window.paragraphModelCalls=[];
  return {
    capabilities:()=>true, installed:async()=>true, modelStorage:async()=>({state:'cached'}),
    peek:(text,p)=>memory.get(key(text,p)), prime:(text,value,p)=>memory.set(key(text,p),value),
    translate:async(text,p)=>{
      window.paragraphModelCalls.push({allowNetwork:p.allowNetwork});
      if(window.holdNextParagraph){
        window.holdNextParagraph=false;
        await new Promise(resolve=>{window.releaseParagraph=resolve;});
      }
      const value='Синтетический перевод: '+text;memory.set(key(text,p),value);return value;
    },
    stop:()=>{}
  };
}
"""

CACHE_INSTRUMENT = r"""
export async function writeParagraphCache(...args){
  const outcome=await actualWriteParagraphCache(...args);
  (window.paragraphCacheOutcomes??=[]).push(outcome);
  return outcome;
}
"""

BACKUP_FIXTURE = r"""
async bookId => {
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('folio-library');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  try {
    const book=await new Promise((resolve,reject)=>{
      const req=db.transaction('books').objectStore('books').get(bookId);
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    const {serializeBackup}=await import('./release-core.js');
    return serializeBackup([book],{positions:{},bookmarks:{},lastBook:book.id,prefs:{}},[]);
  } finally {db.close();}
}
"""

COUNT_CACHE = r"""
async () => {
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('folio-library');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  try {
    const keys=await new Promise((resolve,reject)=>{
      const req=db.transaction('books').objectStore('books').getAllKeys();
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
    });
    return keys.filter(k=>Array.isArray(k)&&k[0]==='paragraph-translation-v1').length;
  } finally {db.close();}
}
"""

def run(dist,engine,executable):
    dist=dist.resolve()
    test_url="/tests/paragraph-cache-native.mjs"
    base="/"+dist.name+"/"
    engine_source=(dist/"local-translation.js").read_text(encoding="utf-8")
    signature="export function createLocalTranslator("
    assert engine_source.count(signature)==1
    stub=engine_source.replace(signature,"function realLocalTranslator(",1)+MODEL_MOCK
    cache=(dist/"paragraph-translation-cache.js").read_text(encoding="utf-8")
    cache_signature="export function writeParagraphCache("
    assert cache.count(cache_signature)==1
    instrumented=cache.replace(cache_signature,"function actualWriteParagraphCache(",1)+CACHE_INSTRUMENT
    with serving(dist.parent) as origin,sync_playwright() as pw:
        browser=getattr(pw,engine).launch(executable_path=executable,headless=True,
            args=["--no-sandbox","--disable-dev-shm-usage"] if engine=="chromium" else [])
        context=browser.new_context(
            viewport={"width":390,"height":844},is_mobile=True,has_touch=True,service_workers="block")
        model_requests=[]
        def fence(route):
            url=route.request.url
            path=urlsplit(url).path
            if url.startswith(("blob:","data:")):return route.continue_()
            if not url.startswith(origin+"/") or not (path.startswith(base) or path==test_url):return route.abort()
            if path.startswith(base+"vendor/bergamot/"):
                model_requests.append(path)
                return route.abort()
            if path==base+"local-translation.js":
                return route.fulfill(content_type="text/javascript; charset=utf-8",body=stub)
            if path==base+"paragraph-translation-cache.js":
                return route.fulfill(content_type="text/javascript; charset=utf-8",body=instrumented)
            return route.continue_()
        context.route("**/*",fence)
        # Seed only the preference needed to bypass first-visit onboarding.
        context.add_init_script("""if(location.protocol==='http:'&&!localStorage.getItem('folio-v2')){
          localStorage.setItem('folio-v2',JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
        }""")
        page=context.new_page();page.set_default_timeout(20000)
        errors=[];page.on("pageerror",lambda e:errors.append(str(e)))
        page.goto(origin+base+"app.html#library",wait_until="domcontentloaded")
        page.locator("#folio-boot").wait_for(state="detached")
        native=page.evaluate(f"async () => (await import({test_url!r})).testNativeParagraphCache()")
        print(native,flush=True)
        page.locator("#import-open").click()
        page.locator("#original-file").set_input_files({
            "name":"Synthetic River.txt","mimeType":"text/plain",
            "buffer":b"The river enters the sea.\n\nThe travellers take a boat."})
        page.locator("#preview-import").click()
        expect(page.locator("#save-import")).to_be_enabled()
        page.locator("#save-import").click()
        expect(page.locator("#reader")).to_be_visible()
        page.locator("#translation-full").click()
        page.locator("#local-translation-start").click()
        expect(page.locator("#translation-dialog .machine-result")).to_contain_text("Синтетический перевод")
        page.wait_for_function(f"async () => (await ({COUNT_CACHE})()) === 1")
        assert len(page.evaluate("window.paragraphModelCalls"))==1
        page.reload(wait_until="domcontentloaded")
        page.locator("#folio-boot").wait_for(state="detached")
        expect(page.locator("#reader")).to_be_visible()
        expect(page.locator("#translation-ribbon .translation-empty")).to_contain_text("Синтетический перевод")
        expect(page.locator("#translation-dialog")).to_be_hidden()
        assert page.evaluate("window.paragraphModelCalls")==[], "Reader retranslated instead of reusing disk cache"
        print("UI: imported synthetic TXT, translated via reader dialog, reloaded and reused local text with no model or dialog.",flush=True)

        # Keep a real translation job from tab A alive while tab B deletes and
        # restores *the exact same book ID* through Folio's visible controls.
        book_id=page.evaluate("decodeURIComponent(location.hash.slice(6))")
        assert book_id.startswith("book-"), book_id
        backup=page.evaluate(BACKUP_FIXTURE,book_id)
        assert "Синтетический перевод" not in backup and "localTranslationGeneration" not in backup
        page.locator("#local-translation-open").click()  # pause auto translation
        page.locator("#paragraph-1 .word").first.click()
        page.locator("#word-dialog [data-sheet-handle]").click()
        expect(page.locator("#word-dialog")).to_be_hidden()
        page.locator("#translation-full").click()
        page.evaluate("window.holdNextParagraph=true;window.paragraphCacheOutcomes=[]")
        page.locator("#local-translation-start").click()
        page.wait_for_function("typeof window.releaseParagraph==='function'")
        assert page.evaluate("window.paragraphModelCalls")==[{"allowNetwork":True}]
        other=context.new_page();other.set_default_timeout(20000);other.on("pageerror",lambda e:errors.append(str(e)))
        other.goto(origin+base+"app.html#home",wait_until="domcontentloaded")
        other.locator("#folio-boot").wait_for(state="detached")
        other.get_by_role("button",name="Удалить книгу Synthetic River",exact=True).click()
        other.locator("#book-delete .delete-confirm").click()
        expect(other.locator("#book-delete")).to_be_hidden()
        assert other.evaluate(COUNT_CACHE)==0,"book deletion must physically remove its cached translation"
        other.locator("[data-view=profile]").click()
        other.locator("[data-profile-open=backups]").click()
        other.locator("#open-backup").click()
        other.locator("#backup-file").set_input_files({
            "name":"synthetic-restore.json","mimeType":"application/json","buffer":backup.encode("utf-8")})
        expect(other.locator("#restore-backup")).to_be_enabled()
        other.locator("#restore-backup").click()
        expect(other.locator("#backup-dialog")).to_be_hidden()
        other.locator("[data-view=home]").click()
        other.locator(f'.book-open[data-book="{book_id}"]').click()
        expect(other.locator("#reader")).to_be_visible()
        other.locator("#translation-full").click()
        other.evaluate("window.holdNextParagraph=true")
        other.locator("#local-translation-start").click()
        other.wait_for_function("typeof window.releaseParagraph==='function'")
        assert other.evaluate(COUNT_CACHE)==0
        page.bring_to_front()
        page.evaluate("window.releaseParagraph()")
        page.wait_for_function("window.paragraphCacheOutcomes.length===1")
        assert page.evaluate("window.paragraphCacheOutcomes")==[False],"the old UI job reached the native transaction and must be denied"
        assert other.evaluate(COUNT_CACHE)==0,"late work must not recreate sidecar for restored book"
        assert not model_requests,model_requests
        assert not errors,errors
        print("UI: active request in original tab rejected by real transaction after another tab deletes and restores the same ID.",flush=True)
        browser.close()

if __name__=="__main__":
    p=ArgumentParser()
    p.add_argument("dist",type=Path)
    p.add_argument("--engine",choices=("chromium","webkit"),default="chromium")
    p.add_argument("--browser-path",default=None)
    flags=p.parse_args()
    binary=flags.browser_path or (shutil.which("chromium") if flags.engine=="chromium" else None)
    run(flags.dist,flags.engine,binary)
