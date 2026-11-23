"""Optional real-browser check; python -m pip install playwright Pillow reportlab.
Set CHROMIUM to a Chromium executable, or use Playwright's bundled Chromium.
python tests/ocr-browser.py [--dist dist] [--overlay patched/dist] [--repeat 2]
Uses only fresh, generated pages and the checked-in engines on loopback."""
import argparse, io, json, os, shutil, threading, zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
from PIL import Image, ImageDraw, ImageFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.utils import ImageReader
from playwright.sync_api import sync_playwright

def fixtures():
    font = ImageFont.truetype(os.environ.get('FOLIO_QA_FONT', 'DejaVuSans.ttf'), 56)
    def page(w, h, labels):
        im = Image.new('RGB', (w, h), 'white')
        draw = ImageDraw.Draw(im)
        for y, text, ink in labels:
            draw.text((64, y), text, fill=(ink,)*3, font=font)
        return im
    def png(im):
        f = io.BytesIO()
        im.save(f, format='PNG')
        return f.getvalue()
    def pdf(images):
        f = io.BytesIO()
        c = Canvas(f, pagesize=(500,350), invariant=1)
        for im in images:
            c.drawImage(ImageReader(im), 0, 0, width=500, height=350)
            c.showPage()
        c.save()
        return f.getvalue()
    plain = page(1000,700,[])
    pale = page(1000,700,[(280,'Follow the river.',205)])
    dark = page(1000,700,[(280,'Open the gate.',24)])
    tall = page(700,7200,[(200,'First balloon.',24),(6950,'Last balloon.',24)])
    busy = page(700,7200,[(y,'Reader page '+str(i)+'.',24) for i,y in enumerate(range(220,7100,720))])
    clear = Image.new('RGBA',(1000,700),(17,122,91,0))  # invisible RGB must not trigger OCR
    ghost = clear.copy()
    ImageDraw.Draw(ghost).text((64,280),'Follow the river.',font=font,fill=(0,0,0,50))
    maximum = Image.new('RGBA',(6400,5000),(13,27,41,0))  # 32 MP permitted source
    z = io.BytesIO()
    with zipfile.ZipFile(z, 'w', zipfile.ZIP_DEFLATED) as cbz:
        cbz.writestr('01.png',png(tall)); cbz.writestr('02.png',png(plain))
    return {'blank.png':png(plain), 'pale.png':png(pale), 'busy.png':png(busy),
            'clear.png':png(clear),'ghost.png':png(ghost),'maximum.png':png(maximum),
            'strips.cbz':z.getvalue(), 'pale.pdf':pdf([pale]), 'normal.pdf':pdf([dark,plain,dark])}

RUN = r"""async ({name,route})=>{
 const {parsePdf,parseImage}=await import('/pdf-import.js');
 const {parseComicFiles}=await import('/comic-import.js');
 const {recognizeComicPage}=await import('/comic-ocr.js');
 const buffer=await (await fetch('/fixtures/'+name)).arrayBuffer();
 const opts={ocr:true,languages:['eng']},f=new File([buffer],name);
 const stats={workers:0,closed:0,jobs:0,recognizeMs:[],loadMs:[],largestRead:0,largestCanvas:0,text:[],marks:[]};
 const readback=CanvasRenderingContext2D.prototype.getImageData;
 CanvasRenderingContext2D.prototype.getImageData=function(x,y,w,h,...args){
   stats.largestRead=Math.max(stats.largestRead,w*h*4);
   stats.largestCanvas=Math.max(stats.largestCanvas,this.canvas.width*this.canvas.height);
   return readback.call(this,x,y,w,h,...args);
 };
 const Native=Worker;
 window.Worker=class extends Native{
   constructor(url,...opts){
     super(url,...opts);
     this.ocr=String(url).endsWith('/ocr-v1/worker.min.js');
     this.stamps=new Map();if(this.ocr)stats.workers++;
     this.addEventListener('message',e=>{
       const m=e.data,stamp=this.stamps.get(m.jobId);
       if(stamp&&m.status==='resolve'){
         if(m.action==='recognize'||stamp[0]==='recognize')stats.recognizeMs.push(Math.round(performance.now()-stamp[1]));
         else if(stamp[0]==='initialize')stats.loadMs.push(Math.round(performance.now()-this.started));
       }
     });
   }
   postMessage(m,...args){
     if(this.ocr){
       this.stamps.set(m.jobId,[m.action,performance.now()]);
       if(m.action==='load')this.started=performance.now();
       if(m.action==='recognize')stats.jobs++;
     }
     return super.postMessage(m,...args);
   }
   terminate(){if(this.ocr)stats.closed++;return super.terminate()}
 };
 const start=performance.now();
 try{
   if(route==='comic'||route==='comic-blank'||route==='comic-pdf'){
     const book=await parseComicFiles([f]),p=book.pages[route==='comic-blank'?1:0];
     const s=await recognizeComicPage(p.blob);
     stats.text=s.paragraphs.map(p=>p.text);
     stats.marks=s.words.map(w=>[w.text,w.x,w.y,w.w,w.h,w.offset,w.paragraphIndex]);
     for(const w of s.words)if(stats.text[w.paragraphIndex].slice(w.offset,w.offset+w.text.length)!==w.text)throw Error('bad hotspot');
   }else if(route==='cancel'){
     const ac=new AbortController();const promise=recognizeComicPage(f,{signal:ac.signal,
       onProgress:p=>{if(p.stage==='render')setTimeout(()=>ac.abort(),0)}});
     try{await promise;throw Error('unexpected success')}catch(e){if(e.name!=='AbortError')throw e;stats.cancel=true;}
   }else{
     const s=await (route==='pdf'?parsePdf:parseImage)(buffer,name,opts);
     stats.text=s.chapters.map(c=>c.paragraphs.join(' '));
   }
 }catch(e){stats.error=e.message}
 finally{window.Worker=Native;CanvasRenderingContext2D.prototype.getImageData=readback;stats.ms=Math.round(performance.now()-start)}
 return stats;
}"""

