"""Built-in catalog release dates are searchable without fetching book text."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
NUTKIN="starter-squirrel-nutkin"


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,
                        service_workers="block",reduced_motion="reduce")
        fetches=[]
        def fence(r):
            url=r.request.url
            if url.startswith(origin+"/starter/books/"):
                fetches.append(url)
            if url.startswith((origin+"/","blob:","data:")):
                return r.continue_()
            return r.abort()
        c.route("**/*",fence)
        c.add_init_script("""localStorage.setItem('folio-v2', JSON.stringify({prefs:{
          readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e: errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        shelf=p.locator("#starter-shelf")
        cards=shelf.locator(".starter-card")
        search=shelf.get_by_role("searchbox",name="Поиск стартовых книг")
        search.fill("1903")
        expect(cards).to_have_count(2,timeout=1700)
        expect(shelf.locator(".starter-book-title")).to_have_text(["The Tale of Squirrel Nutkin","The Call of the Wild"])
        expect(shelf.locator(".starter-publication-year")).to_have_text(["1903","1903"])
        search.fill("1869")
        expect(shelf.locator(".starter-book-title")).to_have_text(["Little Women"])
        expect(shelf.locator(".starter-publication-year")).to_have_text(["1868–1869"])
        search.fill("1838")
        expect(shelf.locator(".starter-book-title")).to_have_text(["Oliver Twist"])
        expect(shelf.locator(".starter-publication-year")).to_have_text(["1837–1839"])
        assert fetches == [], fetches
        search.fill("1903")
        candidate=shelf.locator(f'[data-starter-book="{NUTKIN}"]')
        expect(candidate).to_have_accessible_name("Скачать и читать: The Tale of Squirrel Nutkin, Beatrix Potter, 1903, сложность A2, Английский")
        candidate.tap()
        expect(p.locator("#book-title")).to_have_text("The Tale of Squirrel Nutkin")
        p.locator("#chapter-open").tap()
        expect(p.locator("#starter-edition")).to_contain_text("Год издания: 1903")
        assert fetches==[origin+f"/starter/books/{NUTKIN}.json"]
        assert not errors,errors
        print("Single years and the middle of a serial range are searchable; browsing did not fetch book text.")
        b.close()


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
