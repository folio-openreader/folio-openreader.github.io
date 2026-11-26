"""True bundled Korean OCR on original tall comic art in Folio's mobile UI.

Requires Playwright, Pillow, Chromium, and Noto Sans CJK Bold. No model mocks.
"""
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
import runpy
from time import monotonic
from zipfile import ZIP_DEFLATED, ZipFile
from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import expect, sync_playwright

serve=runpy.run_path(str(Path(__file__).with_name("sync-browser.py")))["serving"]
FONT="/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
TOP="작은 정원"
BOTTOM="좋은 아침"


def sample(font_path):
    image=Image.new("RGB",(700,4800),"white")
    draw=ImageDraw.Draw(image)
    font=ImageFont.truetype(font_path,55,index=1 if font_path.endswith(".ttc") else 0)
    for y,text in [(180,TOP),(4500,BOTTOM)]:
        draw.rounded_rectangle((75,y,625,y+182),radius=46,fill="#fff",outline="#7f838a",width=2)
        draw.text((350,y+43),text,fill="#111",font=font,anchor="mt")
    png=BytesIO()
    image.save(png,format="PNG")
    archive=BytesIO()
    with ZipFile(archive,"w",compression=ZIP_DEFLATED) as z:
        z.writestr("001.png",png.getvalue())
    return archive.getvalue()


def run(dist,chromium,font):
    with serve(dist) as origin,sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        context=browser.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                                    reduced_motion="reduce",service_workers="block")
        external,ocr_assets,errors=[],[],[]
        def fence(route):
            url=route.request.url
            if url.startswith((origin+"/","blob:","data:")):
                if "/ocr-v1/" in url: ocr_assets.append(url.rsplit("/",1)[-1])
                route.continue_()
            else:
                external.append(url)
                route.abort()
        context.route("**/*",fence)
        context.add_init_script("""if(!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}));""")
        page=context.new_page()
        page.set_default_timeout(20000)
        page.on("pageerror",lambda error:errors.append(str(error)))
        page.goto(origin+"/app.html#library")
        page.locator("#folio-boot").wait_for(state="detached")
        page.locator("#comic-import-open").tap()
        page.locator("#comic-language").select_option("kor")
        page.locator("#comic-files").set_input_files({"name":"Korean garden.cbz",
            "mimeType":"application/x-cbz","buffer":sample(font)})
        page.locator("#comic-import-start").tap()
        expect(page.locator(".comic-art")).to_be_visible()
        scan=page.locator(".comic-scan")
        expect(scan).to_be_enabled()
        initial_height=page.locator(".comic-bar").evaluate("el=>el.offsetHeight")
        page.evaluate("""() => {
          window.ocrUI=[];
          const reader=document.querySelector('.comic-reader');
          new MutationObserver(()=>{
            const bar=reader.querySelector('progress:not([hidden])');
            if(bar)window.ocrUI.push([bar.getAttribute('value'),bar.getAttribute('aria-valuetext'),bar.parentElement.offsetHeight]);
          }).observe(reader,{subtree:true,attributes:true,attributeFilter:['value','aria-valuetext','hidden']});
        }""")
        started=monotonic()
        scan.tap()
        expect(page.locator(".comic-text-toggle")).to_be_visible(timeout=30000)
        duration=(monotonic()-started)*1000
        hits=page.locator(".comic-hotspot").all_text_contents()
        print(f"Worker cold OCR: {duration:.0f} ms, hits {hits!r}, resources {ocr_assets!r}.")
        # The small model still can misread the harder bottom speech balloon.
        # Check an exact top phrase and positional ink in both real regions.
        assert hits[:2]==["작은","정원"],hits
        box_tops=page.locator(".comic-hotspot").evaluate_all("el=>el.map(x=>parseFloat(x.style.top))")
        assert min(box_tops)<10 and max(box_tops)>90,box_tops
        assert "kor.traineddata.gz" in ocr_assets,ocr_assets
        assert not any(asset.endswith(".traineddata.gz") and asset!="kor.traineddata.gz" for asset in ocr_assets),ocr_assets
        transitions=page.evaluate("window.ocrUI")
        active=[(value,label) for value,label,height in transitions if label]
        print(f"Worker UI stages: {list(dict.fromkeys(label for _,label in active))!r}")
        assert any(value is None and "Подготовка" in label for value,label in active),active
        assert any(value is None and "локального OCR" in label for value,label in active),active
        values=[float(value) for value,label in active if value is not None]
        assert values and values[0]<1 and values[-1]==1 and values==sorted(values),values
        assert any("Фрагмент 1 из" in label for _,label in active),active
        assert any("Сохранение" in label for _,label in active),active
        assert all(height==initial_height for _,_,height in transitions),transitions
        expect(page.locator(".comic-ocr-progress")).to_be_hidden()
        page.locator(".comic-text-toggle").tap()
        lines=page.locator(".comic-transcript p").all_text_contents()
        assert len(lines)>=2 and lines[0]==TOP,lines
        page.locator(".comic-transcript").get_by_role("button",name="정원",exact=True).tap()
        expect(page.locator("#word-sheet-heading")).to_have_text("정원")
        page.locator("#word-dialog [data-sheet-handle]").tap()
        count=len(ocr_assets)
        page.reload()
        page.locator("#folio-boot").wait_for(state="detached")
        expect(page.locator(".comic-text-toggle")).to_be_visible()
        page.locator(".comic-text-toggle").tap()
        expect(page.locator(".comic-transcript p")).to_have_text(lines)
        assert len(ocr_assets)==count,ocr_assets
        assert not external,external
        assert not errors,errors
        browser.close()
    print("320px Korean CBZ: real same-origin worker, steady progress on a tall page, and saved OCR after reload.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    parser.add_argument("--font",default=FONT)
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium,args.font)
