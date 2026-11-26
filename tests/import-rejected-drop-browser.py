"""An invalid replacement drop must not discard an in-progress or ready import."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
ORIGINAL="The ferry passed the old lighthouse before dawn."
PARALLEL="Паром прошёл мимо старого маяка до рассвета."


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        ctx=browser.new_context(viewport={"width":980,"height":760}, reduced_motion="reduce",
                                service_workers="block")
        ctx.route("**/*",lambda r: r.continue_() if
                  r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        ctx.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
          readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          const read=File.prototype.arrayBuffer;
          File.prototype.arrayBuffer=async function (...args){
            if(this.name==='Original.txt'&&!window.readReleased){
              await new Promise(resolve=>window.releaseFixtureRead=()=>{window.readReleased=true;resolve()});
            }
            return read.apply(this,args);
          };
        """)
        p=ctx.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").click()
        for role,name,copy in (("original","Original.txt",ORIGINAL),("translation","Parallel.txt",PARALLEL)):
            p.locator(f"#{role}-file").set_input_files({"name":name,"mimeType":"text/plain","buffer":copy.encode()})
        def drop(role,names):
            p.locator(f'[data-file-field="{role}"]').evaluate("""(target,names)=>{
              const dataTransfer=new DataTransfer();
              names.forEach(name=>dataTransfer.items.add(new File(["discard this"],name,{type:"text/plain"})));
              target.dispatchEvent(new DragEvent("drop",{dataTransfer,bubbles:true,cancelable:true}));
            }""",names)
        p.locator("#preview-import").click()
        p.wait_for_function("typeof window.releaseFixtureRead==='function'")
        drop("original",["wrong-format.zip"])
        expect(p.locator("#cancel-import")).to_be_visible(timeout=1100)
        expect(p.locator("#import-file-warning")).to_contain_text("Выберите EPUB")
        expect(p.locator("#import-status")).to_contain_text("Читаем книгу")
        p.evaluate("releaseFixtureRead()")
        preview=p.locator("#import-preview")
        expect(preview).to_contain_text(ORIGINAL)
        expect(preview).to_contain_text(PARALLEL)

        confirmed=p.locator("#alignment-check")
        confirmed.check()
        drop("translation",["first.txt","second.txt"])
        expect(preview).to_be_visible(timeout=1100)
        expect(confirmed).to_be_checked()
        expect(p.locator("#import-file-warning")).to_contain_text("Добавьте по одному файлу")
        assert p.locator("#translation-file").evaluate("el=>el.files[0].name")=="Parallel.txt"
        p.locator("#save-import").click()
        expect(p.locator("#paragraph-0")).to_have_text(ORIGINAL)
        expect(p.locator("#translation-ribbon")).to_contain_text(PARALLEL)
        assert not errors,errors
        print("Rejected drops left both pending import and confirmed paired preview intact; the existing files opened normally.")
        browser.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
