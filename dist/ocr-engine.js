// Local OCR only. The fixed version of Tesseract's classic browser worker speaks
// this small job protocol. Owning the port lets us cancel during WASM/model load,
// not just after createWorker() returns. No user value becomes a request path.
const root = new URL('./vendor/ocr-v1/', import.meta.url);
export const SOURCE_PIXELS = 32_000_000;
export const OCR_PAGES = 150;
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const PIXELS = 5_000_000, LONG_SIDE = 3000;
export class OCRIssue extends Error {}
const error = s => new OCRIssue(s);
const ocrFailed = () => Object.assign(error('Не удалось обработать страницу локальным OCR. Попробуйте ещё раз или выберите файл с текстовым слоем.'),{code:'OCR_WORKER_FAILURE'});
const modelUnavailable = () => Object.assign(error('Не удалось запустить локальное OCR. Обновите страницу или выберите файл с текстовым слоем.'),{code:'OCR_MODEL_UNAVAILABLE'});
export const noOCRText = () => Object.assign(error('OCR не нашло читаемого текста. Проверьте язык, чёткость и ориентацию изображения.'),{code:'OCR_NO_TEXT'});
export function languages(input) {
  const values = input === undefined ? ['eng'] : input;
  if (!Array.isArray(values) || !values.length || values.length > 3 || values.some(x => !['eng','rus','kaz'].includes(x))) throw error('Выберите язык OCR: английский, русский или казахский.');
  return [...new Set(values)];
}
export function abortError(){ return new DOMException('Импорт отменён.','AbortError'); }
export function check(signal){if(signal?.aborted) throw abortError();}
// Native image decoding has no abort API. Release the caller immediately and
// still consume late errors/results so an abandoned ImageBitmap does not leak.
function waitForDecode(start,signal,closeLate){
  const decode=Promise.resolve().then(()=>{check(signal);return start()});
  if(!signal)return decode;
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(abortError());
    signal.addEventListener('abort',abort,{once:true});
    decode.then(value=>{
      signal.removeEventListener('abort',abort);
      if(signal.aborted){closeLate?.(value);return;}
      resolve(value);
    },error=>{
      signal.removeEventListener('abort',abort);reject(error);
    });
  });
}

export async function decodePageImage(blob,signal,unsupported){
  check(signal);
  if(typeof createImageBitmap==='function'){
    const image=await waitForDecode(()=>createImageBitmap(blob,{imageOrientation:'from-image'}),signal,image=>image.close());
    return {image,width:image.width,height:image.height,close:()=>image.close()};
  }
  // For engines without ImageBitmap, decode only our just-validated raster Blob.
  if(typeof Image!=='function')throw error(unsupported);
  const image=new Image(),url=URL.createObjectURL(blob);
  const close=()=>{image.removeAttribute('src');URL.revokeObjectURL(url)};
  try{
    await waitForDecode(()=>{image.src=url;return image.decode()},signal);
    return {image,width:image.naturalWidth,height:image.naturalHeight,close};
  } catch(error){close();throw error;}
}

