import {imageDimensions} from './ocr-engine.js';
const MiB=1024*1024;
const MAX_IMAGE=3*MiB,MAX_BOOK_BYTES=8*MiB,MAX_TOTAL_BYTES=24*MiB;
const MAX_PIXELS=8_000_000,MAX_TOTAL_PIXELS=80_000_000;
const MAX_REFS=80;
const types=new Map([['image/png','PNG'],['image/jpeg','JPEG'],['image/webp','WEBP']]);
const invalid=()=>new Error('Иллюстрации EPUB в копии повреждены или не поддерживаются.');
const tooLarge=()=>new Error('Иллюстрации превышают лимит копии. Скачайте копию без изображений или сохраните исходные EPUB отдельно.');
const payloadSize=text=>{
  if(typeof text!=='string'||!text.length||text.length%4)throw invalid();
  const pad=text.endsWith('==')?2:text.endsWith('=')?1:0;
  const size=text.length*.75-pad;
  if(size>MAX_IMAGE)throw tooLarge();
  if(/[^A-Za-z0-9+/]/.test(pad?text.slice(0,-pad):text))throw invalid();
  return size;
};
function layout(book,chapters,assets){
  if(!Array.isArray(chapters)||!chapters.length||chapters.length>Math.min(book.chapters.length,MAX_REFS)||
     !Number.isInteger(assets)||assets<1||assets>MAX_REFS)throw invalid();
  const seen=new Set(),used=new Set();let count=0;
  const checked=chapters.map(chapter=>{
    const i=chapter?.index,slots=chapter?.slots;
    if(!Number.isInteger(i)||!book.chapters[i]||seen.has(i)||!Array.isArray(slots)||!slots.length||(count+=slots.length)>MAX_REFS)throw invalid();
    seen.add(i);
    return {index:i,slots:slots.map(slot=>{
      const {asset,before,alt}=slot||{};
      if(!Number.isInteger(asset)||asset<0||asset>=assets||
         !Number.isInteger(before)||before<0||before>book.chapters[i].paragraphs.length||typeof alt!=='string'||alt.length>600)throw invalid();
      used.add(asset);return {asset,before,alt};
    })};
  });
  if(used.size!==assets)throw invalid();
  return checked;
}
function budget(){
  let bytes=0,pixels=0;
  return {
    bytes(count){if((bytes+=count)>MAX_TOTAL_BYTES)throw tooLarge();},
    pixels(count){if(count>MAX_PIXELS||(pixels+=count)>MAX_TOTAL_PIXELS)throw tooLarge();},
  };
}
function inspect(bytes,type,limits){
  if(!types.has(type))throw invalid();
  let measured;
  try{measured=imageDimensions(bytes);}catch{throw invalid();}
  if(measured.format!==types.get(type))throw invalid();
  limits.pixels(measured.w*measured.h);
  return {width:measured.w,height:measured.h};
}
function encode(bytes){
  const parts=[];
  for(let start=0;start<bytes.length;start+=0x8000)parts.push(String.fromCharCode(...bytes.subarray(start,start+0x8000)));
  return btoa(parts.join(''));
}
function decode(data){
  let binary;
  try{binary=atob(data);}catch{throw invalid();}
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
export async function collectEpubBackup(books,read,{active=()=>true}={}){
  const limits=budget(),out=[];
  for(const book of books){
    if(book.format!=='EPUB')continue;
    const ids=new Map(),chapters=[];
    book.chapters.forEach(({illustrations},index)=>{
      if(!illustrations?.length)return;
      chapters.push({index,slots:illustrations.map(({asset,before,alt})=>{
        if(!Number.isInteger(asset)||asset<0||asset>=MAX_REFS)throw invalid();
        if(!ids.has(asset))ids.set(asset,ids.size);
        return {asset:ids.get(asset),before,alt};
      })});
    });
    if(!chapters.length)continue;
    const checked=layout(book,chapters,ids.size),assets=[];let size=0;
    for(const old of ids.keys()){
      if(!active())return null;
      const blob=await read(book.id,old);
      if(!(blob instanceof Blob)||!blob.size)throw invalid();
      if(blob.size>MAX_IMAGE||(size+=blob.size)>MAX_BOOK_BYTES)throw tooLarge();
      limits.bytes(blob.size);
      const bytes=new Uint8Array(await blob.arrayBuffer());
      if(!active())return null;
      inspect(bytes,blob.type,limits);
      assets.push({type:blob.type,data:encode(bytes)});
    }
    out.push({id:book.id,chapters:checked,assets});
  }
  return out;
}
export function restoreEpubBackup(raw,books){
  if(!Array.isArray(raw)||raw.length>books.length)throw invalid();
  const byId=new Map(books.filter(b=>b.format==='EPUB').map(b=>[b.id,b])),assetsByBook=new Map(),limits=budget();
  const layouts=new Map();
  for(const row of raw){
    const book=byId.get(row?.id);
    if(!book||layouts.has(book.id)||!Array.isArray(row.assets))throw invalid();
    const chapters=layout(book,row.chapters,row.assets.length);
    let size=0;
    const images=row.assets.map(asset=>{
      if(!types.has(asset?.type))throw invalid();
      const count=payloadSize(asset.data);
      if((size+=count)>MAX_BOOK_BYTES)throw tooLarge();
      limits.bytes(count);
      const bytes=decode(asset.data),box=inspect(bytes,asset.type,limits);
      return {...box,blob:new Blob([bytes],{type:asset.type})};
    });
    assetsByBook.set(book.id,images.map(v=>v.blob));
    layouts.set(book.id,new Map(chapters.map(({index,slots})=>[index,slots.map(slot=>{
      const {width,height}=images[slot.asset];
      return {...slot,width,height};
    })])));
  }
  return {assetsByBook,books:books.map(book=>{
    const drawing=layouts.get(book.id);
    return !drawing?book:{...book,chapters:book.chapters.map((chapter,i)=>drawing.has(i)?{...chapter,illustrations:drawing.get(i)}:chapter)};
  })};
}
