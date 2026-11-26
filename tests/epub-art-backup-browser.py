"""Export explicit EPUB illustrations on a 320px local profile and restore cleanly."""
from argparse import ArgumentParser
from pathlib import Path
import json
import runpy
from playwright.sync_api import expect, sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("epub-illustrations-browser.py")))
serve, epub=fixture["serve"],fixture["epub"]
ALT=fixture["ALT"]


def run(dist,chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        external,errors=[],[]

        def profile(route):
            c=b.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                            reduced_motion="reduce",service_workers="block",accept_downloads=True)
            def fence(r):
                if r.request.url.startswith((origin+"/","blob:","data:")): r.continue_()
                else:
                    external.append(r.request.url)
                    r.abort()
            c.route("**/*",fence)
            c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',JSON.stringify({
              prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
            p=c.new_page()
            p.on("pageerror",lambda e:errors.append(str(e)))
            p.set_default_timeout(11000)
            p.goto(origin+"/app.html"+route)
            p.locator("#folio-boot").wait_for(state="detached")
            return p

        source=profile("#library")
        source.locator("#import-open").tap()
        source.locator("#original-file").set_input_files({"name":"Backup illustration.epub",
          "mimeType":"application/epub+zip","buffer":epub("Backup illustration","en",fixture["BEFORE"],fixture["AFTER"],art=True)})
        source.locator("#preview-import").tap()
        source.locator("#save-import").tap()
        expect(source.get_by_role("img",name=ALT)).to_be_visible()
        source.locator("#reading-scroll").evaluate("""sc=>{
          const row=sc.querySelector('#paragraph-1');
          sc.scrollTop+=row.getBoundingClientRect().top-sc.getBoundingClientRect().top-22;
        }""")
        expect(source.locator("#reading-progress")).to_contain_text("абзац 2 / 2")
        source.goto(origin+"/app.html#profile/backups")
        expect(source.locator("#backup-art")).not_to_be_checked()
        with source.expect_download() as event:
            source.locator("#export-backup").tap()
        plain=json.loads(Path(event.value.path()).read_bytes())
        assert plain["version"]==1 and "epubArt" not in plain
        assert ALT not in json.dumps(plain)
        source.locator("#backup-art").check()
        source.get_by_role("button",name="Подготовить копию с иллюстрациями").tap()
        prepared=source.get_by_role("link",name="Скачать подготовленную копию")
        expect(prepared).to_be_visible()
        box=prepared.bounding_box()
        assert 0<=box["x"] and box["x"]+box["width"]<=320,box
        with source.expect_download() as event:
            prepared.tap()
        complete=Path(event.value.path()).read_bytes()
        content=json.loads(complete)
        assert content["version"]==1 and len(content["epubArt"])==1
        assert len(content["epubArt"][0]["assets"])==1
        prepared_url=prepared.get_attribute("href")
        source.locator(".profile-stack-page[data-stack-page=backups] [data-profile-up]").tap()
        expect(prepared).to_be_hidden()
        assert not source.evaluate("url=>fetch(url).then(r=>r.ok,()=>false)",prepared_url)

        fresh=profile("#profile/backups")
        fresh.locator("#open-backup").tap()
        def choose(payload):
            fresh.locator("#backup-file").set_input_files({"name":"synthetic-backup.json",
              "mimeType":"application/json","buffer":payload})

        content["epubArt"][0]["assets"][0]["type"]="image/svg+xml"
        choose(json.dumps(content).encode())
        expect(fresh.locator("#backup-preview")).to_contain_text("повреждены")
        expect(fresh.locator("#restore-backup")).to_be_disabled()
        choose(complete)
        expect(fresh.locator("#backup-preview")).to_contain_text("Иллюстраций в новых книгах: 1")
        fresh.locator("#restore-backup").tap()
        expect(fresh.locator("#toast")).to_contain_text("Копия восстановлена")
        fresh.locator("[data-view=home]:visible").first.tap()
        fresh.locator("#continue-card button").tap()
        expect(fresh.locator("#reading-progress")).to_contain_text("абзац 2 / 2")
        expect(fresh.locator("#passage #paragraph-0 + figure:has(+ #paragraph-1)").get_by_role("img",name=ALT)).to_be_visible()
        fresh.get_by_role("button",name="Увеличить иллюстрацию: "+ALT).tap()
        expect(fresh.get_by_role("dialog",name="Иллюстрация",exact=True)).to_be_visible()
        fresh.wait_for_function("document.querySelector('#illustration-full img')?.naturalHeight===160")
        fresh.get_by_role("button",name="Закрыть иллюстрацию").tap()

        older=profile("#profile/backups")
        older.locator("#open-backup").tap()
        older.locator("#backup-file").set_input_files({"name":"old-v1.json",
          "mimeType":"application/json","buffer":json.dumps(plain).encode()})
        older.locator("#restore-backup").tap()
        expect(older.locator("#toast")).to_contain_text("Копия восстановлена")
        older.locator("[data-view=home]:visible").first.tap()
        older.locator("#continue-card button").tap()
        expect(older.locator("#reading-progress")).to_contain_text("абзац 2 / 2")
        expect(older.locator("#passage figure")).to_have_count(0)
        assert not external,external
        assert not errors,errors
        b.close()
    print("320px local backup: EPUB art included only by explicit choice, rejected corrupt art, restored exact position and full-screen local raster, accepted older text-only v1.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
