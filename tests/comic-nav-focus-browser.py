"""Keyboard focus stays in comic page controls when a navigation button becomes disabled."""
from argparse import ArgumentParser
from pathlib import Path
from struct import pack
import runpy
import zlib
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]


def panel(mark):
    width, height = 120, 160
    def chunk(tag, data):
        return pack(">I", len(data)) + tag + data + pack(">I", zlib.crc32(tag + data))
    rows = (b"\0" + bytes((35 + mark * 20, 55, 95)) * width) * height
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", pack(">IIBBBBB",width,height,8,2,0,0,0))
            + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b""))


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = browser.new_context(viewport={"width":1100,"height":780}, reduced_motion="reduce",
                                service_workers="block")
        c.route("**/*", lambda r: r.continue_() if
                r.request.url.startswith((origin + "/", "blob:", "data:")) else r.abort())
        c.add_init_script("""localStorage.setItem('folio-v2',
          JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        p = c.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.set_default_timeout(6500)
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#comic-import-open").click()
        p.locator("#comic-files").set_input_files([{"name":f"0{i}.png","mimeType":"image/png","buffer":panel(i)}
                                                   for i in range(1,4)])
        p.locator("#comic-import-start").click()
        art, prev, nxt, count = (p.locator(s) for s in [".comic-art",".comic-prev",".comic-next",".comic-count"])
        expect(art).to_have_attribute("alt","Страница 1")
        expect(prev).to_be_disabled()
        nxt.press("Enter")
        expect(art).to_have_attribute("alt","Страница 2")
        expect(nxt).to_be_focused()
        p.keyboard.press("Enter")
        expect(art).to_have_attribute("alt","Страница 3")
        expect(nxt).to_be_disabled()
        expect(count).to_be_focused(timeout=1600)
        expect(count).to_have_accessible_name("Страница 3 из 3")
        # Count is not a reverse-page action. Tab advances inside the comic UI,
        # and Shift+Tab always reaches the still-enabled backwards control.
        p.keyboard.press("Enter")
        expect(art).to_have_attribute("alt","Страница 3")
        p.keyboard.press("Tab")
        expect(p.locator(".comic-scan")).to_be_focused()
        count.focus()
        p.keyboard.press("Shift+Tab")
        expect(prev).to_be_focused()
        p.keyboard.press("Enter")
        expect(art).to_have_attribute("alt","Страница 2")
        expect(prev).to_be_focused()
        p.keyboard.press("Enter")
        expect(art).to_have_attribute("alt","Страница 1")
        expect(count).to_be_focused()
        expect(count).to_have_accessible_name("Страница 1 из 3")
        p.keyboard.press("Tab")
        expect(nxt).to_be_focused()
        assert not errors, errors
        print("3-page comic: navigation retains focus, both boundaries focus the labeled page count, Tab stays local")
        browser.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
