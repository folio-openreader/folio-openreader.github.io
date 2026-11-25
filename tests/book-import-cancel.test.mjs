import test from 'node:test';
import assert from 'node:assert/strict';
import {crc32,deflateRawSync} from 'node:zlib';
import {parseBook} from '../dist/importers.js';
import {parseComicFiles} from '../dist/comic-import.js';

const deferred=()=>{let resolve;const promise=new Promise(ok=>resolve=ok);return {promise,resolve}};
const next=()=>new Promise(setImmediate);
function replace(t,name,value){
  const previous=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  t.after(()=>{if(previous)Object.defineProperty(globalThis,name,previous);else delete globalThis[name];});
}
function zipFile(name,rows){
  const local=[],central=[];let offset=0;
  for(const [path,text,packed] of rows){
    const file=Buffer.from(text),n=Buffer.from(path),body=packed?deflateRawSync(file):file;
    const header=Buffer.alloc(30),directory=Buffer.alloc(46),method=packed?8:0;
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(method,8);
    header.writeUInt32LE(crc32(file),14);header.writeUInt32LE(body.length,18);header.writeUInt32LE(file.length,22);header.writeUInt16LE(n.length,26);
    directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,6);directory.writeUInt16LE(method,10);
    directory.writeUInt32LE(crc32(file),16);directory.writeUInt32LE(body.length,20);directory.writeUInt32LE(file.length,24);
    directory.writeUInt16LE(n.length,28);directory.writeUInt32LE(offset,42);
    local.push(header,n,body);central.push(directory,n);offset+=header.length+n.length+body.length;
  }
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(rows.length,8);end.writeUInt16LE(rows.length,10);
  end.writeUInt32LE(central.reduce((a,b)=>a+b.length,0),12);end.writeUInt32LE(offset,16);
  return new File([...local,...central,end],name);
}
const C='urn:oasis:names:tc:opendocument:xmlns:container',P='http://www.idpf.org/2007/opf',X='http://www.w3.org/1999/xhtml',D='http://purl.org/dc/elements/1.1/';
function el(namespaceURI,localName,attrs={},children=[],textContent=''){
  return {nodeType:1,namespaceURI,localName,children,textContent,
    childNodes:children.length?children:[{nodeType:3,nodeValue:textContent}],hasAttribute:k=>Object.hasOwn(attrs,k),getAttribute:k=>attrs[k]??null};
}
function epub(t,{packed=false,count=3,onChapter=()=>{}}={}){
  const paths=Array.from({length:count},(_,i)=>'chapter-'+i+'.xhtml'),book=el(P,'package',{},[
    el(P,'metadata',{},[el(D,'title',{},[],'Test volume')]),
    el(P,'manifest',{},paths.map(href=>el(P,'item',{id:href,href,'media-type':'application/xhtml+xml'}))),
    el(P,'spine',{},paths.map(idref=>el(P,'itemref',{idref})))
  ]);
  const container=el(C,'container',{},[el(C,'rootfiles',{},[el(C,'rootfile',{'media-type':'application/oebps-package+xml','full-path':'book.opf'})])]);
  replace(t,'DOMParser',class{parseFromString(text){
    let documentElement;
    if(text==='container')documentElement=container;
    else if(text==='book')documentElement=book;
    else {onChapter(text);documentElement=el(X,'html',{},[el(X,'body',{},[el(X,'p',{},[],text)])]);}
    return {documentElement,getElementsByTagNameNS:()=>[]};
  }});
  return zipFile('test.epub',[['mimetype','application/epub+zip'],['META-INF/container.xml','container'],
    ['book.opf','book'],...paths.map((path,i)=>[path,'Chapter source '+i,packed&&i===1])]);
}
function blockedInflation(t){
  const entered=deferred();let readable,cancels=0;
  replace(t,'DecompressionStream',class{
    constructor(){
      this.readable=new ReadableStream({start:controller=>readable=controller,cancel:()=>{cancels++;}});
      this.writable=new WritableStream({write:()=>entered.resolve()});
    }
  });
  return {entered:entered.promise,get cancels(){return cancels;},release(){try{readable.close();}catch{}}};
}
async function expectPromptAbort(job){
  assert.equal(await Promise.race([job.then(()=> 'resolved',e=>e.name),next().then(()=> 'still unpacking')]),'AbortError');
}

