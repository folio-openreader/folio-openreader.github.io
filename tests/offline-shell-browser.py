"""Exercise Folio offline entry points at root and nested URLs with real origin loss."""
from argparse import ArgumentParser
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
import json
import re
import runpy
from playwright.sync_api import Error, expect, sync_playwright

fixture=runpy.run_path(str(Path(__file__).with_name("epub-illustrations-browser.py")))
epub,alt=fixture["epub"],fixture["ALT"]
PREFIX="/releases/folio/"
WORKER="folio-offline-worker.js"


class Handler(SimpleHTTPRequestHandler):
    disconnected=False
    corrupt=False
    root_error=False
    prefix=PREFIX
    paths=[]
    def log_message(self,*args):pass
    def end_headers(self):
        if urlsplit(self.path).path==self.prefix:self.send_header("Cache-Control","no-store")
        super().end_headers()
    def translate_path(self,path):
        path=urlsplit(path).path
        return super().translate_path("/"+path[len(self.prefix):])
    def do_GET(self):
        path=urlsplit(self.path).path
        Handler.paths.append(path)
        if Handler.disconnected:
            self.close_connection=True
            return
        if not path.startswith(self.prefix):
            self.send_error(404)
            return
        if Handler.root_error and path==self.prefix:
            self.send_error(503)
            return
        if Handler.corrupt and path==self.prefix+"style.css":
            body=b"Unexpected package bytes"
            self.send_response(200)
            self.send_header("Content-Type","text/css; charset=utf-8")
            self.send_header("Content-Length",str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:super().do_GET()


@contextmanager
def serving(dist,prefix=PREFIX):
    Handler.prefix=prefix
    Handler.disconnected=Handler.corrupt=Handler.root_error=False
    Handler.paths=[]
    server=ThreadingHTTPServer(("127.0.0.1",0),partial(Handler,directory=str(dist)))
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    try:yield f"http://127.0.0.1:{server.server_port}"
    finally:server.shutdown();server.server_close();thread.join()


def offline_denied(context,url):
    tab=context.new_page()
    try:
        tab.goto(url,timeout=5500,wait_until="commit")
    except Error as e:
        assert "net::ERR_" in str(e),(url,e)
    else:
        raise AssertionError(("unsupported offline path was served",tab.url))
    finally:
        tab.close()


def run(dist,chromium,prefix):
    match=re.search(r"const PACKAGE=(\{.*?\});\n", (dist/WORKER).read_text("utf-8"),re.S)
    manifest=json.loads(match[1])
    with serving(dist,prefix) as origin,sync_playwright() as pw:
        landing=origin+prefix
        home=landing+"app.html"
        parked=landing+"_folio_offline/"+manifest["version"]+"/app.html"
        b=pw.chromium.launch(executable_path=chromium,headless=True,args=["--disable-dev-shm-usage"])
        c=b.new_context(viewport={"width":320,"height":740},is_mobile=True,has_touch=True,
                        reduced_motion="reduce",service_workers="allow")
        errors,unrelated=[],[]
        c.on("request",lambda r:unrelated.append(r.url) if not r.url.startswith((origin+"/","blob:","data:")) else None)
        c.add_init_script("""if(location.protocol==='http:'&&!localStorage.getItem('folio-v2'))localStorage.setItem('folio-v2',JSON.stringify({
          prefs:{readingLanguage:'en',dictionaryTarget:'ru',languageSetup:'done'}}))""")
        p=c.new_page();p.set_default_timeout(9500)
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(landing)
        expect(p.locator(".nav-open[data-reader]")).to_be_visible()
        p.goto(home+"#library")
        p.locator("#folio-boot").wait_for(state="detached")
        assert p.evaluate("navigator.serviceWorker.getRegistrations().then(r=>r.length)")==0
        assert not any(path.endswith(WORKER) for path in Handler.paths),Handler.paths

        Handler.disconnected=True
        offline_denied(c,landing)
        try:
            response=p.reload(timeout=5500,wait_until="domcontentloaded")
            assert False,("offline before consenting must not report a prepared app",response.url)
        except Error:
            pass
        p.close()
        Handler.disconnected=False
        p=c.new_page();p.set_default_timeout(9500)
        p.on("pageerror",lambda e:errors.append(str(e)))
        p.goto(home+"#library")
        p.locator("#folio-boot").wait_for(state="detached")
        p.locator("#import-open").tap()
        p.locator("#original-file").set_input_files({"name":"Offline original.epub",
          "mimeType":"application/epub+zip","buffer":epub("Offline original","en",fixture["BEFORE"],fixture["AFTER"],art=True)})
        p.locator("#preview-import").tap()
        p.locator("#save-import").tap()
        expect(p.locator("#book-title")).to_have_text("Offline original")
        book_url=p.url
        p.locator("#reading-scroll").evaluate("""sc=>{
          const row=sc.querySelector('#paragraph-1');sc.scrollTop+=row.getBoundingClientRect().top-sc.getBoundingClientRect().top-25;
        }""")
        expect(p.locator("#reading-progress")).to_contain_text("абзац 2 / 2")
        p.wait_for_function("""()=>{
          const db=JSON.parse(localStorage.getItem('folio-v2'));return db.positions?.[db.lastBook]?.paragraph===1;
        }""")
        p.goto(home+"#profile/storage")
        expect(p.locator("[data-offline-status]")).to_have_text("Офлайн-копия не подготовлена.")
        expect(p.locator("[data-offline-open]")).to_be_hidden()
        Handler.corrupt=True
        p.locator("[data-offline-prepare]").tap()
        expect(p.locator("[data-offline-status]")).to_contain_text("Не удалось подготовить",timeout=28000)
        expect(p.locator("[data-offline-open]")).to_be_hidden()
        assert p.evaluate("caches.keys().then(a=>a.filter(k=>k.startsWith('folio-offline-shell:')))")==[]
        Handler.disconnected=True
        offline_denied(c,landing)
        Handler.disconnected=False
        Handler.corrupt=False
        p.locator("[data-offline-prepare]").tap()
        expect(p.locator("[data-offline-status]")).to_contain_text("Готово")
        p.wait_for_function("navigator.serviceWorker.controller?.scriptURL.endsWith('folio-offline-worker.js')")
        names,keys=p.evaluate("""async()=>{
          const names=(await caches.keys()).filter(k=>k.startsWith('folio-offline-shell:'));
          const keys=(await (await caches.open(names[0])).keys()).map(r=>new URL(r.url).pathname).sort();
          return [names,keys];
        }""")
        assert names==["folio-offline-shell:"+prefix+":"+manifest["version"]],names
        assert keys==sorted([prefix+x["path"] for x in manifest["assets"]]+[prefix+"_folio_offline_complete"]),keys
        expect(p.locator("[data-offline-open]")).to_have_attribute("href",
            origin+prefix+"_folio_offline/"+manifest["version"]+"/app.html#home")
        before=Handler.paths.count(prefix+"app.html")
        p.goto(book_url,wait_until="domcontentloaded")
        p.reload(wait_until="domcontentloaded")
        p.locator("#folio-boot").wait_for(state="detached")
        assert p.url==book_url and Handler.paths.count(prefix+"app.html")>before
        expect(p.locator("#reading-progress")).to_contain_text("абзац 2 / 2")

        assert p.evaluate("navigator.serviceWorker.controller?.scriptURL"),p.url
        root=c.new_page()
        root.on("pageerror",lambda e:errors.append(str(e)))
        assert root.goto(landing).ok
        assert root.url==landing and root.evaluate("navigator.serviceWorker.controller?.scriptURL")
        expect(root.locator(".nav-open[data-reader]")).to_be_visible()
        Handler.root_error=True
        assert root.reload().status==503 and root.url==landing
        Handler.root_error=False
        assert root.reload().ok
        expect(root.locator(".nav-open[data-reader]")).to_be_visible()

        Handler.disconnected=True
        root.reload(timeout=5500,wait_until="commit")
        root.wait_for_url(parked,timeout=11000)
        root.locator("#folio-boot").wait_for(state="detached")
        root.locator("#continue-card button").tap()
        expect(root.locator("#book-title")).to_have_text("Offline original")
        expect(root.locator("#reading-progress")).to_contain_text("абзац 2 / 2")
        root.wait_for_function("document.querySelector('#passage figure img')?.naturalHeight===160")
        assert root.locator("#passage figure img").get_attribute("src").startswith("blob:")
        assert root.evaluate("url=>fetch(url,{cache:'no-store'}).then(()=>false,()=>true)",landing)
        root.close()
        offline_denied(c,landing+"?launch=1")
        offline_denied(c,landing+"index.html")
        offline_denied(c,origin+"/not-the-folio-scope/nothing.html")
        try:
            p.reload(wait_until="domcontentloaded")
        except Error:
            print("offline reload requests",Handler.paths[-14:],p.url)
            raise
        expect(p.locator("#book-title")).to_have_text("Offline original")
        assert "/_folio_offline/"+manifest["version"]+"/" in p.url and p.url.endswith("#"+book_url.split("#")[-1]),p.url
        expect(p.locator("#reading-progress")).to_contain_text("абзац 2 / 2")
        picture=p.locator("#passage #paragraph-0 + figure:has(+ #paragraph-1)").get_by_role("img",name=alt)
        expect(picture).to_be_visible()
        p.wait_for_function("document.querySelector('#passage figure img')?.naturalHeight===160")
        assert picture.get_attribute("src").startswith("blob:")
        p.locator("#reading-scroll").evaluate("el=>el.scrollTop=56")
        p.wait_for_function("document.querySelector('#reading-scroll').scrollTop===56")
        opener=p.get_by_role("button",name="Увеличить иллюстрацию: "+alt)
        opener.tap()
        p.wait_for_function("document.querySelector('#illustration-full img')?.naturalHeight===160")
        p.reload(wait_until="domcontentloaded")
        p.wait_for_function("document.querySelector('#illustration-full img')?.naturalHeight===160")
        p.get_by_role("button",name="Закрыть иллюстрацию").tap()
        expect(opener).to_be_focused()
        assert abs(p.locator("#reading-scroll").evaluate("el=>el.scrollTop")-56)<=1
        assert p.evaluate("fetch('non-package.js').then(r=>r.status)")==503
        assert p.evaluate("fetch('app.js?random=1').then(r=>r.status)")==503
        assert p.evaluate("fetch('../000000000000000000000000/app.js').then(r=>r.status)")==503
        p.wait_for_function("!history.state?.folioIllustration")
        assert p.evaluate("""async ([name,url])=>(await caches.open(name)).delete(url)""",
                          [names[0],landing+"style.css"])
        offline_denied(c,landing)
        Handler.disconnected=False
        p.goto(home+"#profile/storage")
        expect(p.locator("[data-offline-status]")).to_have_text("Офлайн-копия ещё не готова. Нужен интернет.")
        expect(p.locator("[data-offline-open]")).to_be_hidden()
        p.locator("[data-offline-prepare]").tap()
        expect(p.locator("[data-offline-status]")).to_contain_text("Готово")
        p.evaluate("caches.open('another-local-feature')")
        p.locator("[data-offline-remove]").tap()
        expect(p.locator("[data-offline-status]")).to_have_text("Офлайн-копия не подготовлена.")
        assert p.evaluate("caches.keys().then(a=>a.filter(k=>k.startsWith('folio-offline-shell:')))")==[]
        assert p.evaluate("caches.has('another-local-feature')") is True
        p.goto(book_url)
        expect(p.locator("#book-title")).to_have_text("Offline original")
        expect(picture).to_be_visible()
        assert not unrelated,unrelated
        assert not errors,errors
        b.close()
    print(f"320px Folio {prefix}: online landing and HTTP 503 unchanged; opt-in offline exact root/app.html, local EPUB and viewer; query, neighbor and missing/corrupt package controls passed.")


if __name__=="__main__":
    parser=ArgumentParser(description=__doc__)
    parser.add_argument("dist",type=Path)
    parser.add_argument("--chromium")
    parser.add_argument("--scope",choices=(PREFIX,"/"),default=PREFIX)
    args=parser.parse_args()
    run(args.dist.resolve(),args.chromium,args.scope)
