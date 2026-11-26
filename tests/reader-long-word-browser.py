"""Long source words stay fully visible and tappable on a narrow reader."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
epub = runpy.run_path(str(Path(__file__).with_name("rtl-reader-sheets-browser.py")))["epub"]
WORD = "Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz"
TEXT = f"Im alten Archiv steht das {WORD} noch im Register."
RECTS = """el=>{
  const range=document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()].filter(r=>r.width>0).map(r=>({left:r.left,right:r.right,y:r.y}));
}"""


def assert_fits(locator, left, right, label, *, wraps=False):
    rects = locator.evaluate(RECTS)
    assert rects and all(r["left"] >= left-1 and r["right"] <= right+1 for r in rects), (label,left,right,rects)
    if wraps:
        assert len({round(r["y"]) for r in rects}) > 1, (label,rects)


def run(dist, chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        context=browser.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                                    reduced_motion="reduce",service_workers="block")
        context.route("**/*",lambda r:r.continue_() if
                      r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        context.add_init_script("""localStorage.setItem('folio-v2',JSON.stringify({
           prefs:{readingLanguage:'de',dictionaryTarget:'ru',languageSetup:'done',size:30}}));""")
        page=context.new_page()
        page.set_default_timeout(6500)
        errors=[]
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.goto(origin+"/app.html#library")
        page.locator("#folio-boot").wait_for(state="detached")
        page.locator("#import-open").tap()
        page.locator("#original-file").set_input_files({"name":"Compound.epub",
            "mimeType":"application/epub+zip","buffer":epub(WORD,"de",TEXT)})
        page.locator("#preview-import").tap()
        page.locator("#save-import").tap()

        target=page.locator("#passage").get_by_role("button",name=WORD,exact=True)
        expect(target).to_have_count(1)
        expect(target).to_have_css("font-size","30px")
        paragraph=page.locator("#paragraph-0")
        expect(paragraph).to_have_text(TEXT)
        left,right=paragraph.evaluate("""p=>{
          const {left,right}=p.getBoundingClientRect(),s=getComputedStyle(p);
          return [left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft),
                  right-parseFloat(s.borderRightWidth)-parseFloat(s.paddingRight)];
        }""")
        assert_fits(target,left,right,"reader word",wraps=True)
        assert_fits(page.locator("#chapter-heading"),left,right,"chapter heading",wraps=True)
        last=target.evaluate(RECTS)[-1]
        page.touchscreen.tap((last["left"]+last["right"])/2,last["y"]+7)
        heading=page.locator("#word-sheet-heading")
        expect(heading).to_have_text(WORD)
        page.evaluate("document.fonts.ready")
        height=heading.evaluate("el=>({visible:el.clientHeight,content:el.scrollHeight})")
        # Serif glyph ink can extend a few pixels outside the CSS line box.
        assert height["content"]<=height["visible"]+5, ("word sheet clips selected word",height)
        expect(heading).to_have_css("overflow-y","visible")
        extent=heading.bounding_box()
        assert_fits(heading,extent["x"],extent["x"]+extent["width"],"word sheet heading",wraps=True)
        expect(page.locator("#word-ai-entry")).to_be_visible()
        page.locator("#word-context-toggle").tap()
        excerpt=page.locator(".word-original")
        extent=excerpt.bounding_box()
        assert_fits(excerpt,extent["x"],extent["x"]+extent["width"],"word context")
        expect(excerpt.locator("mark")).to_have_text(WORD)
        page.locator("#word-dialog [data-sheet-handle]").tap()

        page.locator("#reader-bookmark").tap()
        page.locator("#chapter-open").tap()
        expect(page.locator("#contents-dialog")).to_be_visible()
        row=page.locator("#chapter-list .chapter-row").first
        extent=row.bounding_box()
        assert_fits(row,extent["x"],extent["x"]+extent["width"],"contents chapter")
        bookmark=page.locator("#bookmarks-list .chapter-row").first
        extent=bookmark.bounding_box()
        assert_fits(bookmark,extent["x"],extent["x"]+extent["width"],"bookmark title")
        assert not errors,errors
        print("320px/30px reader: compound wraps and its last line opens one exact word; full word-sheet heading, chapter title, context and contents fit.")
        browser.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