def run(args):
    payloads=fixtures()
    active=[args.dist]
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path=unquote(urlsplit(self.path).path).strip('/')
            if path=='': body=b'<!doctype html><title>Local OCR QA</title>';mime='text/html'
            elif path.startswith('fixtures/') and path[9:] in payloads:
                body=payloads[path[9:]];mime='application/octet-stream'
            elif path and '..' not in Path(path).parts:
                p=next((root/path for root in active if (root/path).is_file()),None)
                if not p: self.send_error(404);return
                body=p.read_bytes()
                mime=('application/javascript' if p.suffix=='.js' else 'application/wasm' if p.suffix=='.wasm' else 'application/octet-stream')
            else: self.send_error(404);return
            self.send_response(200);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*a): pass
    srv=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=srv.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{srv.server_port}'
    rows=[]
    with sync_playwright() as pw:
        exe=os.environ.get('CHROMIUM') or shutil.which('chromium')
        browser=pw.chromium.launch(executable_path=exe,headless=True)
        try:
            for rep in range(args.repeat):
                variants=['base','candidate'] if args.overlay else ['candidate']
                for variant in (variants[::-1] if rep%2 else variants):
                    active[:]=([args.overlay,args.dist] if variant=='candidate' and args.overlay else [args.dist])
                    context=browser.new_context()
                    external=[]
                    def gate(route):
                        if not route.request.url.startswith(origin+'/'):
                            external.append(route.request.url);route.abort()
                        else: route.continue_()
                    context.route('**/*',gate)
                    page=context.new_page()
                    page.goto(origin)
                    cases=[('strips.cbz','comic-blank'),('strips.cbz','comic'),('busy.png','comic'),('pale.pdf','pdf'),('pale.png','image'),('normal.pdf','pdf'),('normal.pdf','comic-pdf'),('blank.png','cancel'),('clear.png','comic'),('ghost.png','image'),('maximum.png','empty-image')]
                    for name,route in cases:
                        data=page.evaluate(RUN,{'name':name,'route':route})
                        print(json.dumps({'rep':rep,'variant':variant,'name':name,'route':route,**data},ensure_ascii=False),flush=True)
                        assert data['workers']==data['closed'],data
                        if route=='empty-image':
                            assert 'не нашло читаемого текста' in data.get('error','') and data['workers']==0,data
                            assert data['largestRead']<=256*1024,data
                            if variant=='candidate':assert 4_900_000<=data['largestCanvas']<=5_000_000,data
                        elif variant=='candidate' or name not in ('pale.png','pale.pdf','ghost.png'):
                            assert 'error' not in data,data
                            if route=='comic-blank':assert data['text']==[] and (variant=='base' or data['workers']==0),data
                            elif name=='strips.cbz':assert data['text']==['First balloon.','Last balloon.'],data
                            elif name=='clear.png':assert data['text']==[] and (variant=='base' or data['workers']==0),data
                            elif name in ('pale.png','pale.pdf','ghost.png'):assert 'Follow the river.' in ' '.join(data['text']),data
                            elif name=='normal.pdf':assert 'Open the gate.' in data['text'][0],data
                            elif route=='cancel':assert data.get('cancel'),data
                            elif name=='busy.png':assert 'Reader page 0.' in ' '.join(data['text']),data
                        rows.append((rep,variant,name,route,data))
                    assert not external,external
                    context.close()
        finally:browser.close();srv.shutdown();srv.server_close()
    for rep,v,n,r,data in rows:
        if v!='candidate':continue
        old=next((res for i,var,name,route,res in rows if i==rep and var=='base' and name==n and route==r),None)
        if old and n not in ('pale.png','pale.pdf','ghost.png'):
            assert data['marks']==old['marks'] and data['text']==old['text'],(n,r)
            if n=='strips.cbz':assert data['jobs']<old['jobs']
if __name__=='__main__':
    a=argparse.ArgumentParser()
    a.add_argument('--dist',type=Path,default=Path(__file__).resolve().parents[1]/'dist')
    a.add_argument('--overlay',type=Path)
    a.add_argument('--repeat',type=int,default=1)
    run(a.parse_args())
