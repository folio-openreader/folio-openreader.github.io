// Page-preserving local import. Only raster data enters a page Blob; ZIP markup,
// URLs, thumbnails in hidden folders, and ComicInfo.xml are never interpreted.
import { zip } from './importers.js';
import { imageDimensions, decodePageImage, check, MAX_IMAGE_BYTES, SOURCE_PIXELS } from './ocr-engine.js';
export {decodePageImage as decodeComicImage};

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
export function comicImageHeader(bytes, name) {
  if (!(bytes instanceof Uint8Array) || bytes.length>L.imageBytes) throw fail('Одна страница превышает 16 МБ или имеет неверный формат.');
  const expected = ext.exec(name)?.[1].toLowerCase().replace('jpg','jpeg');
  const decoded = imageDimensions(bytes);
  if(decoded.format.toLowerCase()!==expected) throw fail('Расширение страницы не соответствует типу изображения.');
  if(decoded.w>L.side || decoded.h>L.side || decoded.w*decoded.h>L.imagePixels) throw tooLarge();
  return {...decoded,type:'image/'+expected};
}

async function decodeSize(blob,signal){
  const decoded=await decodePageImage(blob,signal,'Для импорта комикса нужен современный браузер.');
  try{check(signal);return [decoded.width,decoded.height];}
  finally{decoded.close();}
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
    try {archive=zip(input,{maxDocument:L.imageBytes,maxTotal:L.totalBytes,signal});}
    catch(e){check(signal);throw wrapZip(e);}
    const entries=archive.names().filter(n=>!hidden(n));
    if(entries.some(n=>otherArt.test(n))) throw fail('В архиве есть неподдерживаемые страницы. Сохраните их как JPG, PNG или WebP.');
    const names=entries.filter(n=>ext.test(n)).sort(sortNames);
    if(!names.length) throw fail('В архиве не найдены страницы JPG, PNG или WebP.');
    if(names.length>L.pages) throw tooMany();
    records=names.map(name=>({name,load:async()=>{
      try {return await archive.read(name,{binary:true});}
      catch(e){check(signal);throw wrapZip(e);}
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
