import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFile} from 'node:fs/promises';
import {Worker,MessageChannel,isMainThread,parentPort} from 'node:worker_threads';

const vendor=new URL('../dist/vendor/pdfjs/',import.meta.url);
if(!isMainThread){
  const {WorkerMessageHandler}=await import(new URL('pdf.worker.min.js',vendor));
  parentPort.once('message',port=>WorkerMessageHandler.initializeFromPort(port));
}else{
  // ASCII-only PDF with two optional pages. The raster XObject makes PDF.js
  // consider OCR, but the module error must occur before any canvas or OCR job.
  function fixture(types){
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    const raster='G'.repeat(16);
    objects.push('<< /Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceGray /BitsPerComponent 8 /Length '+raster.length+' >>\nstream\n'+raster+'\nendstream');
    const pages=[];
    for(const type of types){
      const rasterized=type==='mixed'||type==='scan';
      const filledDrawings='q 1 0 0 1 @ 250 cm 0 0 m 18 4 12 16 20 30 c 25 40 5 42 2 29 c 11 20 3 5 0 0 c h f Q\n';
      const vector=type==='vector-outline'?Array.from({length:7},(_,i)=>filledDrawings.replace('@',String(45+65*i))).join(''):
        type==='vector-border'?'72 430 350 60 re S\n':'';
      const content=(type==='scan'?'':'BT /F1 12 Tf 72 700 Td (The native text is still readable.) Tj ET\n')+
        (rasterized?'q 120 0 0 120 80 200 cm /Picture Do Q\n':'')+vector;
      pages.push(objects.length+1);
      objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> /XObject << /Picture 4 0 R >> >> /Contents '+(objects.length+2)+' 0 R >>',
        '<< /Length '+content.length+' >>\nstream\n'+content+'endstream');
    }
    objects[1]='<< /Type /Pages /Kids ['+pages.map(i=>i+' 0 R').join(' ')+'] /Count '+pages.length+' >>';
    let pdf='%PDF-1.4\n';const offsets=[];
    objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\n'+o+'\nendobj\n';});
    const xref=pdf.length;
    pdf+='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
    pdf+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
    return new TextEncoder().encode(pdf);
  }

  test('automatic OCR leaves cached native text readable if the OCR JavaScript cannot load',async t=>{
    const target=new URL('../dist/ocr-engine.js',import.meta.url).href;
    const chromium=()=>new TypeError('Failed to fetch dynamically imported module: '+target);
    let requests=0,token=0,fault=chromium,open=0;
    const hooked=registerHooks({
      resolve(specifier,context,next){
        const value=next(specifier,context);
        return value.url===target?{...value,url:target+'?ocr-qa='+token}:value;
      },
      load(url,context,next){
        if(url.startsWith(target+'?ocr-qa=')){requests++;throw fault();}
        return next(url,context);
      }
    });
    const saved={DOMMatrix:globalThis.DOMMatrix,Worker:globalThis.Worker,fetch:globalThis.fetch};
    t.after(()=>{hooked.deregister();for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v}});
    globalThis.DOMMatrix=class {};
    globalThis.Worker=class {
      constructor(url){
        assert.equal(url.href,new URL('pdf.worker.min.js',vendor).href,'Only the native PDF worker may start');
        const {port1,port2}=new MessageChannel();this.thread=new Worker(new URL(import.meta.url));this.thread.postMessage(port1,[port1]);
        this.thread.on('error',()=>this.onerror?.());
        this.port=port2;for(const k of ['postMessage','addEventListener','removeEventListener'])this[k]=port2[k].bind(port2);
        open++;
      }
      terminate(){open--;this.port.close();void this.thread.terminate()}
    };
    globalThis.fetch=async(url,opts)=>{
      assert.ok(url.href.startsWith(vendor.href)&&/\/standard_fonts\.(bin|index\.json)$/.test(url.href));
      assert.equal(opts.mode,'same-origin');assert.equal(opts.redirect,'error');
      return new Response(await readFile(url));
    };
    const {parsePdf}=await import('../dist/pdf-import.js');
    const run=(types,opts={})=>{token++;return parsePdf(fixture(types),'Local test.pdf',{ocr:'auto',...opts})};
    const yes=(chapters,n)=>assert.deepEqual(chapters[n].paragraphs,['The native text is still readable.']);
    const b=await run(['native']);yes(b.chapters,0);assert.equal(requests,0);
    for(const loadFailure of [chromium,()=>new TypeError('error loading dynamically imported module: '+target),()=>new TypeError('Importing a module script failed.')]){
      fault=loadFailure;const prev=requests;
      const c=await run(['scan','mixed','native']);yes(c.chapters,0);yes(c.chapters,1);
      assert.match(c.warnings.join(' '),/Доступный текст сохранён.*перезагрузите Folio/);
      assert.equal(requests,prev+1,'one failed load per import, not once per raster page');
    }
    fault=chromium;
    const beforeVectors=requests;
    yes((await run(['vector-outline'])).chapters,0);
    yes((await run(['vector-border'],{ocr:'thorough'})).chapters,0);
    assert.equal(requests,beforeVectors,'auto leaves vector shapes alone; simple strokes do not start manual OCR');
    const optional=await run(['vector-outline','vector-outline'],{ocr:'thorough'});
    yes(optional.chapters,0);yes(optional.chapters,1);
    assert.match(optional.warnings.join(' '),/контуров временно недоступно.*1, 2/);
    assert.equal(requests,beforeVectors+1,'one failed load per optional module, not per outlined page');
    const beforeRequired=requests;
    await assert.rejects(run(['vector-outline','scan'],{ocr:'thorough'}),e=>e.code!=='OCR_MODEL_UNAVAILABLE');
    assert.equal(requests,beforeRequired+2,'optional failure does not bypass the later required scan path');
    await assert.rejects(run(['scan']),{code:'OCR_MODEL_UNAVAILABLE',message:/перезагрузите Folio/});
    await assert.rejects(run(['mixed'],{ocr:'thorough'}),e=>e.code!== 'OCR_MODEL_UNAVAILABLE');
    fault=()=>new TypeError('engine config is not a function');
    await assert.rejects(run(['mixed']),e=>e.code!== 'OCR_MODEL_UNAVAILABLE');
    await assert.rejects(run(['vector-outline'],{ocr:'thorough'}));
    fault=()=>new DOMException('cancelled','AbortError');
    await assert.rejects(run(['vector-outline'],{ocr:'thorough'}),{name:'AbortError'});
    fault=()=>new SyntaxError('missing export');
    await assert.rejects(run(['mixed']),e=>e.code!== 'OCR_MODEL_UNAVAILABLE');
    fault=()=>new DOMException('cancelled','AbortError');
    await assert.rejects(run(['mixed']),{name:'AbortError'});
    const ac=new AbortController();
    fault=()=>{ac.abort();return chromium()};
    await assert.rejects(run(['mixed'],{signal:ac.signal}),{name:'AbortError'});
    assert.equal(open,0);
  });
}
