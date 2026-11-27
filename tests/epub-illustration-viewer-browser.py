"""Tap or keyboard-open a local EPUB illustration, then return to the same place."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

data=runpy.run_path(str(Path(__file__).with_name("epub-illustrations-browser.py")))
serve,epub=data["serve"],data["epub"]
NAME="Увеличить иллюстрацию: "+data["ALT"]


def run(dist,chromium):
    with serve(dist) as origin,sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="block")
        unexpected=[]
        def fence(route):
            if route.request.url.startswith((origin+"/","blob:","data:")): route.continue_()
            else:
                unexpected.append(route.request.url)
                route.abort()
        c.route("**/*",fence)
        p=c.new_page()
        p.set_default_timeout(6500)
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Light and garden.epub",
          "mimeType":"application/epub+zip","buffer":epub("Light and garden","en",data["BEFORE"],data["AFTER"],art=True)})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        viewer=p.get_by_role("dialog",name="Иллюстрация",exact=True)
        cover=p.get_by_role("button",name=NAME,exact=True)
        close=p.get_by_role("button",name="Закрыть иллюстрацию",exact=True)
        scroll=p.locator("#reading-scroll")
        expect(cover).to_be_visible()
        scroll.evaluate("sc=>sc.scrollTop=55")
        p.wait_for_function("document.querySelector('#reading-scroll').scrollTop===55")

        before_word=p.locator("#paragraph-0").get_by_role("button",name="hill",exact=True)
        before_word.focus()
        p.keyboard.press("Tab")
        expect(cover).to_be_focused()
        focused_url=cover.locator("img").get_attribute("src")
        p.keyboard.press("PageDown")
        p.keyboard.press("PageDown")
        p.wait_for_function("""() => {
          const sc=document.querySelector('#reading-scroll');
          const art=sc.querySelector('figure');
          return sc.scrollTop>600&&art.getBoundingClientRect().bottom+321<sc.getBoundingClientRect().top;
        }""")
        # Wait for the browser's lazy-window observer to be delivered (not merely scrollTop).
        p.evaluate("() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done,0))))")
        expect(cover).to_be_focused()
        offscreen_point=scroll.evaluate("el=>el.scrollTop")
        p.keyboard.press("Enter")
        expect(viewer.get_by_role("img",name=data["ALT"],exact=True)).to_be_visible()
        expect(close).to_be_focused()
        p.keyboard.press("Escape")
        expect(viewer).to_be_hidden()
        expect(cover).to_be_focused()
        p.wait_for_function("!history.state?.folioIllustration")
        assert abs(scroll.evaluate("el=>el.scrollTop")-offscreen_point)<=1
        p.keyboard.press("Tab")
        expect(p.locator("#paragraph-1").get_by_role("button",name="The",exact=True).first).to_be_focused()
        # Once focus moves on, the previous offscreen Blob is released as before.
        assert not p.evaluate("url=>fetch(url).then(r=>r.ok,()=>false)",focused_url)
        scroll.evaluate("sc=>sc.scrollTop=55")
        p.wait_for_function("document.querySelector('#reading-scroll').scrollTop===55")
        expect(cover).to_be_visible()
        point=scroll.evaluate("el=>el.scrollTop")
        reading=p.locator("#reading-progress").text_content()
        in_book=p.url
        thumb=cover.locator("img").get_attribute("src")
        assert thumb.startswith("blob:")
        can_read="url=>fetch(url).then(r=>r.ok,()=>false)"

        def inspect():
            expect(viewer).to_be_visible()
            expect(close).to_be_focused()
            pic=viewer.get_by_role("img",name=data["ALT"],exact=True)
            p.wait_for_function("document.querySelector('#illustration-full img')?.naturalWidth===120")
            box=viewer.bounding_box()
            assert box["width"]>=319 and box["height"]>=736,box
            url=pic.get_attribute("src")
            assert url.startswith("blob:") and url!=thumb,url
            assert p.evaluate(can_read,url)
            return url

        def stayed(url):
            expect(viewer).to_be_hidden()
            expect(p.locator("#reader")).to_be_visible()
            expect(cover).to_be_focused()
            assert abs(scroll.evaluate("el=>el.scrollTop")-point)<=1
            expect(p.locator("#reading-progress")).to_have_text(reading)
            assert p.url==in_book
            assert not p.evaluate(can_read,url)
            assert p.evaluate(can_read,thumb)

        cover.tap()
        fullscreen_url=inspect()
        p.keyboard.press("Escape")
        stayed(fullscreen_url)
        p.wait_for_function("!history.state?.folioIllustration")

        before_word.focus()
        p.keyboard.press("Tab")
        expect(cover).to_be_focused()
        p.keyboard.press("Enter")
        fullscreen_url=inspect()
        for key in ("Tab","Shift+Tab","Tab"):
            p.keyboard.press(key)
            expect(close).to_be_focused()
        p.go_back()
        stayed(fullscreen_url)
        p.go_forward()
        fullscreen_url=inspect()
        p.keyboard.press("Shift+Tab")
        expect(close).to_be_focused()
        p.keyboard.press("Enter")
        stayed(fullscreen_url)
        p.wait_for_function("!history.state?.folioIllustration")

        # Close consumed its own history entry: the next Back leaves the book,
        # and Continue restores the same real reading position, not the viewer.
        p.go_back()
        expect(p.locator("#library-view")).to_be_visible()
        expect(p.locator("#reader")).to_be_hidden()
        p.locator("[data-view=home]:visible").first.tap()
        p.locator("#continue-card button").tap()
        expect(p.locator("#reader")).to_be_visible()
        expect(viewer).to_be_hidden()
        p.wait_for_function("expected=>Math.abs(document.querySelector('#reading-scroll').scrollTop-expected)<2",arg=point)
        # Reload inside the viewer keeps its same local illustration and history
        # entry, rather than leaving a hidden overlay that swallows the next Back.
        expect(cover).to_be_visible()
        cover.tap()
        inspect()
        token=p.evaluate("history.state?.folioIllustration")
        length=p.evaluate("history.length")
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(cover).to_be_visible()
        thumb=cover.locator("img").get_attribute("src")
        full_after_reload=inspect()
        assert p.evaluate("history.state?.folioIllustration")==token
        assert p.evaluate("history.length")==length
        p.go_back()
        stayed(full_after_reload)
        p.go_forward()
        full_after_reload=inspect()
        close.tap()
        stayed(full_after_reload)
        p.wait_for_function("!history.state?.folioIllustration")
        p.go_back()
        expect(p.locator("#reader")).to_be_hidden()
        expect(p.locator("#home")).to_be_visible()
        assert not unexpected,unexpected
        assert not errors,errors
        b.close()
    print("320px EPUB illustration: lazy inline keyboard order and full-screen tap/keyboard and Tab containment, Escape/Back/Forward/close, reader point and independent Blob URL cleanup all passed.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
