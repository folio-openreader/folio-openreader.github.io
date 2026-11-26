// Catalog metadata and one selected book at a time, from this app's own origin.
const ID=/^starter-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGS=new Set(['en','ru']);
const LEVELS=new Set(['A1','A2','B1','B2','C1','C2']);
const MAX_CATALOG=130_000, MAX_BOOK=4*1024*1024;
const BAD='Не удалось открыть издание. Попробуй ещё раз.';
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const short=(v,n)=>typeof v==='string'&&v.trim()&&v.length<=n;
const invalid=()=>{throw Error(BAD)};
export const isStarterId=id=>typeof id==='string'&&id.length<=100&&ID.test(id);
export function starterSourceURL(value){
  if(!short(value,1000))return '';
  try{
    const url=new URL(value);
    const allowed=(url.hostname==='standardebooks.org'&&url.pathname.startsWith('/ebooks/'))||
      (url.hostname==='www.gutenberg.org'&&/^\/ebooks\/\d+/.test(url.pathname))||
      (url.hostname==='github.com'&&/^\/Digital-Dostoevsky\/(?:corpus|tei)(?:\/|$)/i.test(url.pathname));
    return allowed&&url.protocol==='https:'&&!url.port&&!url.username&&!url.password?url.href:'';
  }catch{return ''}
}

// Historical print sources can record a year or their original serial range.
export function starterPublicationYear(raw){
  const valid=y=>Number.isInteger(y)&&y>=1400&&y<=1955;
  if(typeof raw==='number')return valid(raw)?raw:null;
  const m=typeof raw==='string'?/^([0-9]{4})(?:[–-]([0-9]{4}))?$/.exec(raw.trim()):null;
  if(!m||!valid(Number(m[1])))return null;
  if(!m[2])return Number(m[1]);
  return valid(Number(m[2]))&&Number(m[2])>=Number(m[1])?m[1]+'–'+m[2]:null;
}

export function parseStarterCatalog(raw){
  if(raw?.version!==1||!Array.isArray(raw.books)||raw.books.length<1||raw.books.length>48)invalid();
  const known=new Set();
  const books=raw.books.map(x=>{
    if(!object(x)||!isStarterId(x.id)||known.has(x.id)||x.asset!==`starter/books/${x.id}.json`||!short(x.title,200)||!short(x.author,140)||
      !LANGS.has(x.language)||!LEVELS.has(x.level)||!Array.isArray(x.genres)||!x.genres.length||x.genres.length>3||!x.genres.every(g=>short(g,48))||
      !Number.isSafeInteger(x.byteLen)||x.byteLen<64||x.byteLen>MAX_BOOK||!(/^[a-f0-9]{64}$/.test(x.sha256||'')))invalid();
    const ed=x.edition, source=short(ed?.source,100)?ed.source:'', sourceUrl=starterSourceURL(ed?.sourceUrl);
    if(!source||!sourceUrl)invalid();
    const edition=Object.freeze({source,sourceUrl,translator:short(ed.translator,140)?ed.translator:'',
      publicationYear:starterPublicationYear(ed.publicationYear)});
    known.add(x.id);
    return Object.freeze({id:x.id,title:x.title,author:x.author,language:x.language,level:x.level,genres:Object.freeze([...x.genres]),
      asset:x.asset,byteLen:x.byteLen,sha256:x.sha256,edition,
      ...(short(x.description,220)?{description:x.description}:{}),
      ...(Number.isInteger(x.words)&&x.words>0?{words:x.words}:{})});
  });
  return Object.freeze(books);
}
export function parseStarterBook(raw,entry){
  if(!object(raw)||raw.id!==entry.id||raw.title!==entry.title||raw.author!==entry.author||
     raw.language!==entry.language||raw.format!=='TXT'||raw.alignment!=='none'||!Array.isArray(raw.chapters)||!raw.chapters.length||raw.chapters.length>1024)invalid();
  let size=0,count=0;
  const chapters=raw.chapters.map(c=>{
    if(!object(c)||!short(c.title,350)||!Array.isArray(c.paragraphs)||!c.paragraphs.length)invalid();
    return {title:c.title,paragraphs:c.paragraphs.map(p=>{
      if(!object(p)||!short(p.text,30_000)||p.translation!=null||++count>16000||(size+=p.text.length)>3_000_000)invalid();
      return {text:p.text,translation:null};
    })};
  });
  return {id:entry.id,title:entry.title,author:entry.author,language:entry.language,format:'TXT',alignment:'none',chapters,edition:entry.edition,createdAt:0};
}
async function bytesFrom(f,url,cap,signal){
  const res=await f(url,{mode:'same-origin',redirect:'error',signal});
  if(!res.ok||!res.body?.getReader)invalid();
  const announced=Number(res.headers?.get('content-length'));
  if(announced>cap){void res.body.cancel().catch(()=>{});invalid();}
  const reader=res.body.getReader();const chunks=[];let total=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;
      if((total+=value.length)>cap){void reader.cancel().catch(()=>{});invalid();}
      chunks.push(value);
    }
  }finally{reader.releaseLock()}
  const buffer=new Uint8Array(total);let offset=0;
  for(const chunk of chunks){buffer.set(chunk,offset);offset+=chunk.length;}
  return buffer;
}
const toJson=raw=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
const toHex=bytes=>[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
export function createStarterSource({fetcher=globalThis.fetch,digest=bytes=>globalThis.crypto.subtle.digest('SHA-256',bytes)}={}){
  let catalog;
  const pending=new Map();
  async function read(asset,cap,timeout){
    const request=new AbortController();
    const timer=setTimeout(()=>request.abort(),timeout);
    try{return await bytesFrom(fetcher,new URL(asset,import.meta.url),cap,request.signal)}
    finally{clearTimeout(timer)}
  }
  function loadCatalog(){
    return catalog??=read('starter/manifest.json',MAX_CATALOG,12_000).then(parseBytes).catch(e=>{catalog=null;throw e});
  }
  function parseBytes(bytes){return parseStarterCatalog(toJson(bytes))}
  async function loadBook(id){
    if(!isStarterId(id))invalid();
    if(pending.has(id))return pending.get(id);
    const work=(async()=>{
      const entry=(await loadCatalog()).find(b=>b.id===id);
      if(!entry)invalid();
      const bytes=await read(entry.asset,entry.byteLen,22_000);
      if(bytes.length!==entry.byteLen||toHex(await digest(bytes))!==entry.sha256)invalid();
      return parseStarterBook(toJson(bytes),entry);
    })().finally(()=>pending.delete(id));
    pending.set(id,work);
    return work;
  }
  return {loadCatalog,loadBook};
}
