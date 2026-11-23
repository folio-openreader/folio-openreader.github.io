// Native text stays the default. PDF.js and OCR workers/models are opened on demand.
export const pdfAssetBase = new URL('./vendor/pdfjs/', import.meta.url).href;
const base = pdfAssetBase;
const MiB = 1024 * 1024;
const LIMIT = {bytes: 24 * MiB, pages: 1000, chars: 4 * MiB, items: 800000, paragraphs: 16000, ms: 90000};
class ImportIssue extends Error {}
const issue = message => new ImportIssue(message);
const tooBig = () => issue('В PDF слишком много страниц или текста. Разделите книгу на части и попробуйте снова.');
const protectedBook = () => issue('Этот PDF защищён или зашифрован. Выберите доступную вам незашифрованную версию.');
const unsupported = () => issue('Не удалось запустить обработчик PDF. Откройте Folio в современном браузере или импортируйте TXT.');
const noText = () => Object.assign(issue('В PDF нет читаемого текстового слоя. Включите распознавание (OCR) и повторите предпросмотр.'),{code:'PDF_NO_TEXT'});
const cache = new Map();
function assets(key) {
  if (!cache.has(key)) {
    const fetchLocal = async ext => {
      const response = await fetch(new URL(key + ext, base), {mode:'same-origin', redirect:'error', credentials:'same-origin'});
      if (!response.ok) throw unsupported();
      return response;
    };
    cache.set(key, Promise.all([
      fetchLocal('.index.json').then(r => r.json()),
      fetchLocal('.bin').then(r => r.arrayBuffer())
    ]).catch(e => { cache.delete(key); throw e; }));
  }
  return cache.get(key);
}
// No PDF-originated string becomes a request URL, even for documents with custom CMaps.
class LocalFontData {
  async fetch({kind, filename}) {
    if(kind==='wasmUrl' && ['openjpeg.wasm','jbig2.wasm','qcms_bg.wasm'].includes(filename)) {
      const response=await fetch(new URL('wasm/'+filename,base),{mode:'same-origin',redirect:'error',credentials:'same-origin'});
      if(!response.ok) throw new Error('Missing local image decoder');
      return new Uint8Array(await response.arrayBuffer());
    }
    const key = kind === 'cMapUrl' ? 'cmaps' : kind === 'standardFontDataUrl' ? 'standard_fonts' : null;
    if (!key) throw new Error('Unsupported PDF resource');
    const [index, buffer] = await assets(key);
    if (!Object.hasOwn(index, filename)) throw new Error('Unknown PDF font resource');
    const [start, size] = index[filename];
    return new Uint8Array(buffer, start, size).slice(); // PDF.js can transfer its buffer.
  }
}
// Shared guard for PDF text, OCR and comic raster imports. The caller provides
// bytes, never a URL; embedded fonts and decoders resolve only pinned assets.
export function pdfLocalOptions(maxImageSize, useWasm=false) {
  return {BinaryDataFactory:LocalFontData, cMapPacked:true, useWorkerFetch:false, useWasm,
    ...(useWasm?{wasmUrl:new URL('wasm/',base).href}:{}),
    isEvalSupported:false, enableXfa:false, disableFontFace:true, useSystemFonts:true,
    isOffscreenCanvasSupported:false, isImageDecoderSupported:false, stopAtErrors:true, verbosity:0,
    maxImageSize, canvasMaxAreaInBytes:24*MiB};
}
function clean(str) {
  return String(str || '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/\s+/gu,' ');
}
const readable = s => /[^\s\uFFFD\p{Co}\p{Cf}]/u.test(s);
const needsSpace = (a,b) => !/[\s\-‐‑\u00AD]$/u.test(a) && !/^[\s,.;:!?，。！？、]/u.test(b)
  && !(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(a) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(b));
function pageCollector(totals,layout) {
  let firstAnchor=null;
  let line = null, prev = null, parts = [], paragraphs = [];
  const finishPara = () => {
    if (parts.length) {
      const text = parts.join('').trim();
      if (text && readable(text)) {
        if (++totals.paragraphs > LIMIT.paragraphs) throw tooBig();
        paragraphs.push(text);
        if(layout) layout.anchors.push(firstAnchor);
      }
    }
    parts = []; firstAnchor=null;
  };
  const finishLine = () => {
    if (!line) return;
    const text = line.parts.join('').trim();
    if (text) {
      if (prev) {
        const dx = line.x - prev.x, dy = line.y - prev.y;
        const step = dx*prev.uy - dy*prev.ux, shift = dx*prev.ux + dy*prev.uy;
        const h = Math.max(line.h, prev.h);
        // Gaps/indentation and upward column resets mark paragraphs. Do not reorder runs.
        if (Math.abs(step) > 1.65*h || step < -0.6*h || shift > Math.max(h*.9, 8) ||
            Math.abs(shift) > 6*h || Math.abs(line.h-prev.h) > .24*h ||
            line.ux*prev.ux + line.uy*prev.uy < .95) finishPara();
      }
      if (layout && !parts.length) firstAnchor=[line.x,line.y];
      if (parts.length && needsSpace(parts.at(-1),text)) parts.push(' ');
      parts.push(text);
      prev = line;
    }
    line = null;
  };
  return {
    add(item) {
      if (++totals.items > LIMIT.items) throw tooBig();
      if (typeof item.str !== 'string') return;
      totals.chars += item.str.length + 1; // also bounds separators and highly fragmented documents
      if (totals.chars > LIMIT.chars) throw tooBig();
      const str = clean(item.str);
      if (!str) { if (item.hasEOL) finishLine(); return; }
      const [a,b,c,d,x,y] = item.transform;
      const scale = Math.hypot(a,b) || 1, ux = a/scale, uy = b/scale;
      const h = Math.max(1,Math.abs(item.height || 0),Math.hypot(c,d));
      if (line && Math.abs((x-line.x)*line.uy - (y-line.y)*line.ux) > Math.max(h,line.h)*.55) finishLine();
      if (!line) line = {x,y,h,ux,uy,parts:[],lastEnd:null};
      const pos = x*ux+y*uy;
      if (line.parts.length && item.dir === 'ltr' && line.lastEnd !== null && pos-line.lastEnd > h*.18 &&
          needsSpace(line.parts.at(-1),str)) line.parts.push(' ');
      line.parts.push(str);
      line.lastEnd = pos + (item.width || 0);
      if (item.hasEOL) finishLine();
    },
    finish() { finishLine(); finishPara(); return paragraphs; }
  };
}
const trimMeta = val => typeof val==='string' ? clean(val).trim().slice(0,240) : '';
function nativeDamaged(paragraphs){
  const text=paragraphs.join(' ').replace(/\s/gu,'');
  if(!text.length) return true;
  return /\(cid:\d+\)/i.test(text) || (text.match(/[\uFFFD\p{Co}]/gu)?.length||0)/text.length>=.03;
}
// Paint a mask over *native* text before submitting mixed-page pixels to OCR.
// Native paragraphs remain authoritative, including short titles and page numbers.
function maskRuns(ctx,viewport,layout) {
  ctx.save();ctx.setTransform(...viewport.transform);ctx.fillStyle='#fff';
  for(const {item,asc,desc} of layout.runs){
    const [a,b,c,d,x,y]=item.transform, h=Math.max(1,Math.hypot(c,d)),s=Math.hypot(a,b)||1;
    const w=Math.abs(item.width)||0;if(!w)continue;
    const ux=a/s,uy=b/s,vx=c/h,vy=d/h;
    const lo=h*desc-.8,hi=h*asc+.8, left=-.7,right=w+.7;
    ctx.beginPath();
    [[left,lo],[right,lo],[right,hi],[left,hi]].forEach(([u,v],i)=>ctx[i?'lineTo':'moveTo'](x+u*ux+v*vx,y+u*uy+v*vy));
    ctx.closePath();ctx.fill();
  }
  ctx.restore();
}
const imageOps=o=>new Set(['paintImageXObject','paintImageMaskXObject','paintInlineImageXObject','paintImageXObjectRepeat','paintImageMaskXObjectRepeat','paintInlineImageXObjectGroup','paintImageMaskXObjectGroup'].map(k=>o[k]).filter(Number.isFinite));
// Keep native content-stream order. Insert only new raster paragraphs before
// the next native paragraph below it. OCR already supplies internal block order.
function mix(paragraphs,anchors,ocr,view,keep){
  if(!keep || !paragraphs.length) return ocr.map(x=>x.text);
  if(!ocr.length) return paragraphs;
  const out=Array.from({length:paragraphs.length+1},()=>[]);
  const pos=anchors.map(p=>view.convertToViewportPoint(...p)[1]/view.height);
  for (const entry of ocr) {const i=pos.findIndex(y=>y>entry.y+.008);out[i<0?paragraphs.length:i].push(entry.text);}
  return out.flatMap((entries,i)=>i<paragraphs.length?[...entries,paragraphs[i]]:entries);
}
function status(selected){return {pages:[],uncertain:[],unreadable:[],confidence:[],samples:[],languages:selected};}
const numbers=a=>a.slice(0,12).join(', ')+(a.length>12?'…':'.');
const sample=(page,r)=>({page,text:r.paragraphs.slice(0,3).map(x=>x.text.slice(0,400)).join('\n\n').slice(0,1000)});
function explainOcr(meta,warnings){
  if(meta.pages.length) warnings.push('Локальное OCR распознало текст на страницах: '+numbers(meta.pages));
  if(meta.uncertain.length) warnings.push('Низкая уверенность OCR. Сверьте с оригиналом страницы: '+numbers(meta.uncertain));
  if(meta.unreadable.length) warnings.push('На этих страницах OCR не нашло читаемого текста в изображении: '+numbers(meta.unreadable));
}
const aborted=()=>new DOMException('Импорт отменён.','AbortError');
export function pdfBudget(signal,ms,timeoutMessage){
  let stop, timer, reason;
  const local=new AbortController();
  const stopped=new Promise((_,reject)=>stop=why=>{if(reason)return;reason=why;local.abort();reject(why);});
  const abort=()=>stop(aborted());
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted) abort();
  timer=setTimeout(()=>stop(issue(timeoutMessage)),ms);
  return {signal:local.signal,stopped,stop, get reason(){return reason;}, close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);local.abort();}};
}
export async function parsePdf(buffer, name = '', options={}) {
  if(options.signal?.aborted)throw aborted();
  if (!buffer || !(buffer instanceof ArrayBuffer || buffer instanceof Uint8Array)) throw issue('Не удалось прочитать файл PDF.');
  if (buffer.byteLength > LIMIT.bytes) throw issue('PDF больше 24 МБ. Выберите файл меньшего размера.');
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!new TextDecoder('latin1').decode(bytes.subarray(0,1024)).includes('%PDF-')) throw issue('Файл не похож на PDF. Проверьте его формат.');
  let pdf;
  try { pdf = await import('./vendor/pdfjs/pdf.min.js'); } catch { throw unsupported(); }
  const engine=options.ocr===true?await import('./ocr-engine.js'):null;
  const selected=engine?engine.languages(options.languages):[];
  const run=pdfBudget(options.signal,engine?15*60*1000:LIMIT.ms,'Обработка PDF заняла слишком много времени. Разделите книгу на части.');
  const signal=run.signal;const check=()=>{if(signal.aborted)throw run.reason||aborted();};
  let port, worker, task, ocr, finished=false;
  try {
    const read=async()=>{
      check();
      try {
        port = new Worker(new URL('pdf.worker.min.js',base), {type:'module'});
        worker = new pdf.PDFWorker({port, verbosity:0});
      } catch { throw unsupported(); }
      port.onerror = () => run.stop(unsupported());
      task = pdf.getDocument({data:bytes, worker, ...pdfLocalOptions(engine?engine.SOURCE_PIXELS:0, !!engine)});
      const doc = await task.promise;check();
      if (!doc.numPages || doc.numPages > LIMIT.pages) throw tooBig();
      const {info} = await doc.getMetadata();check();
      if (info?.EncryptFilterName || (await doc.getPermissions()) !== null) throw protectedBook();
      const chapters=[], skipped=[], totals={items:0,chars:0,paragraphs:0}, meta=status(selected);
      const images=engine?imageOps(pdf.OPS):null;
      let language='', attempted=0;
      for (let n=1;n<=doc.numPages;n++) {
        check();options.onProgress?.({stage:'text',page:n,total:doc.numPages,progress:0});
        const page=await doc.getPage(n);let canvas,reader;
        try{
          const layout=engine?{runs:[],anchors:[]}:null, styles=Object.create(null);
          const collector=pageCollector(totals,layout);
          try{
            reader=page.streamTextContent().getReader();
            for(;;) {
              const {done,value}=await reader.read();check();if(done)break;
              if (!language && typeof value.lang==='string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value.lang)) language=value.lang.slice(0,40);
              if(layout) Object.assign(styles,value.styles);
              for(const item of value.items){
                collector.add(item);
                if(layout && typeof item.str==='string' && item.str.trim() && item.transform?.length===6) {
                  if(layout.runs.length>=60000)throw tooBig();
                  const f=styles[item.fontName];
                  layout.runs.push({item,asc:Math.min(1.4,Math.max(.5,Number(f?.ascent)||.9)),desc:Math.min(0,Math.max(-.5,Number(f?.descent)||-.22))});
                }
              }
            }
          }catch(e){check();if(!engine||e instanceof ImportIssue)throw e; if(layout){layout.runs=[];layout.nativeError=true;}}
          finally{reader?.releaseLock();}
          let paragraphs=collector.finish();
          if(engine){
            // Text-only imports never use a damage verdict or OCR coordinates.
            const keep=paragraphs.length>0 && !layout.nativeError && !nativeDamaged(paragraphs);
            let needs=!keep;
            if(!needs){
              // Also handle small raster text inserts (not only full-page scans).
              const ops=await page.getOperatorList({annotationMode:pdf.AnnotationMode.DISABLE});check();
              if(ops.fnArray.length>350000) throw tooBig();
              needs=ops.fnArray.some(op=>images.has(op));
            }
            if(needs){
              const b=page.getViewport({scale:1});
              const view=page.getViewport({scale:engine.viewportScale(b.width,b.height)});
              canvas=engine.canvasAt(view.width,view.height);const ctx=canvas.getContext('2d');
              options.onProgress?.({stage:'render',page:n,total:doc.numPages,progress:0});check();
              const renderer=page.render({canvas,canvasContext:ctx,viewport:view,background:'#ffffff',annotationMode:pdf.AnnotationMode.DISABLE});
              const stop=()=>renderer.cancel();signal.addEventListener('abort',stop,{once:true});
              try{await renderer.promise;}finally{signal.removeEventListener('abort',stop);}
              check();if(keep)maskRuns(ctx,view,layout);
              const regionHint=keep?{}:null;
              if(engine.hasInk(canvas,regionHint)){
                if(++attempted>engine.OCR_PAGES) throw issue('Более 150 страниц требуют OCR. Разделите PDF на несколько частей.');
                ocr??=engine.ocrSession(selected,signal,options.onProgress);
                const r=await ocr.read(canvas,n,doc.numPages,keep && !regionHint.skip);check();
                if(r.paragraphs.length){
                  for(const p of r.paragraphs){
                    totals.chars+=p.text.length; if(totals.chars>LIMIT.chars || ++totals.paragraphs>LIMIT.paragraphs) throw tooBig();
                  }
                  meta.samples.push(sample(n,r));meta.pages.push(n);meta.confidence.push({page:n,value:r.confidence});if(r.confidence==null||r.confidence<70)meta.uncertain.push(n);
                }else meta.unreadable.push(n);
                paragraphs=mix(paragraphs,layout.anchors,r.paragraphs,view,keep);
              } else if(!keep) paragraphs=[];
            }
          }
          if(paragraphs.length) chapters.push({title:'Страница '+n,paragraphs});else skipped.push(n);
        } finally {if(canvas) canvas.width=canvas.height=0;page.cleanup();}
      }
      if (!chapters.length) throw engine?engine.noOCRText():noText();
      const warnings=['Импортирован текст по страницам, без изображений. В колонках и таблицах проверьте порядок чтения.'];
      if(engine) explainOcr(meta,warnings);
      if(skipped.length)warnings.push('Пропущены страницы без читаемого текста ('+skipped.length+'): '+numbers(skipped));
      return {format:'PDF',title:trimMeta(info?.Title)||trimMeta(name.replace(/\.pdf$/i,''))||'Без названия',author:trimMeta(info?.Author),language,chapters,warnings,...(engine?{ocr:meta}:{})};
    };
    const result=await Promise.race([run.stopped,read()]);finished=true;return result;
  } catch(e){
    if(run.reason)throw run.reason;
    if(e instanceof ImportIssue || (engine && e instanceof engine.OCRIssue) || e?.name==='AbortError')throw e;
    if(e?.name==='PasswordException'||/encryption|encrypted|password|security handler/i.test(e?.message||''))throw protectedBook();
    if(/exceeded maximum allowed size/i.test(e?.message||''))throw issue('В PDF есть изображение больше 32 мегапикселей. Уменьшите разрешение скана.');
    throw issue('Не удалось извлечь текст из PDF. Файл повреждён или использует неподдерживаемый формат.');
  } finally {
    run.close();ocr?.close();if(port)port.onerror=null;
    if(finished && task){try{await task.destroy();}catch{}}
    worker?.destroy();port?.terminate();
  }
}
export async function parseImage(buffer,name='',options={}){
  if(options.signal?.aborted) throw aborted();
  if(!(buffer instanceof ArrayBuffer || buffer instanceof Uint8Array)) throw issue('Не удалось прочитать изображение.');
  const engine=await import('./ocr-engine.js');
  if(buffer.byteLength>engine.MAX_IMAGE_BYTES) throw issue('Изображение больше 16 МБ. Выберите файл меньшего размера.');
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer), {format}=engine.imageDimensions(bytes);
  const selected=engine.languages(options.languages); const run=pdfBudget(options.signal,120000,'OCR изображения заняло слишком много времени. Уменьшите изображение.');
  let bitmap,canvas,ocr;
  const read=async()=>{
    engine.check(run.signal);options.onProgress?.({stage:'render',page:1,total:1,progress:0});
    if(typeof createImageBitmap!=='function')throw issue('Для импорта изображений нужен современный браузер.');
    const b=await createImageBitmap(new Blob([bytes],{type:format==='PNG'?'image/png':'image/jpeg'}));
    if(run.signal.aborted){b.close();throw aborted();}bitmap=b;
    const s=engine.viewportScale(b.width,b.height,1);
    canvas=engine.canvasAt(b.width*s,b.height*s);const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(b,0,0,canvas.width,canvas.height);b.close();bitmap=null;
    if(!engine.hasInk(canvas))throw engine.noOCRText();
    ocr=engine.ocrSession(selected,run.signal,options.onProgress);
    const r=await ocr.read(canvas,1,1);engine.check(run.signal);
    if(!r.paragraphs.length)throw engine.noOCRText();
    const paragraphs=r.paragraphs.map(p=>p.text),meta=status(selected);
    meta.samples=[sample(1,r)];meta.pages=[1];meta.confidence=[{page:1,value:r.confidence}];if(r.confidence==null||r.confidence<70)meta.uncertain=[1];
    if(paragraphs.length>LIMIT.paragraphs || paragraphs.reduce((k,p)=>k+p.length,0)>LIMIT.chars) throw tooBig();
    const warnings=[];explainOcr(meta,warnings);
    return {format,title:trimMeta(name.replace(/\.(png|jpe?g)$/i,''))||'Изображение',author:'',language:'',chapters:[{title:'Страница 1',paragraphs}],warnings,ocr:meta};
  };
  try{return await Promise.race([run.stopped,read()]);}
  catch(e){if(run.reason)throw run.reason;if(e instanceof ImportIssue || e instanceof engine.OCRIssue || e?.name==='AbortError')throw e;throw issue('Не удалось декодировать изображение. Проверьте формат PNG или JPEG.');}
  finally{run.close();ocr?.close();bitmap?.close();if(canvas)canvas.width=canvas.height=0;}
}