export function viewportScale(w,h,scale=3){
  if (!Number.isFinite(w*h) || w<=0 || h<=0) throw error('Недопустимый размер страницы.');
  return Math.min(scale,LONG_SIDE/Math.max(w,h),Math.sqrt(PIXELS/(w*h)));
}
export function canvasAt(width,height) {
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.floor(width)); canvas.height=Math.max(1,Math.floor(height));
  if (!canvas.getContext('2d')) throw Object.assign(error('Браузер не поддерживает обработку изображения.'),{code:'OCR_CANVAS_UNAVAILABLE'});
  return canvas;
}
// Thumbnail check from the syllabus parser; bound *both* axes for unusual page shapes.
export function hasInk(canvas, regionHint=null) {
  const s=Math.min(1,240/Math.max(canvas.width,canvas.height));
  const thumb=canvasAt(canvas.width*s,canvas.height*s);
  try{
    const c=thumb.getContext('2d'); c.drawImage(canvas,0,0,thumb.width,thumb.height);
    const d=c.getImageData(0,0,thumb.width,thumb.height).data;
    let dark=0, x0=thumb.width, x1=-1, y0=-1;
    for (let i=0;i<d.length;i+=4) {
      if (Math.min(d[i],d[i+1],d[i+2])>=190 || d[i+3]<=32) continue;
      dark++;
      if(!regionHint){if(dark>=3)return true;continue;}
      const x=(i/4)%thumb.width, y=Math.floor(i/4/thumb.width);
      if(y0<0)y0=y;if(x<x0)x0=x;if(x>x1)x1=x;
      // Negative preflight only: a broad region takes the original path without
      // expensive full-resolution readbacks. Never derive crop edges here.
      if(dark>=3 && (x1-x0+1)*(y-y0+1)>thumb.width*thumb.height*.55){
        regionHint.skip=true;return true;
      }
    }
    return dark>=3;
  } finally {thumb.width=thumb.height=0;}
}
// A light, small caption may vanish in the 240px preview. For a full scan
// or comic tile, skip recognition only when all rendered pixels are equal.
// Checking bands bounds each readback; most nonblank pages take the thumbnail
// fast path. Canvases here already have their background composited to white.
export async function hasPageMarks(canvas,signal){
  check(signal);
  try{
    if(hasInk(canvas))return true;
    const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;
    // At most ~256 KiB per buffer at our supported OCR resolutions.
    const rows=Math.max(1,Math.floor(65536/w));
    let first,checkpoint=performance.now();
    for(let y=0;y<h;y+=rows){
      check(signal);
      const {data}=ctx.getImageData(0,y,w,Math.min(rows,h-y));
      const pixels=new Uint32Array(data.buffer,data.byteOffset,data.byteLength/4);
      if(y===0)first=pixels[0];
      for(const pixel of pixels)if(pixel!==first)return true;
      if(performance.now()-checkpoint>12 && y+rows<h){
        await new Promise(done=>setTimeout(done,0));check(signal);checkpoint=performance.now();
      }
    }
    return false;
  }catch(e){check(signal);return true;} // optional preflight; let OCR decide
}
// On a mixed page, native glyphs are already masked. Crop the *actual*
// remaining ink, not a heuristic "text area": a faint, colored or isolated
// pixel is kept unless it is exactly opaque white. Never discard marks or
// infer whether they depict text. Read in bands to bound the transient buffer.
async function mixedRegion(canvas,signal) {
  const w=canvas.width,h=canvas.height;
  if(w*h<400_000) return null;
  const ctx=canvas.getContext('2d');
  let x0=w,y0=h,x1=-1,y1=-1;
  const pad=64;let checkpoint=performance.now();
  for(let y=0;y<h;y+=96){
    const bh=Math.min(96,h-y);
    const data=ctx.getImageData(0,y,w,bh).data;
    const pixels=new Uint32Array(data.buffer,data.byteOffset,data.length/4);
    for(let j=0,p=0;j<bh;j++){
      for(let x=0;x<w;x++,p++)if(pixels[p]!==0xffffffff){
        if(x<10 || x>w-11 || y+j<10 || y+j>h-11)return null;
        if(x<x0)x0=x;if(x>x1)x1=x;
        if(y+j<y0)y0=y+j;if(y+j>y1)y1=y+j;
      }
    }
    if(x1>=x0 && (x1-x0+1)*(y1-y0+1)>w*h*.65) return null;
    // Let slower devices receive a cancellation even during pixel inspection.
    if(performance.now()-checkpoint>18){
      await new Promise(done=>setTimeout(done,0));check(signal);checkpoint=performance.now();
    }
  }
  if(x1<0)return null;
  x0=Math.max(0,x0-pad); y0=Math.max(0,y0-pad);
  x1=Math.min(w,x1+1+pad); y1=Math.min(h,y1+1+pad);
  const cw=x1-x0,ch=y1-y0;
  if(cw*ch>w*h*.65)return null;
  const crop=canvasAt(cw,ch);
  try{
    crop.getContext('2d').drawImage(canvas,x0,y0,cw,ch,0,0,cw,ch);
    return {canvas:crop,top:y0};
  }catch(e){crop.width=crop.height=0;throw e;}
}
const brokenWebp = () => error('Не удалось прочитать изображение WebP. Проверьте файл.');
const animation = () => error('Анимированный WebP не поддерживается. Сохраните нужный кадр как изображение.');
const u24 = (bytes,i) => bytes[i]+bytes[i+1]*256+bytes[i+2]*65536;

