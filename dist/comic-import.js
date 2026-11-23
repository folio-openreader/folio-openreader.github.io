// Page-preserving local import. Only raster data enters a page Blob; ZIP markup,
// URLs, thumbnails in hidden folders, and ComicInfo.xml are never interpreted.
import { zip } from './importers.js';
import { imageDimensions, check, MAX_IMAGE_BYTES, SOURCE_PIXELS } from './ocr-engine.js';

const MiB = 1024 * 1024;
export const COMIC_LIMITS = Object.freeze({
  archiveBytes: 96 * MiB, totalBytes: 120 * MiB, imageBytes: MAX_IMAGE_BYTES,
  pages: 320, side: 16000, imagePixels: SOURCE_PIXELS, totalPixels: 650_000_000,
});
const L = COMIC_LIMITS;
const ext = /\.(png|jpe?g|webp)$/i, archiveExt = /\.(cbz|zip)$/i;
const otherArt = /\.(gif|apng|avif|bmp|dib|tiff?|heic|heif|svgz?|jxl|jp2|j2k)$/i;
const hidden = s => s.split('/').some(part => (part !== '.' && part.startsWith('.')) || part.toLowerCase() === '__macosx');
const basename = path => path.split(/[\\/]/).pop();
const compare = new Intl.Collator('en', {numeric:true, sensitivity:'base'});
const sortNames = (a,b) => compare.compare(a,b) || (a<b?-1:a>b?1:0);
const safeText = (s, max=200) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim().slice(0,max);
const fail = message => new Error(message);
const formats = () => fail('Выберите один PDF, архив CBZ/ZIP или страницы JPG, PNG, WebP.');
const tooMany = () => fail('В одной книге может быть не более 320 страниц. Разделите её на части.');
const tooHeavy = () => fail('Суммарный размер страниц превышает 120 МБ. Разделите книгу на части.');
const tooLarge = () => fail('Уменьшите изображение до 32 мегапикселей и 16 000 пикселей по стороне.');
const tooComplex = () => fail('Общее разрешение страниц слишком большое. Разделите книгу на части.');
const brokenWebp = () => fail('Не удалось прочитать страницу WebP. Проверьте файл.');
const animation = () => fail('Анимированные страницы не поддерживаются. Сохраните статичное изображение.');
const u24 = (bytes,i) => bytes[i]+bytes[i+1]*256+bytes[i+2]*65536;

