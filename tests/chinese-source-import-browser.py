"""Untagged book imports can explicitly choose Chinese on the source side only."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
TEXT="📚今天我们去公园。明天我们还去公园。"


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        service_workers="block",reduced_motion="reduce")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        for role,name,text in [("original","Garden.txt",TEXT),("translation","Translation.txt","Сегодня мы идём в парк.")]:
            p.locator("#"+role+"-file").set_input_files({"name":name,"mimeType":"text/plain","buffer":text.encode()})
        p.locator("#preview-import").tap()
        preview=p.locator("#import-preview")
        source=preview.get_by_role("combobox",name="Язык оригинала (не указан в файле)",exact=True)
        target=preview.get_by_role("combobox",name="Язык парного файла (не указан в файле)",exact=True)
        expect(source).to_have_value("")
        expect(source.locator('option[value="zh"]')).to_have_text("Китайский",timeout=1600)
        expect(target.locator('option[value^="zh"]')).to_have_count(0)
        expect(target).to_have_value("ru")
        source.select_option("zh")
        expect(preview.locator(".preview-pair p").first).to_have_attribute("lang","zh")
        p.locator("#remove-translation-file").tap()
        expect(source).to_have_value("zh")
        p.locator("#save-import").tap()
        row=p.locator("#paragraph-0")
        expect(row).to_have_attribute("lang","zh")
        expect(row.get_by_role("button",name="公园",exact=True)).to_have_count(2)
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(row).to_have_text(TEXT)
        expect(row).to_have_attribute("lang","zh")
        row.get_by_role("button",name="公园",exact=True).last.tap()
        word=p.locator("#word-dialog")
        expect(word.locator("#word-sheet-heading")).to_have_text("公园")
        expect(word.locator(".word-lookup")).to_contain_text("Для языка ZH нет установленного словаря")
        word.locator("#word-context-toggle").tap()
        expect(word.locator("#word-context mark")).to_have_text("公园")
        assert word.locator("#word-context mark").evaluate("el=>el.nextSibling.textContent")=="。"
        word.locator("[data-sheet-handle]").tap()
        p.locator("#translation-full").tap()
        sheet=p.locator("#translation-dialog")
        expect(sheet.locator("#translation-result")).to_have_text("Нет локальной модели для ZH → RU.")
        expect(sheet.locator("#local-translation-start")).to_be_hidden()
        assert not errors,errors
        print("Chinese remained an explicit source only; removal and cold reload preserved it, the second word was selectable, and dictionary/model notices stayed truthful.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
