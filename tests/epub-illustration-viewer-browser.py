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

        cover.press("Enter")
        fullscreen_url=inspect()
        p.go_back()
        stayed(fullscreen_url)
        p.go_forward()
        fullscreen_url=inspect()
        close.tap()
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
        assert not unexpected,unexpected
        assert not errors,errors
        b.close()
    print("320px EPUB illustration: full-screen tap/keyboard, Escape/Back/Forward/close, reader point and independent Blob URL cleanup all passed.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium)
