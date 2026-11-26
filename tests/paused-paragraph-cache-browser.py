"""A paused translated book still opens its saved translation after restart."""
from argparse import ArgumentParser
from pathlib import Path
import runpy
from time import monotonic
from playwright.sync_api import expect, sync_playwright

suite = runpy.run_path(str(Path(__file__).with_name("paragraph-cache-browser.py")))
serve, MODEL_MOCK, COUNT_CACHE = (suite[name] for name in ("serving", "MODEL_MOCK", "COUNT_CACHE"))


def run(dist, chromium):
    source = (dist / "local-translation.js").read_text("utf-8")
    adapter = source.replace("export function createLocalTranslator(",
                             "function realLocalTranslator(", 1) + MODEL_MOCK
    with serve(dist) as origin, sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=chromium, headless=True, args=["--disable-dev-shm-usage"])
        c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                          has_touch=True, service_workers="block")
        downloads = []

        def fence(route):
            url = route.request.url
            if url == origin + "/local-translation.js":
                return route.fulfill(content_type="text/javascript", body=adapter)
            if url.startswith(origin + "/vendor/bergamot/"):
                downloads.append(url)
                return route.abort()
            if url.startswith((origin + "/", "blob:", "data:")):
                return route.continue_()
            return route.abort()

        c.route("**/*", fence)
        p = c.new_page()
        errors = []
        p.on("pageerror", lambda e: errors.append(str(e)))
        p.goto(origin + "/app.html#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("[data-lang-continue]").first.click()
        p.locator("#import-open").click()
        p.locator("#original-file").set_input_files({"name": "Paused fixture.txt", "mimeType": "text/plain",
            "buffer": b"The river enters the sea.\n\nThe travellers take a boat."})
        p.locator("#preview-import").click()
        p.locator("#save-import").click()
        dialog = p.locator("#translation-dialog")
        p.locator("#translation-full").click()
        p.evaluate("window.holdNextParagraph=true")
        p.locator("#local-translation-start").click()
        p.wait_for_function("typeof releaseParagraph === 'function'")
        dialog.locator("[data-sheet-handle]").click()
        expect(dialog).to_be_hidden()
        toggle = p.locator("#local-translation-open")
        # Without scrolling or selecting another word, this action must
        # already describe what it does rather than inviting a second tap.
        expect(toggle).to_have_text("Пауза",timeout=1500)
        expect(toggle).to_have_accessible_name("Приостановить автоперевод")
        expect(p.locator("#translation-track")).to_contain_text("Переводим на устройстве")
        assert p.evaluate("paragraphModelCalls") == [{"allowNetwork":True}]
        toggle.click()
        expect(toggle).to_have_text("Перевести")
        assert p.evaluate(COUNT_CACHE) == 0
        p.evaluate("releaseParagraph()")
        expect(toggle).to_have_text("Продолжить")
        deadline = monotonic() + 2.5
        while p.evaluate(COUNT_CACHE) != 1 and monotonic() < deadline:
            p.wait_for_timeout(60)
        assert p.evaluate(COUNT_CACHE) == 1, "Finished manual translation was not stored after Pause"
        p.reload()
        p.locator("#folio-boot").wait_for(state="detached")
        expect(dialog).to_be_hidden()
        assert p.evaluate("window.paragraphModelCalls") == []
        # The word's context is its own entry point. Search it before opening
        # the translation sheet or the model's fresh memory will mask the bug.
        word_sheet = p.locator("#word-dialog")
        p.locator("#paragraph-0 .word").first.tap()
        word_sheet.locator("#word-context-toggle").tap()
        context = word_sheet.locator("#word-context")
        expect(context.locator(".word-parallel")).to_contain_text("The river enters the sea.")
        expect(context.get_by_role("button",name="Перевести абзац")).to_have_count(0)
        assert p.evaluate("window.paragraphModelCalls") == []
        word_sheet.locator("[data-sheet-handle]").tap()
        expect(word_sheet).to_be_hidden()
        p.locator("#translation-full").click()
        expect(dialog.locator(".machine-result")).to_contain_text("The river enters the sea.")
        expect(p.locator("#local-translation-section")).to_be_hidden()
        assert p.evaluate("window.paragraphModelCalls") == []
        dialog.locator("[data-sheet-handle]").click()
        expect(dialog).to_be_hidden()
        expect(toggle).to_have_text("Продолжить")
        # View a different, not-yet-translated paragraph. It still needs an
        # explicit translation action and may not reuse the first text's cache.
        p.locator("#paragraph-1 .word").first.click()
        word_sheet.locator("#word-context-toggle").tap()
        expect(context.get_by_role("button",name="Перевести абзац")).to_be_visible()
        expect(context.locator(".word-parallel")).to_have_count(0)
        assert p.evaluate("window.paragraphModelCalls") == []
        p.locator("#word-dialog [data-sheet-handle]").click()
        expect(p.locator("#word-dialog")).to_be_hidden()
        p.locator("#translation-full").click()
        expect(p.locator("#local-translation-start")).to_be_enabled()
        expect(dialog.locator(".machine-result")).to_have_count(0)
        assert p.evaluate("window.paragraphModelCalls") == []
        assert not downloads and not errors, (downloads, errors)
        print("An in-flight manual translation was saved after Pause and survived reload; uncached text still waits.")
        b.close()


if __name__ == "__main__":
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("dist", type=Path)
    parser.add_argument("--chromium")
    a = parser.parse_args()
    run(a.dist.resolve(), a.chromium)
