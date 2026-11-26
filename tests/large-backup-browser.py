"""Round-trip a 501-book backup through the actual local browser UI."""
from argparse import ArgumentParser
from pathlib import Path
import json
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
BOOKS = 501
OVER_LIMIT = 1001

SEED_BOOKS = """async (n) => {
  const db=await new Promise((ok,fail)=>{
    const r=indexedDB.open('folio-library');
    r.onsuccess=()=>ok(r.result);r.onerror=()=>fail(r.error);
  });
  await new Promise((ok,fail)=>{
    const tx=db.transaction('books','readwrite'),books=tx.objectStore('books');
    tx.oncomplete=ok;tx.onerror=()=>fail(tx.error);tx.onabort=()=>fail(tx.error);
    for(let i=1;i<=n;i++){
      const id='book-00000000-0000-0000-0000-'+String(i).padStart(12,'0');
      books.put({id,title:'Synthetic text '+i,format:'TXT',alignment:'none',language:'en',chapters:[
        {title:'Chapter 1',paragraphs:[{text:'The river is flowing by the old house.'}]}
      ]});
    }
  });
  db.close();
}"""


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as p:
        browser = p.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        errors = []

        def profile():
            c = browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True,
                                    reduced_motion="reduce", service_workers="block", accept_downloads=True)
            c.route("**/*", lambda r: r.continue_()
                    if r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
            c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',
              JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
            tab = c.new_page()
            tab.on("pageerror", lambda e: errors.append(str(e)))
            tab.set_default_timeout(10000)
            tab.goto(origin + "/app.html#profile/backups")
            expect(tab.locator("#folio-boot")).to_have_count(0)
            expect(tab.locator("#open-backup")).to_be_visible()
            return c, tab

        c, source = profile()
        source.evaluate(SEED_BOOKS, BOOKS)
        source.reload()
        expect(source.locator("#folio-boot")).to_have_count(0)
        with source.expect_download() as outcome:
            source.locator("#export-backup").click()
        downloaded = Path(outcome.value.path()).read_bytes()
        assert len(json.loads(downloaded)["books"]) == BOOKS
        assert len(downloaded) < 200*1024

        c2, restore = profile()
        restore.locator("#open-backup").click()
        restore.locator("#backup-file").set_input_files({"name":"library.json",
            "mimeType":"application/json","buffer":downloaded})
        expect(restore.locator("#backup-preview")).to_contain_text("Книг: 501", timeout=2500)
        restore.locator("#restore-backup").click()
        expect(restore.locator("#toast")).to_contain_text("Копия восстановлена")
        restore.goto(origin + "/app.html#home")
        expect(restore.locator("#books button.book-open")).to_have_count(BOOKS + 1)
        restore.locator("#books button.book-open").filter(has_text="Synthetic text 501").click()
        expect(restore.locator("#book-title")).to_have_text("Synthetic text 501")
        expect(restore.locator("#paragraph-0")).to_have_text("The river is flowing by the old house.")
        c2.close()

        source.evaluate(SEED_BOOKS, OVER_LIMIT)
        source.reload()
        expect(source.locator("#folio-boot")).to_have_count(0)
        refused = []
        source.on("download", lambda d: refused.append(d.suggested_filename))
        source.locator("#export-backup").click()
        expect(source.locator("#toast")).to_contain_text("Не удалось создать копию: больше 1000 текстовых книг.")
        assert not refused, refused
        assert not errors, errors
        c.close()
        browser.close()
        print("501-book local backup was downloaded, restored and read; 1001-book export explained and never downloaded.")


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