test('cancel actual EPUB import while decompressing: the pending stream stops and no later chapter is parsed',async t=>{
  const parsed=[],file=epub(t,{packed:true,onChapter:text=>parsed.push(text)}),worker=blockedInflation(t),abort=new AbortController();
  const job=parseBook(file,{signal:abort.signal});
  await worker.entered;abort.abort();
  try{await expectPromptAbort(job);assert.equal(worker.cancels,1);assert.deepEqual(parsed,['Chapter source 0']);}
  finally{worker.release();await job.catch(()=>{});}
});
test('cancel actual CBZ import while decompressing: the cancellation is not a corrupt ZIP error',async t=>{
  const worker=blockedInflation(t),abort=new AbortController(),file=zipFile('test.cbz',[['01.png',Buffer.from([1,2,3]),true]]);
  const job=parseComicFiles([file],{signal:abort.signal});
  await worker.entered;abort.abort();
  try{await expectPromptAbort(job);assert.equal(worker.cancels,1);}
  finally{worker.release();await job.catch(()=>{});}
});
test('a dense uncompressed EPUB allows a pending touch or click to cancel remaining chapters',async t=>{
  const abort=new AbortController(),visited=[];
  let now=0;replace(t,'performance',{now:()=>now+=14});
  const file=epub(t,{count:24,onChapter:text=>{
    visited.push(text);if(visited.length===1)setTimeout(()=>abort.abort(),0);
  }});
  await assert.rejects(parseBook(file,{signal:abort.signal}),{name:'AbortError'});
  assert.deepEqual(visited,['Chapter source 0']);
});
test('normal EPUB import still returns text in spine order',async t=>{
  const book=await parseBook(epub(t,{packed:true}),{signal:new AbortController().signal});
  assert.equal(book.title,'Test volume');
  assert.deepEqual(book.chapters.map(chapter=>chapter.paragraphs[0]),['Chapter source 0','Chapter source 1','Chapter source 2']);
});
test('pre-cancelled TXT does not load bytes and cancellation after reading is not a UTF-8 error',async()=>{
  const before=new AbortController();before.abort();
  await assert.rejects(parseBook({name:'test.txt',size:1,arrayBuffer(){assert.fail('should not read cancelled file');}},{signal:before.signal}),{name:'AbortError'});
  const later=new AbortController(),bytes=deferred();
  const reading=parseBook({name:'test.txt',size:1,arrayBuffer:()=>bytes.promise},{signal:later.signal});
  later.abort();bytes.resolve(Uint8Array.of(0xff).buffer);
  await assert.rejects(reading,{name:'AbortError'});
});

function encodedBook(t,byteOrder,{entity=false,truncated=false}={}){
  const title='Қазақша оқу — 中文',line='Кітаптағы сөз. La rivière. 📖';
  const path='book/one.xhtml',declaration='<?xml version="1.0" encoding="UTF-16"?>';
  const container=declaration+'<container xmlns="'+C+'" version="1.0"><rootfiles>'+
    '<rootfile media-type="application/oebps-package+xml" full-path="book/content.opf"/></rootfiles></container>';
  const pkg=declaration+'<package xmlns="'+P+'" xmlns:dc="'+D+'" version="3.0" unique-identifier="pub-id">'+
    '<metadata><dc:title>'+title+'</dc:title><dc:identifier id="pub-id">fixture</dc:identifier><dc:language>kk</dc:language></metadata>'+
    '<manifest><item id="chapter" href="one.xhtml" media-type="application/xhtml+xml"/></manifest>'+
    '<spine><itemref idref="chapter"/></spine></package>';
  const chapter=declaration+(entity?'<!DOCTYPE html [<!ENTITY local "fixture">]>':'')+
    '<html xmlns="'+X+'"><head><title>Chapter</title></head><body><p>'+line+'</p></body></html>';
  const encode=xml=>{
    const le=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(xml,'utf16le')]);
    return byteOrder==='be'?le.swap16():le;
  };
  const validChapter=encode(chapter);
  const seen=[];
  replace(t,'DOMParser',class{parseFromString(text,type){
    assert.equal(type,'application/xml');seen.push(text);
    let documentElement;
    if(text===container)documentElement=el(C,'container',{},[el(C,'rootfiles',{},[el(C,'rootfile',{
      'media-type':'application/oebps-package+xml','full-path':'book/content.opf'})])]);
    else if(text===pkg)documentElement=el(P,'package',{},[
      el(P,'metadata',{},[el(D,'title',{},[],title),el(D,'language',{},[],'kk')]),
      el(P,'manifest',{},[el(P,'item',{id:'chapter',href:'one.xhtml','media-type':'application/xhtml+xml'})]),
      el(P,'spine',{},[el(P,'itemref',{idref:'chapter'})])
    ]);
    else if(text===chapter)documentElement=el(X,'html',{},[el(X,'body',{},[el(X,'p',{},[],line)])]);
    return {documentElement,getElementsByTagNameNS:()=>[]};
  }});
  return {title,line,seen,file:zipFile('utf16.epub',[
    ['mimetype','application/epub+zip'],['META-INF/container.xml',encode(container)],['book/content.opf',encode(pkg),true],
    [path,truncated?validChapter.subarray(0,validChapter.length-1):validChapter,true]
  ])};
}

for(const byteOrder of ['le','be'])test('the book importer reads EPUB XML marked as UTF-16 '+byteOrder.toUpperCase(),async t=>{
  const fixture=encodedBook(t,byteOrder),book=await parseBook(fixture.file,{signal:new AbortController().signal});
  assert.equal(book.title,fixture.title);assert.equal(book.language,'kk');
  assert.deepEqual(book.chapters[0].paragraphs,[fixture.line]);assert.equal(fixture.seen.length,3);
});

test('bad UTF-16 data and unsupported entity declarations still fail before XML parsing of that chapter',async t=>{
  const broken=encodedBook(t,'le',{truncated:true});
  await assert.rejects(parseBook(broken.file),/damaged|unsupported/i);assert.equal(broken.seen.length,2);
  const entity=encodedBook(t,'be',{entity:true});
  await assert.rejects(parseBook(entity.file),/damaged|unsupported/i);assert.equal(entity.seen.length,2);
});
