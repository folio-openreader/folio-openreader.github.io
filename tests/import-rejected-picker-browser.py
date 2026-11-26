"""An invalid picker replacement leaves the current selection and preview intact."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("import-rejected-drop-browser.py")))
serve, ORIGINAL, PARALLEL=(fixture[k] for k in ("serve","ORIGINAL","PARALLEL"))


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=browser.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                              service_workers="block",reduced_motion="reduce")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
          readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          const read=File.prototype.arrayBuffer;
          window.originalReads=0;
          File.prototype.arrayBuffer=async function (...args){
            if(this.name==='Original.txt'){
              window.originalReads++;
              if(window.originalReads===1)
                await new Promise(resolve=>window.releaseFixtureRead=resolve);
            }
            return read.apply(this,args);
          };
        """)
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        original, translation, warning, preview=(p.locator("#"+id) for id in
            ("original-file","translation-file","import-file-warning","import-preview"))
        def pick(locator, name, text):
            locator.set_input_files({"name":name,"mimeType":"text/plain","buffer":text.encode()})
        def names(locator):
            return locator.evaluate("field=>[...field.files].map(file=>file.name)")

        pick(original,"Original.txt",ORIGINAL)
        pick(translation,"Parallel.txt",PARALLEL)
        p.locator("#preview-import").tap()
        p.wait_for_function("typeof releaseFixtureRead==='function'")
        pick(original,"replacement.zip","not a replacement")
        expect(p.locator("#cancel-import")).to_be_visible(timeout=1200)
        expect(warning).to_contain_text("Прежний файл не изменён")
        expect(p.locator("#original-file-label")).to_have_text("Original.txt")
        assert names(original)==["Original.txt"]
        p.evaluate("releaseFixtureRead()")
        expect(preview).to_contain_text(ORIGINAL)
        expect(preview).to_contain_text(PARALLEL)

        confirmed=p.locator("#alignment-check")
        confirmed.check()
        pick(translation,"not-translation.zip","not a replacement")
        expect(warning).to_contain_text("Прежний файл не изменён")
        expect(preview).to_contain_text(PARALLEL)
        expect(confirmed).to_be_checked()
        assert names(translation)==["Parallel.txt"]
        assert p.evaluate("originalReads")==1

        # Some platforms disallow writing the native FileList. The retained
        # application selection must still be usable, including explicit removal.
        p.evaluate("""() => document.addEventListener('change',event=>{
          if(event.target.id!=='translation-file')return;
          const saved=window.DataTransfer;
          window.DataTransfer=class{constructor(){throw Error('FileList restoration unavailable')}};
          queueMicrotask(()=>{window.DataTransfer=saved});
        },{capture:true,once:true})""")
        pick(translation,"fallback.zip","not a replacement")
        assert names(translation)==[]
        expect(warning).to_contain_text("Прежний файл не изменён")
        expect(confirmed).to_be_checked()
        expect(preview).to_contain_text(PARALLEL)

        p.locator("#remove-translation-file").tap()
        expect(p.locator("#remove-translation-file")).to_be_hidden()
        assert names(translation)==[]
        expect(preview).to_contain_text(ORIGINAL)
        assert p.evaluate("originalReads")==1
        pick(translation,"Replacement.txt","Новый перевод исходного абзаца.")
        expect(preview).to_be_hidden()
        p.locator("#preview-import").tap()
        expect(preview).to_contain_text("Новый перевод исходного абзаца.")
        expect(confirmed).not_to_be_checked()
        confirmed.check()
        p.locator("#save-import").tap()
        expect(p.locator("#paragraph-0")).to_have_text(ORIGINAL)
        expect(p.locator("#translation-ribbon")).to_contain_text("Новый перевод исходного абзаца.")
        assert names(original)==names(translation)==[]
        p.locator("#reader-back").tap()
        p.locator("#import-open").tap()
        pick(original,"unsupported.zip","not a book")
        expect(warning).to_contain_text("Выберите EPUB")
        assert names(original)==[]
        assert not errors,errors
        print("Mobile picker: rejected first file, preserved pending and confirmed imports, removed and replaced valid translation, cleared both on save.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
