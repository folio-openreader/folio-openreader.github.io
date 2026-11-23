// Curated publisher-approved reading editions. A search/filter operation reads
// metadata only. No user text, query, identifiers, or credentials leave Folio.
const CC='https://creativecommons.org/licenses/by/4.0/';
const MAX_MANIFEST=64_000, MAX_PAPER=600_000;
const bad=()=>{throw new Error('Не удалось открыть научную статью. Попробуй ещё раз.')};
const ordinary=v=>v&&typeof v==='object'&&!Array.isArray(v);
const str=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
export const isResearchId=v=>typeof v==='string'&&v.length<=90&&/^research-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v);
// No arbitrary outbound URLs in catalog cards: derive from exact journal + DOI.
function sourceUrl(journal,doi) {
  if(journal==='eLife'&&/^10\.7554\/eLife\.\d{5,6}$/.test(doi))return 'https://elifesciences.org/articles/'+doi.split('.').at(-1);
  if(journal==='Journal of Open Source Software'&&/^10\.21105\/joss\.\d{5}$/.test(doi))return 'https://joss.theoj.org/papers/'+doi;
  return '';
}
export function parseResearchCatalog(raw) {
  if(raw?.version!==1||!Array.isArray(raw.papers)||!raw.papers.length||raw.papers.length>64)bad();
  const ids=new Set(),dois=new Set();
  return Object.freeze(raw.papers.map(e=>{
    if(!ordinary(e)||!isResearchId(e.id)||ids.has(e.id)||!str(e.title,240)||!str(e.author,640)||!str(e.topic,64)||
       !str(e.description,260)||!str(e.journal,100)||e.language!=='en'||!str(e.doi,100)||dois.has(e.doi)||
       !e.sourceUrl||sourceUrl(e.journal,e.doi)!==e.sourceUrl||e.licenseUrl!==CC||e.license!=='CC BY 4.0'||
       !str(e.copyright,350)||!Number.isInteger(e.year)||e.year<1650||e.year>2100||
       !Number.isInteger(e.words)||e.words<=0||e.words>100_000||e.asset!=='research/papers/'+e.id+'.json'||
       !Number.isInteger(e.byteLen)||e.byteLen<128||e.byteLen>MAX_PAPER||typeof e.sha256!=='string'||!/^[a-f0-9]{64}$/.test(e.sha256))bad();
    ids.add(e.id);dois.add(e.doi);
    const {id,title,author,topic,year,journal,description,language,doi,sourceUrl:url,license,licenseUrl,words,copyright,asset,byteLen,sha256}=e;
    return Object.freeze({id,title,author,topic,year,journal,description,language,doi,sourceUrl:url,license,licenseUrl,words,copyright,asset,byteLen,sha256});
  }));
}
export function parseResearchBook(raw,e) {
  if(!ordinary(raw)||raw.id!==e.id||raw.title!==e.title||raw.author!==e.author||raw.language!=='en'||
     raw.kind!=='research'||raw.format!=='TXT'||raw.alignment!=='none'||!Array.isArray(raw.chapters)||
     raw.chapters.length<2||raw.chapters.length>64)bad();
  let count=0,size=0;
  const chapters=raw.chapters.map(c=>{
    if(!ordinary(c)||!str(c.title,350)||!Array.isArray(c.paragraphs)||!c.paragraphs.length)bad();
    return {title:c.title,paragraphs:c.paragraphs.map(p=>{
      if(!ordinary(p)||p.translation!==null||!str(p.text,24_000)||++count>5000||(size+=p.text.length)>450_000)bad();
      return {text:p.text,translation:null};
    })};
  });
  const credit=chapters.at(-1),t=credit.paragraphs.map(p=>p.text).join('\n');
  if(credit.title!=='Source and license'||![e.sourceUrl,e.doi,e.licenseUrl,e.copyright,e.author].every(v=>t.includes(v)))bad();
  return {id:e.id,title:e.title,author:e.author,language:'en',format:'TXT',alignment:'none',kind:'research',createdAt:0,chapters,
    edition:{source:e.journal,sourceUrl:e.sourceUrl,license:e.license,licenseUrl:e.licenseUrl,doi:e.doi,publicationYear:e.year,copyright:e.copyright}};
}
async function readBytes(fetcher,path,limit,timeout){
  const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeout);
  try{
    const res=await fetcher(new URL(path,import.meta.url),{mode:'same-origin',credentials:'same-origin',redirect:'error',signal:ac.signal});
    if(!res.ok||!res.body?.getReader)bad();
    const reader=res.body.getReader(),chunks=[];let total=0;
    try{
      if(Number(res.headers?.get('content-length'))>limit)bad();
      for(;;){
        const {value,done}=await reader.read();if(done)break;
        if((total+=value.byteLength)>limit)bad();
        chunks.push(value);
      }
    }catch(e){ac.abort();void reader.cancel().catch(()=>{});throw e}
    finally{reader.releaseLock()}
    const bytes=new Uint8Array(total);let pos=0;
    for(const chunk of chunks){bytes.set(chunk,pos);pos+=chunk.byteLength}
    return bytes;
  }finally{clearTimeout(timer)}
}
const json=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
const hex=digest=>Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
export function createResearchSource({fetcher=globalThis.fetch,digest=b=>globalThis.crypto.subtle.digest('SHA-256',b)}={}){
  let catalog=null;
  const pending=new Map();
  const loadCatalog=()=>catalog??=(readBytes(fetcher,'research/manifest.json',MAX_MANIFEST,12_000).then(b=>parseResearchCatalog(json(b))).catch(e=>{catalog=null;throw e}));
  async function loadBook(id){
    if(!isResearchId(id))bad();
    if(!pending.has(id)){
      const work=(async()=>{
        const row=(await loadCatalog()).find(x=>x.id===id);if(!row)bad();
        const bytes=await readBytes(fetcher,row.asset,row.byteLen,16_000);
        if(bytes.length!==row.byteLen||hex(await digest(bytes))!==row.sha256)bad();
        return parseResearchBook(json(bytes),row);
      })();
      pending.set(id,work.finally(()=>pending.delete(id)));
    }
    return pending.get(id);
  }
  return {loadCatalog,loadBook};
}
