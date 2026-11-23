import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker, MessageChannel, isMainThread, parentPort} from 'node:worker_threads';
import {readFile} from 'node:fs/promises';

const vendor=new URL('../dist/vendor/pdfjs/',import.meta.url);
if(!isMainThread){
  const {WorkerMessageHandler}=await import(new URL('pdf.worker.min.js',vendor));
  parentPort.once('message',port=>WorkerMessageHandler.initializeFromPort(port));
}else{
  const left=[
    'The copper lantern burns beside the river',
    'as the mist settles over the narrow bridge',
    'where Mira waits until the old ferryman',
    'arrives to take her to the Village of Alder.',
  ];
  const right=[
    'The quiet orchard opens early in the spring',
    'when the workers gather near the wooden',
    'gate to count the old baskets and prepare',
    'the first shipment of apples for the market.',
  ];
  const title='Country Letters',foot='Field report, issue 7';
  const columns=[title,left.join(' '),right.join(' '),foot];
  // Minimal synthetic PDF, built offline from ASCII (no binary fixture,
  // ReportLab, fonts, external files or browser dependencies).
  function fixture({mode='rows',l=left,r=right,third=false,plain=false}={}){
    const parts=[],draw=(x,y,s,h)=>parts.push(`BT /F1 ${h} Tf 1 0 0 1 ${x} ${y} Tm (${s}) Tj ET`);
    draw(55,742,title,17);
    const lr=i=>draw(55,698-14*i,l[i],11), rr=i=>draw(330,698-14*i,r[i],11);
    if(mode==='columns'){
      l.forEach((_,i)=>lr(i));if(!plain)r.forEach((_,i)=>rr(i));
    }else l.forEach((_,i)=>{lr(i);if(!plain)rr(i);if(third)draw(568,698-14*i,String(2021+i),11)});
    draw(55,60,foot,9);
    const content=parts.join('\n')+'\n';
    const objs=['<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${content.length} >>\nstream\n${content}endstream`];
    let pdf='%PDF-1.4\n';const offsets=[];
    objs.forEach((obj,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`});
    const xref=pdf.length;
    pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
    pdf+=`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(pdf);
  }
  test('native PDF reads clearly paired prose in column order without reordering tables',async t=>{
    // PDF.js declares the DOMMatrix type on import; these text-only tests do
    // not render. Passing OCR=true with no image still never requests canvas
    // or starts the OCR worker.
    const saved={DOMMatrix:globalThis.DOMMatrix,Worker:globalThis.Worker,fetch:globalThis.fetch};
    t.after(()=>{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v}});
    globalThis.DOMMatrix=class {};
    let workers=0,terminated=0;
    globalThis.Worker=class {
      constructor(url){
        assert.equal(url.href,new URL('pdf.worker.min.js',vendor).href);
        const {port1,port2}=new MessageChannel();
        this.thread=new NodeWorker(new URL(import.meta.url));this.thread.postMessage(port1,[port1]);
        this.thread.on('error',()=>this.onerror?.());
        this.port=port2;
        for(const key of ['postMessage','addEventListener','removeEventListener'])this[key]=port2[key].bind(port2);
        workers++;
      }
      terminate(){terminated++;this.port.close();void this.thread.terminate()}
    };
    globalThis.fetch=async (url,opts)=>{
      assert.ok(url.href.startsWith(vendor.href)&&/\/standard_fonts\.(bin|index\.json)$/.test(url.href));
      assert.equal(opts.mode,'same-origin');assert.equal(opts.redirect,'error');
      return new Response(await readFile(url));
    };
    const {parsePdf}=await import('../dist/pdf-import.js');
    const run=async (layout,opts)=>(await parsePdf(fixture(layout),'Reading order.pdf',opts)).chapters[0].paragraphs;
    assert.deepEqual(await run({},{}),columns);
    assert.deepEqual(await run({},{ocr:true}),columns);
    assert.deepEqual(await run({mode:'columns'},{}),columns);
    assert.deepEqual(await run({plain:true},{}),[title,left.join(' '),foot]);
    const l=['The Lake weather office reports clear skies.','The Forest weather office reports snowfall.',
      'The Alpine weather office reports high winds.','The Harbor weather office reports heavy rain.'];
    const r=['The total exceeded the yearly maximum.','A temporary link lost power at noon.',
      'Overnight change was less than predicted.','Area stations recorded the same change.'];
    assert.deepEqual(await run({l,r},{}),[title,l.flatMap((s,i)=>[s,r[i]]).join(' '),foot]);
    assert.deepEqual(await run({third:true},{}),[title,left.flatMap((s,i)=>[s,right[i],String(2021+i)]).join(' '),foot]);
    assert.equal(terminated,workers);
  });
}
