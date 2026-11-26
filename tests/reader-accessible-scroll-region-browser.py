"""The keyboard reader announces a named, appropriately described text or comic region."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("comic-nav-focus-browser.py")))
serve, panel=fixture["serve"],fixture["panel"]
TEXT_KEYS="Tab переходит между абзацами. Стрелки влево и вправо выбирают слово, Enter открывает словарь."
COMIC_KEYS="Tab переходит к кнопкам страницы. После распознавания можно открыть текст и выбрать слово стрелками влево и вправо."


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        service_workers="block",reduced_motion="reduce")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({prefs:{
            readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#home")
        p.locator("#folio-boot").wait_for(state="detached")
        scroll=p.locator("#reading-scroll")
        def region(name, instructions):
            expect(scroll).to_be_focused()
            expect(scroll).to_have_role("region",timeout=1200)
            expect(scroll).to_have_accessible_name(name)
            expect(scroll).to_have_accessible_description(instructions)
        opening=p.locator("#continue-card button")
        expect(opening).to_be_visible()
        opening.press("Enter")
        region("Оригинал книги",TEXT_KEYS)
        first=p.locator("#paragraph-0 button.word").first
        expect(first).to_be_visible()
        p.keyboard.press("Tab")
        expect(first).to_be_focused()
        p.locator("#reader-back").press("Enter")
        expect(p.locator("#reader")).to_be_hidden()
        p.locator('[data-view="library"]:visible').first.press("Enter")
        p.locator("#comic-import-open").tap()
        p.locator("#comic-files").set_input_files(
            {"name":"Panel.png","mimeType":"image/png","buffer":panel(1)})
        p.locator("#comic-import-start").press("Enter")
        expect(p.locator(".comic-art")).to_have_attribute("alt","Страница 1")
        region("Просмотр комикса",COMIC_KEYS)
        p.keyboard.press("Tab")
        expect(p.locator(".comic-scan")).to_be_focused()

        p.locator("#reader-back").press("Enter")
        expect(p.locator("#reader")).to_be_hidden()
        p.locator('[data-view="home"]:visible').first.press("Enter")
        shelf=p.locator('.book-open[data-book="folio-night-ferry"]')
        expect(shelf).to_be_visible()
        shelf.press("Enter")
        region("Оригинал книги",TEXT_KEYS)
        assert not errors,errors
        print("Chromium accessibility: named text/comic regions, distinct keyboard descriptions, and usable Tab targets on both.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
