"""Usage: python tests/sync-browser.py dist [--artifacts /tmp/folio-sync-qa]
Synthetic, disposable Chromium contexts only. No persistent browser profile, token or remote host.
Optional --chromium selects an installed Chromium. pip package: playwright.
"""
from argparse import ArgumentParser
from contextlib import contextmanager
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.parse import urlsplit
import json, shutil
from playwright.sync_api import sync_playwright, expect

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

@contextmanager
def serving(folder):
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(folder)))
    t=Thread(target=server.serve_forever,daemon=True);t.start()
    try: yield 'http://127.0.0.1:'+str(server.server_port)
    finally: server.shutdown();server.server_close();t.join()

def run(root,artifacts=None,chromium=None):
    with serving(root) as origin, TemporaryDirectory() as tmp, sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=chromium or shutil.which('chromium'),headless=True)
        A=browser.new_context(accept_downloads=True,viewport={'width':1100,'height':780})
        B=browser.new_context(accept_downloads=True,viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        requests=[];external=[];errors=[]
        for label,ctx in [('A',A),('B',B)]:
            def fence(route,label=label):
                url=route.request.url
                if url.startswith(('blob:', 'data:')) or url.startswith(origin+'/'):
                    requests.append((label,url));return route.continue_()
                external.append((label,url));return route.abort()
            ctx.route('**/*',fence)
        # Only the synthetic sender is seeded. Receiver B has genuinely empty browser storage.
        A.add_init_script("""Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
          writeText:async(s)=>{window.__folioSyntheticClipboard=s}
        }});if(location.protocol==='http:'&&!sessionStorage.qaSeed){
          sessionStorage.qaSeed='yes';
          localStorage.setItem('folio-learning-v1',JSON.stringify({version:1,rows:[['river','en',100,0,0,0,0,100,{'fictionbook/0/0':[1]}]]}));
          localStorage.setItem('qa-local-sentinel','never-transfer');
        }""")
        a=A.new_page();b=B.new_page()
        for p in [a,b]:p.on('pageerror',lambda e:errors.append(str(e)))
        def status(p):return p.locator('[data-sync=status]')
        def loc(p,k):return p.locator('[data-sync="'+k+'"]')
        def first(p,h):
            p.goto(origin+'/app.html'+h,wait_until='domcontentloaded');p.locator('#folio-boot').wait_for(state='detached')
        def enter(p):
            p.locator('[data-view=profile]').click();p.locator('[data-profile-open=sync]').click();loc(p,'generate').wait_for()
        def inputfile(p,c,file):
            loc(p,'code').fill(c);loc(p,'file').set_input_files(str(file));loc(p,'import').click()
        def snap(p,name):
            if artifacts: p.screenshot(path=str(artifacts/name),full_page=True)
        def key(p,k):return p.evaluate('(k)=>localStorage.getItem(k)',k)
        first(a,'#home');assert not any('/sync-' in url for _,url in requests)
        a.evaluate("location.hash='read/demo'");expect(a.locator('#reader')).to_be_visible()
        a.locator('#reader-back').click();enter(a)
        expect(loc(a,'choices')).to_be_hidden()
        loc(a,'generate').click();expect(loc(a,'copy')).to_be_visible()
        loc(a,'copy').click()
        code=a.evaluate("()=>{const c=window.__folioSyntheticClipboard;delete window.__folioSyntheticClipboard;return c}")
        assert isinstance(code,str) and code.startswith('folio1.')
        loc(a,'saved').check();loc(a,'export').click()
        expect(loc(a,'download')).to_be_visible();assert key(a,'folio-word-store-v2') is None
        with a.expect_download() as dl:loc(a,'download').click()
        file=Path(tmp)/'synthetic.folio-sync';dl.value.save_as(str(file))
        assert key(a,'folio-word-store-v2') is None and key(a,'qa-local-sentinel')=='never-transfer'
        assert 'river' not in file.read_text() and 'fictionbook' not in file.read_text()
        assert loc(a,'code').input_value()=='';snap(a,'sender.png')
        assert b.url=='about:blank';first(b,'#profile/sync');loc(b,'generate').wait_for()
        inputfile(b,code,file);expect(loc(b,'review')).to_be_visible();assert key(b,'folio-word-store-v2') is None
        snap(b,'receiver-preview.png');loc(b,'discard').click()
        assert key(b,'folio-word-store-v2') is None
        # Back/forward or leaving the page must dispose of the key and preview.
        inputfile(b,code,file);expect(loc(b,'review')).to_be_visible()
        b.locator('[data-stack-page=sync] [data-profile-up]').click();expect(b.locator('[data-profile-open=sync]')).to_be_visible()
        b.locator('[data-profile-open=sync]').click();assert loc(b,'code').input_value()==''
        inputfile(b,code,file);expect(loc(b,'review')).to_be_visible();loc(b,'apply').click()
        expect(status(b)).to_contain_text('Перенос завершён')
        row=json.loads(key(b,'folio-word-store-v2'))
        card=next(x for x in row['words']['rows'] if x[0]=='river');assert card[8]=={} and key(b,'qa-local-sentinel') is None
        assert code not in json.dumps(row) and key(a,'folio-word-store-v2') is None
        assert loc(b,'code').input_value()=='';snap(b,'receiver-confirmation.png')
        b.locator('[data-view=words]').click();expect(b.locator('[data-study-word="en:river"]')).to_be_visible()
        # Same storage origin, distinct tab: cannot obtain the active writer lease.
        other=B.new_page();first(other,'#profile/sync');loc(other,'generate').wait_for()
        expect(other.locator('#sync-word-notice')).to_contain_text('другой вкладке')
        before=key(other,'folio-word-store-v2');loc(other,'code').fill(code);loc(other,'export').click()
        expect(status(other)).to_contain_text('другой вкладке');assert key(other,'folio-word-store-v2')==before
        # Perform an actual ordinary mutation attempt, not only a banner check.
        other.evaluate("location.hash='read/demo'");expect(other.locator('#reader')).to_be_visible()
        other.locator('#passage button.word').first.click()
        expect(other.locator('#word-dialog')).to_be_visible()
        expect(other.locator('#word-save')).to_have_attribute('aria-pressed','false')
        other.locator('#word-save').click();expect(other.locator('#word-save-status')).to_contain_text('Словарь не изменён')
        expect(other.locator('#word-save')).to_have_attribute('aria-pressed','false')
        assert key(other,'folio-word-store-v2')==before
        other.close()
        b.reload();expect(b.locator('[data-study-word="en:river"]')).to_be_visible()
        # Boot of an enrolled reader may load just its word-store codec, never the sync UI or GitHub.
        assert not any('/sync-github.js' in url for _,url in requests)
        assert not external,external
        assert not errors,errors
        print('Chromium: independent contexts, fresh receiver, offline-provider flow, no sender migration, cancel/navigation, persisted recipient, occupied second tab and no external requests: PASS.')
        browser.close()
if __name__=='__main__':
    ap=ArgumentParser();ap.add_argument('dist',type=Path);ap.add_argument('--artifacts',type=Path);ap.add_argument('--chromium')
    args=ap.parse_args()
    if args.artifacts: args.artifacts.mkdir(parents=True,exist_ok=True)
    run(args.dist,args.artifacts,args.chromium)