// Preflight dimensions before native decoding. An extended WebP's canvas must
// agree with its actual VP8/VP8L frame; an animation could hide many more frames.
function webpDimensions(bytes) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length<20 || d.getUint32(0)!==0x52494646 || d.getUint32(8)!==0x57454250 || d.getUint32(4,true)!==bytes.length-8) throw brokenWebp();
  let canvas, frame;
  for (let p=12; p<bytes.length;) {
    if (p+8>bytes.length) throw brokenWebp();
    const tag=d.getUint32(p), n=d.getUint32(p+4,true), i=p+8;
    p=i+n+(n%2);
    if(p>bytes.length) throw brokenWebp();
    if(tag===0x414e494d || tag===0x414e4d46) throw animation(); // ANIM, ANMF
    if(tag===0x56503858) { // VP8X
      if(canvas || i!==20 || n!==10) throw brokenWebp();
      if(bytes[i]&2) throw animation();
      canvas=[1+u24(bytes,i+4),1+u24(bytes,i+7)];
    } else if(tag===0x5650384c) { // VP8L
      if(frame || n<5 || bytes[i]!==0x2f || bytes[i+4]>>5) throw brokenWebp();
      const v=d.getUint32(i+1,true);
      frame=[1+(v & 0x3fff),1+((v>>>14)&0x3fff)];
    } else if(tag===0x56503820) { // VP8 (lossy keyframe)
      if(frame || n<10 || (bytes[i]&1) || bytes[i+3]!==0x9d || bytes[i+4]!==1 || bytes[i+5]!==0x2a) throw brokenWebp();
      frame=[d.getUint16(i+6,true)&0x3fff,d.getUint16(i+8,true)&0x3fff];
    }
  }
  if(!frame || !frame[0] || !frame[1] || (canvas&&(canvas[0]!==frame[0] || canvas[1]!==frame[1]))) throw brokenWebp();
  return {w:frame[0],h:frame[1],format:'WEBP'};
}