// Preflight dimensions before native decoding. An extended WebP's canvas must
// agree with its actual VP8/VP8L frame; an animation could hide many more frames.
function webp(bytes) {
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

export function comicImageHeader(bytes, name) {
  if (!(bytes instanceof Uint8Array) || bytes.length>L.imageBytes) throw fail('Одна страница превышает 16 МБ или имеет неверный формат.');
  const expected = ext.exec(name)?.[1].toLowerCase().replace('jpg','jpeg');
  const decoded = expected==='webp'?webp(bytes):imageDimensions(bytes);
  if(decoded.format.toLowerCase()!==expected) throw fail('Расширение страницы не соответствует типу изображения.');
  if(decoded.w>L.side || decoded.h>L.side || decoded.w*decoded.h>L.imagePixels) throw tooLarge();
  return {...decoded,type:'image/'+expected};
}

async function decodeSize(blob,signal) {
  check(signal);
  if(typeof globalThis.createImageBitmap==='function') {
    const bitmap = await createImageBitmap(blob, {imageOrientation:'from-image'});
    try {check(signal);return [bitmap.width,bitmap.height];}
    finally {bitmap.close();}
  }
  // For engines without ImageBitmap, decode only our just-validated raster Blob.
  if(typeof Image!=='function') throw fail('Для импорта комикса нужен современный браузер.');
  const img=new Image(), url=URL.createObjectURL(blob);
  const abort=()=>img.removeAttribute('src');
  try {
    img.src=url;signal?.addEventListener('abort',abort,{once:true});
    await img.decode();check(signal);return [img.naturalWidth,img.naturalHeight];
  } finally {
    signal?.removeEventListener('abort',abort);img.removeAttribute('src');URL.revokeObjectURL(url);
  }
}

function wrapZip(err) {
  if(/large to unpack/i.test(err?.message)) return fail('Архив слишком большой: до 16 МБ на страницу и до 120 МБ после распаковки.');
  if(/cannot unpack/i.test(err?.message)) return fail('Браузер не поддерживает сжатие этого CBZ. Обновите его или выберите распакованные изображения.');
  if(/encrypt|protect/i.test(err?.message)) return fail('Архив защищён. Выберите незашифрованный CBZ.');
  return fail('Не удалось распаковать CBZ. Проверьте, что это исправный ZIP со страницами.');
}

// Common prefixes survive generic numbered file names, e.g. "Night train 01".
// No guess based on EXIF, authors or ComicInfo; the title can be edited by the UI.
function looseTitle(names) {
  const first=basename(names[0]).replace(ext,'');
  if(names.length===1) return safeText(first)||'Комикс';
  const stems=names.map(n=>basename(n).replace(ext,'').replace(/[\s_.-]*\d+[\s_.-]*$/u,''));
  return stems[0] && stems.every(s=>s===stems[0]) ? safeText(stems[0])||'Комикс':'Комикс';
}

/**
 * Return {title,format:'CBZ'|'IMAGES'|'PDF',pages:[{name,blob,width,height}],warnings:[]}.
 * No upload, OCR, writes or partial imports. Direct images retain all original
 * bytes; PDF uses only same-origin rendering assets with raster output. Callers can persist the Blobs separately from metadata and page order.
 */
export async function parseComicFiles(files,{signal,onProgress}={}) {
  check(signal);
  if(!Number.isSafeInteger(files?.length) || files.length<1) throw formats();
  if(files.length>L.pages) throw tooMany();
  const list=Array.from(files);
  if(list.some(f=>typeof f?.name!=='string' || !(f instanceof Blob) || !f.size)) throw formats();
  if(list.length===1 && /\.pdf$/i.test(list[0].name)) {
    const file=list[0], {rasterComicPdf}=await import('./comic-pdf.js');
    const pages=await rasterComicPdf(file,{signal,onProgress});
    return {title:safeText(basename(file.name).replace(/\.pdf$/i,''))||'Комикс',format:'PDF',pages,warnings:[]};
  }
  const archived=list.length===1 && archiveExt.test(list[0].name);
  let records, title;
  if(archived) {
    const file=list[0];
    if(file.size>L.archiveBytes) throw fail('Архив больше 96 МБ. Разделите книгу на части.');
    const input=await file.arrayBuffer();
    check(signal);
    let archive;
    try {archive=zip(input,{maxDocument:L.imageBytes,maxTotal:L.totalBytes});}
    catch(e){throw wrapZip(e);}
    const entries=archive.names().filter(n=>!hidden(n));
    if(entries.some(n=>otherArt.test(n))) throw fail('В архиве есть неподдерживаемые страницы. Сохраните их как JPG, PNG или WebP.');
    const names=entries.filter(n=>ext.test(n)).sort(sortNames);
    if(!names.length) throw fail('В архиве не найдены страницы JPG, PNG или WebP.');
    if(names.length>L.pages) throw tooMany();
    records=names.map(name=>({name,load:async()=>{
      try {return await archive.read(name,{binary:true});}
      catch(e){throw wrapZip(e);}
    }}));
    title=safeText(basename(file.name).replace(archiveExt,''))||'Комикс';
  } else {
    if(list.some(f=>!ext.test(f.name))) throw formats();
    if(list.some(f=>f.size>L.imageBytes)) throw fail('Одна страница превышает 16 МБ. Уменьшите её размер.');
    if(list.reduce((s,f)=>s+f.size,0)>L.totalBytes) throw tooHeavy();
    records=list.map(file=>({name:file.webkitRelativePath||file.name,file,load:async()=>new Uint8Array(await file.arrayBuffer())}))
      .sort((a,b)=>sortNames(a.name,b.name));
    title=looseTitle(records.map(r=>r.name));
  }
  const pages=[];let totalPixels=0;
  for(const r of records){
    check(signal);onProgress?.({stage:'pages',page:pages.length+1,total:records.length});check(signal);
    const bytes=await r.load();check(signal);
    let info;
    try {info=comicImageHeader(bytes,r.name);} catch(e) {
      throw fail('Страница «'+safeText(basename(r.name),90)+'»: '+e.message);
    }
    if((totalPixels+=info.w*info.h)>L.totalPixels) throw tooComplex();
    const blob=r.file ? r.file.slice(0,r.file.size,info.type) : new Blob([bytes],{type:info.type});
    let width,height;
    try {[width,height]=await decodeSize(blob,signal);}
    catch {check(signal);throw fail('Не удалось открыть изображение «'+safeText(basename(r.name),90)+'». Проверьте файл.');}
    // EXIF may rotate axes. Do not store a crop or orientation that won't match OCR.
    if(!((width===info.w && height===info.h)||(width===info.h && height===info.w)))
      throw fail('Разрешение страницы не совпадает с заголовком изображения.');
    pages.push({name:safeText(r.name)||'Страница '+(pages.length+1),blob,width,height});
  }
  check(signal);
  return {title,format:archived?'CBZ':'IMAGES',pages,warnings:[]};
}
