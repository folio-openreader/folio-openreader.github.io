"""A retry must not turn a hand-picked vocabulary exercise into an automatic one."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from playwright.sync_api import expect, sync_playwright

serve = runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
UNKNOWN = "zyxunrecordedleaf"
KNOWN = ("lantern","ferry","canal","dock","shore","letter","ink","umbrella","cabin","island")


def run(dist, chromium):
    with serve(dist) as origin, sync_playwright() as pw:
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True,service_workers="block")
        c.route("**/*",lambda r:r.continue_() if
                r.request.url.startswith((origin+"/","blob:","data:")) else r.abort())
        c.add_init_script("""
          localStorage.setItem('folio-v2',JSON.stringify({prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));
          const stamp=Date.now()-1000;
          const words=location.search?['lantern','ferry','canal','dock','shore','letter','ink','umbrella','cabin','island']:
            ['zyxunrecordedleaf','lantern'];
          localStorage.setItem('folio-learning-v1',JSON.stringify({version:1,rows:words.map(
            word=>[word,'en',stamp,0,0,0,0,stamp,{}])}));
        """)
        p=c.new_page()
        errors=[]
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(origin+"/app.html#words")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#word-selection-toggle").tap()
        p.locator(f'[data-study-word="en:{UNKNOWN}"] input').check()
        p.locator("#words-to-practice").tap()
        status=p.locator("#lesson-status")
        start=p.locator("#lesson-start")
        expect(status).to_contain_text("Не нашлось слов с подходящими значениями")
        expect(p.locator("#lesson-scope-label")).to_have_text("Вы выбрали: 1 слово")
        start.tap()
        expect(status).to_contain_text("Не нашлось слов с подходящими значениями")
        expect(p.locator("#lesson-game")).to_be_hidden()
        p.locator("#lesson-choose").tap()
        expect(p.locator(f'#lesson-options input[value="en:{UNKNOWN}"]')).to_be_checked()
        expect(p.locator('#lesson-options input[value="en:lantern"]')).not_to_be_checked()
        p.locator("#lesson-clear").tap()
        expect(p.locator("#lesson-scope-label")).to_have_text("Автоподбор слов")
        start.tap()
        expect(p.locator("#lesson-game")).to_be_visible()
        expect(p.locator("#lesson-prompt")).to_contain_text("фонарь")
        p.goto(origin+"/app.html?many#words")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#word-selection-toggle").tap()
        for word in KNOWN:
            p.locator(f'[data-study-word="en:{word}"] input').check()
        p.locator("#words-to-practice").tap()
        expect(p.locator("#lesson-game .lesson-source-note")).to_have_text(
            "В этой серии 8 из 10 выбранных слов. Лимит серии: 8.")
        p.locator("#lesson-exit").tap()
        expect(p.locator("#lesson-scope-label")).to_have_text("Вы выбрали: 10 слов")
        p.locator("#lesson-choose").tap()
        expect(p.locator("#lesson-pick-count")).to_have_text("Выбрано: 10 · до 8 за серию")
        assert not errors,errors
        print("Manual dictionary selection survived failure and Retry; automatic practice started only after Clear.")
        b.close()


if __name__ == "__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    a=parser.parse_args()
    run(a.dist.resolve(),a.chromium)