export function imageDimensions(bytes){
  const fail=()=>error('Не удалось прочитать изображение. Выберите корректный PNG, JPEG или WebP.');
  if (!bytes || bytes.length<24) throw fail();
  const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let w=0,h=0,format='';
  if(d.getUint32(0)===0x89504e47 && d.getUint32(4)===0x0d0a1a0a && d.getUint32(8)===13 && d.getUint32(12)===0x49484452){
    w=d.getUint32(16);h=d.getUint32(20);format='PNG';
    // Reject truncated/animated containers before handing bytes to a native decoder.
    let idat=false,ended=false;
    for(let i=8;i<=bytes.length-12;){
      const n=d.getUint32(i),type=d.getUint32(i+4);
      if(n>bytes.length-i-12)throw fail();
      if(type===0x6163544c)throw error('Анимированный PNG не поддерживается. Сохраните нужный кадр как изображение.');
      if(type===0x49444154 && n)idat=true;
      i+=n+12;
      if(type===0x49454e44){ended=n===0;break;}
    }
    if(!idat||!ended)throw fail();
  } else if(d.getUint16(0)===0xffd8){
    for(let i=2;i<bytes.length-1;){
      if(bytes[i++]!==255) throw fail();
      while(bytes[i]===255) i++;
      const marker=bytes[i++];
      if(marker===0xd9 || marker===0xda) break;
      if(marker===1 || (marker>=0xd0 && marker<=0xd7)) continue;
      if(i+2>bytes.length) throw fail();
      const n=d.getUint16(i);
      if(n<2 || i+n>bytes.length) throw fail();
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
        if(n<8) throw fail();
        h=d.getUint16(i+3);w=d.getUint16(i+5);format='JPEG';break;
      }
      i+=n;
    }
  } else if(d.getUint32(0)===0x52494646&&d.getUint32(8)===0x57454250){
    ({w,h,format}=webpDimensions(bytes));
  }
  if(!format||!w||!h) throw fail();
  if(w*h>SOURCE_PIXELS || Math.max(w,h)>16000) throw error('Слишком большое изображение. Уменьшите его до 32 мегапикселей и 16 000 пикселей по стороне.');
  return {w,h,format};
}
const validText=t => /[\p{L}\p{N}]/u.test(t) && !/\(cid:\d+\)/i.test(t);
function parseResult(result, height) {
  // TSV word coordinates preserve OCR layout order and let mixed pages insert
  // their new paragraphs relative to native paragraphs without reprinting them.
  const tsv=result?.tsv||'';
  if(tsv.length>5_000_000) throw error('Слишком много текста на странице.');
  const paragraphs=[];
  let last='', entry;
  for(const row of tsv.split('\n')){
    const f=row.split('\t');
    if(f.length<12 || f[0]!=='5') continue;
    const word=f.slice(11).join(' ').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
    if(!word) continue;
    const group=f.slice(1,4).join('.');
    if(last!==group){
      entry={text:word, y:Math.max(0,Math.min(1,Number(f[7])/height)), words:1}; paragraphs.push(entry);last=group;
    } else {entry.text+=' '+word;entry.words++;}
  }
  const conf=Number.isFinite(result?.confidence)?Math.max(0,Math.min(100,result.confidence)):null;
  // A faint fragment left just outside an invisible text mask (e.g. 'y.')
  // is not a confident transcription. Retain real short labels when legible.
  const kept=paragraphs.filter(x=>validText(x.text) && (conf>=70 || (x.text.match(/[\p{L}\p{N}]/gu)||[]).length>=3));
  return {paragraphs:kept, confidence:conf};
}
// Local to one import + language selection. Never key by OCR text, image size
// alone, object identity, PDF object id or a perceptual/fuzzy fingerprint.
const REUSE_BYTES=512*1024, REUSE_TEXT=64*1024;
function sameBytes(a,b){
  if(a.length!==b.length)return false;
  for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;
  return true;
}
// Positioned comic recognition is opt-in. It uses untouched full tile coordinates
// and never shares PDF paragraph filtering, crop geometry, or the repeat cache.
export function ocrSession(selected, signal, onProgress, {positioned=false,preserveLoadDeadline=false}={}) {
  let previous=null;
  let worker,seq=0,current=null,ready=false,closed=false, page=0,total=0;
  const emit=(stage,progress)=>onProgress?.({stage,page,total,progress});
  const close=()=>{
    closed=true; previous=null; worker?.terminate();worker=null; if(current) current.reject(signal?.aborted?abortError():ocrFailed());current=null;
    signal?.removeEventListener('abort',close);
  };
  signal?.addEventListener('abort',close,{once:true});
  const run=(action,payload,transfer=[])=>{
    check(signal);
    if(closed||!worker) throw ocrFailed();
    return new Promise((resolve,reject)=>{
      const id=String(++seq);
      const timer=setTimeout(()=>{if(current?.id===id){current=null;close();reject(Object.assign(error('Локальное OCR не ответило вовремя. Попробуйте более чёткий скан меньшего размера.'),{code:'OCR_JOB_TIMEOUT'}));}},90_000);
      current={id,action,resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}};
      try{worker.postMessage({workerId:'folio',jobId:id,action,payload},transfer);}catch{current.reject(ocrFailed());current=null;}
    });
  };
  return {close, async read(canvas,n,count,mixed=false){
    page=n;total=count;check(signal);
    if(!ready){
      emit('load',0);
      try{
        check(signal);worker=new Worker(new URL('worker.min.js',root));
        worker.onerror=ev=>{ev.preventDefault?.();close();};
        worker.onmessageerror=close;
        worker.onmessage=({data:m})=>{
          if(!current || m?.jobId!==current.id) return;
          if(m.status==='progress'){
            const p=Number(m.data?.progress)||0;
            emit(current.action==='recognize'?'recognize':'load',Math.max(0,Math.min(1,p)));return;
          }
          const pending=current;current=null;
          if(m.status==='resolve') pending.resolve(m.data);else pending.reject(ocrFailed());
        };
        await run('load',{options:{lstmOnly:true,corePath:root.href,logging:false}});
        await run('loadLanguage',{langs:selected,options:{langPath:root.href,cacheMethod:'none',gzip:true,lstmOnly:true}});
        await run('initialize',{langs:selected.join('+'),oem:1,config:{}});
        await run('setParameters',{params:{tessedit_pageseg_mode:positioned?'11':'3',preserve_interword_spaces:'1',user_defined_dpi:'220'}});
        ready=true;
      }catch(e){check(signal);if(e?.name==='AbortError'||(preserveLoadDeadline&&e?.code==='OCR_JOB_TIMEOUT'))throw e;throw modelUnavailable();}
    }
    check(signal);
    const recognize=async (target,role)=>{
      // PNG is required by the existing worker path. Keep the immutable Blob,
      // not a copy of the transferred array. Only length/dimension/role
      // matches reread the previous small Blob for an exact byte comparison.
      const blob=await new Promise((ok,fail)=>target.toBlob(b=>b?ok(b):fail(ocrFailed()),'image/png'));
      check(signal);const image=new Uint8Array(await blob.arrayBuffer());check(signal);
      const eligible=!positioned && count>1 && role && blob.size<=REUSE_BYTES;
      if(eligible && previous?.role===role && previous.width===target.width &&
         previous.height===target.height && previous.blob.size===blob.size){
        const prior=previous;let identical=false;
        try{identical=sameBytes(image,new Uint8Array(await prior.blob.arrayBuffer()));}
        catch{/* An optional comparison must never prevent recognition. */}
        check(signal);
        if(identical)return prior.result;
      }
      previous=null;
      emit('recognize',0);
      // The pinned worker enables plain text by default even alongside TSV.
      // PDF imports consume only TSV+confidence. Korean comics use native spacing.
      const raw=await run('recognize',{image,options:{},output:{tsv:true,text:positioned && selected[0]==='kor'}},[image.buffer]);
      check(signal);
      if(positioned){
        const tsv=raw?.tsv||'';
        if(typeof tsv!=='string'||tsv.length>5_000_000)throw error('Слишком много текста на странице.');
        // Korean TSV fragments can be syllables. The engine's native text
        // contains the actual Korean word spaces and is used only when aligned.
        return {tsv,text:selected[0]==='kor' && typeof raw?.text==='string' && raw.text.length<=160000?raw.text:''};
      }
      const result=parseResult(raw,target.height);
      if(eligible && result.confidence>=90 && result.paragraphs.length && result.paragraphs.length<=2048 &&
         result.paragraphs.reduce((n,p)=>n+p.text.length,0)<=REUSE_TEXT){
        previous={role,width:target.width,height:target.height,blob,result};
      }
      return result;
    };
    // Cropping never applies to full scans/photos or suspect text layers.
    let region;
    try {
      if(mixed && !positioned){
        // A browser may refuse pixels/readback or an extra canvas under memory
        // pressure. Do not make the ordinary full-page OCR path depend on this.
        try{region=await mixedRegion(canvas,signal);}catch{check(signal);/* full-page fallback */}
      }
      if(region){
        const r=await recognize(region.canvas,'crop');
        // Changed segmentation can occasionally lose a caption on cropped input.
        // Always retry the unmodified page on an empty or uncertain result.
        if(r.paragraphs.length && r.confidence!=null && r.confidence>=90){
          // Cached geometry stays crop-local; each physical page maps its own
          // top offset, even if the identical caption appears lower down.
          return {...r,paragraphs:r.paragraphs.map(p=>({...p,y:(p.y*region.canvas.height+region.top)/canvas.height}))};
        }
      }
    } finally {if(region)region.canvas.width=region.canvas.height=0;}
    // An uncertain crop always retries the untouched page, never a cached guess.
    return await recognize(canvas,region?null:'full');
  }};
}
