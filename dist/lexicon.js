import {zip} from './importers.js';
import {commonEnglishBaseForms,commonEnglishHomograph,commonEnglishVerb} from './english-verbs.js';
import {dictionary as builtIn} from './data.js';
import {recommendedPacks} from './packs/catalog.js';
export {recommendedPacks};

export const freedictDownloadUrl = 'https://freedict.org/downloads/';
const curatedPacks = [
  {id:'folio-en-ru', title:'Folio · Английский → русский', description:'Учебные слова, техническая лексика и выражения.',language:'en',target:'ru',source:'Folio',license:'Оригинальные материалы Folio'},
  {id:'folio-en-en', title:'Folio · Толковый английский',description:'Короткие определения и примеры на английском.',language:'en',target:'en',source:'Folio',license:'Оригинальные материалы Folio'},
  {id:'folio-ru-en', title:'Folio · Русский → английский',description:'Обратный поиск по учебным и техническим словам.',language:'ru',target:'en',source:'Folio',license:'Оригинальные материалы Folio'}
].map(p=>({...p,version:'1',bytes:8952}));
export const dictionaryPacks = [...recommendedPacks,...curatedPacks];
export const externalDictionaryPacks = [
  ['ru','русский'],['de','немецкий'],['fr','французский'],['es','испанский']
].map(([target,label])=>({id:'wikdict-en-'+target,title:'WikDict · Английский → '+label,language:'en',target,source:'Wiktionary via DBnary · WikDict',license:'CC BY-SA 4.0',url:'https://download.wikdict.com/dictionaries/stardict/wikdict-en-'+target+'.zip'}));
const normalize = (s,lang) => String(s||'').normalize('NFKC').toLocaleLowerCase(lang==='ru'?'ru':'en').replace(/\u0301/g,m=>lang==='ru'?'':m).replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const clean = (s,n) => String(s||'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').trim().slice(0,n);
const MB=1024*1024, stageKey=id=>['@install',id];
const rangeFor=id=>IDBKeyRange.bound([id],[id,[]],false,true);
let opening;
function db(){
  if(!opening) opening=new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB) return reject(new Error('Браузер не поддерживает локальное хранилище словарей.'));
    // Keep the v1 stores: existing imports need no rebuild or deletion, nor do other open reader tabs block an upgrade.
    const req=indexedDB.open('folio-lexicon',1);let blocked=false;
    req.onupgradeneeded=()=>{
      req.result.createObjectStore('packs',{keyPath:'id'});
      req.result.createObjectStore('words',{keyPath:['id','key']});
    };
    req.onsuccess=()=>{const d=req.result;if(blocked){d.close();return}
      d.onversionchange=()=>{d.close();opening=null};d.onclose=()=>{opening=null};resolve(d)};
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>{blocked=true;reject(new Error('Закройте другие вкладки Folio и попробуйте снова.'))};
  }).catch(e=>{opening=null;throw e});
  return opening;
}
const request = req => new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
export async function getInstalledDictionaries(){
  const d=await db();return request(d.transaction('packs').objectStore('packs').getAll());
}
// Each callback schedules its dependent IDB requests synchronously from an IDB event. No fetch/hash/timer
// runs inside a transaction (including Safari). Success means COMMITTED, never merely "requests enqueued".
async function mutate(body,signal){
  const d=await db();checkSignal(signal);
  return new Promise((resolve,reject)=>{
    const tx=d.transaction(['packs','words'],'readwrite'), packs=tx.objectStore('packs'),words=tx.objectStore('words');
    let result,failure;
    const fail=e=>{failure=e;try{tx.abort()}catch{}};
    const safely=fn=>value=>{try{fn(value)}catch(e){fail(e)}};
    const read=(req,fn)=>{req.onsuccess=safely(()=>fn(req.result))};
    const canceled=()=>fail(new DOMException('Установка отменена.','AbortError'));
    signal?.addEventListener('abort',canceled,{once:true});
    tx.oncomplete=()=>{signal?.removeEventListener('abort',canceled);resolve(result)};
    tx.onabort=()=>{signal?.removeEventListener('abort',canceled);reject(failure||tx.error||new Error('Не удалось сохранить словарь.'))};
    safely(()=>body({packs,words,read,answer:value=>{result=value},fail}))();
  });
}
function checkSignal(signal){if(signal?.aborted)throw new DOMException('Установка отменена.','AbortError')}
function formatError(){return new Error('Данные словаря повреждены или не соответствуют указанной версии.')}
function asInstallError(e){
  if(e?.name==='QuotaExceededError')return new Error('Недостаточно места для словаря. Освободите место и повторите установку.');
  if(e?.name==='SecurityError'||e?.name==='InvalidStateError')return new Error('Локальное хранилище недоступно. Проверьте настройки браузера.');
  return e;
}
const generation=()=> '@index:'+crypto.randomUUID();
// One staging slot per logical pack, never added to the public catalogue. The latest retry can reclaim a
// crashed tab's partial data immediately. A displaced writer cannot append to or publish another run.
function begin(meta,token){
  return mutate(({packs,words,read,answer})=>read(packs.get(meta.id),active=>{
    if(active?.generation&&meta.manifestSha256&&active.manifestSha256===meta.manifestSha256&&active.version===meta.version){answer(active);return}
    read(words.get(stageKey(meta.id)),old=>{
      if(old)words.delete(rangeFor(old.token));
      words.put({id:'@install',key:meta.id,token});
    });
  }));
}
function withStage(id,token,fn,signal){
  return mutate(ctx=>ctx.read(ctx.words.get(stageKey(id)),stage=>{
    if(stage?.token!==token)throw new Error('Установка была заменена или отменена в другой вкладке.');
    fn(ctx);
  }),signal);
}
function discard(id,token){
  return mutate(({words,read})=>read(words.get(stageKey(id)),stage=>{
    if(stage?.token===token){words.delete(rangeFor(token));words.delete(stageKey(id))}
  }));
}
function publish(meta,token,signal){
  return withStage(meta.id,token,({packs,words,read,answer})=>read(packs.get(meta.id),old=>{
    const installed={...meta,generation:token};
    packs.put(installed);words.delete(stageKey(meta.id));
    if(old)words.delete(rangeFor(old.generation||old.id));answer(installed);
  }),signal);
}
export async function removeDictionary(id){
  if(typeof id!=='string'||id.startsWith('@'))throw new Error('Неизвестный словарь.');
  return mutate(({packs,words,read})=>{
    read(words.get(stageKey(id)),stage=>{if(stage){words.delete(rangeFor(stage.token));words.delete(stageKey(id))}});
    read(packs.get(id),old=>{if(old){words.delete(rangeFor(old.generation||id));packs.delete(id)}});
  });
}
// Rows are already globally sorted by normalized key. One range seek + binary search reads a small page,
// not a dictionary-sized blob. Keep the number of IDB requests low on both low-end phones and desktops.
const BLOCK_KEYS=48,BLOCK_CHARS=18_000;
function rowCost(row){let n=32+row[0].length;for(const sense of row[1]){n+=16;for(const v of sense)n+=(v?.length||0)+4}return n}
function writeRows(id,token,rows){
  return withStage(id,token,({words})=>{
    let page=[],chars=0;
    const flush=()=>{if(page.length)words.add({id:token,key:page[0][0],rows:page,chars});page=[];chars=0};
    for(const row of rows){
      const cost=rowCost(row);
      if(page.length>=BLOCK_KEYS||chars+cost>BLOCK_CHARS)flush();
      page.push(row);chars+=cost;
    }
    flush();
  });
}
const tuple=(head,e)=>[head,e.translation||'',e.definition||'',e.pos||'',e.example||'',e.pronunciation||'',e.source||''];
async function saveRows(meta,rows,{signal,onProgress}={}){
  // Legacy file formats require whole-file parsing, but their local index is now written in bounded batches.
  // Preserve even ambiguous aliases (e.g. saw -> see AND saw); never give a sense another entry's lemma.
  const words=new Map(),heads=new Set();
  for(const [raw,e,forms=[]] of rows){
    const headword=clean(raw,120),key=normalize(headword,meta.language);if(!key)continue;
    heads.add(key);const sense=tuple(headword,e),keys=new Set([key,...forms.map(s=>normalize(clean(s,120),meta.language)).filter(Boolean)]);
    for(const k of keys){
      let senses=words.get(k);if(!senses)words.set(k,senses=[]);
      if(!senses.some(s=>s.length===sense.length&&s.every((v,i)=>v===sense[i])))senses.push(sense);
    }
    if(heads.size>150000||words.size>250000)throw new Error('Словарь слишком велик для установки.');
  }
  if(!heads.size)throw new Error('В файле не найдено словарных статей.');
  const pack={...meta,count:heads.size},token=generation();
  try{
    checkSignal(signal);await begin(pack,token);const keys=[...words.keys()].sort();
    const total=Math.ceil(keys.length/512), progress=(phase,completed)=>{try{onProgress?.({phase,completed,total,bytes:meta.bytes||0,totalBytes:meta.bytes||0})}catch{}};
    for(let i=0;i<keys.length;i+=512){progress('index',i/512);checkSignal(signal);await writeRows(pack.id,token,keys.slice(i,i+512).map(k=>[k,words.get(k)]))}
    checkSignal(signal);const installed=await publish(pack,token,signal);progress('ready',total);return installed;
  }catch(e){await discard(pack.id,token).catch(()=>{});throw asInstallError(e)}
}
const hex64=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const natural=(n,max)=>Number.isSafeInteger(n)&&n>0&&n<=max;
const packRoot=new URL('./packs/',import.meta.url);
function assetURL(file,base){
  if(typeof file!=='string'||file.includes('\\')||file.includes('%')||file.split('/').includes('..'))throw formatError();
  const u=new URL(file,base);if(u.origin!==packRoot.origin||!u.href.startsWith(packRoot.href)||u.search||u.hash||u.username||u.password)throw formatError();
  return u;
}
async function verifiedJSON(url,digest,expected,limit,signal){
  if(!hex64(digest)||!globalThis.crypto?.subtle)throw new Error('Не удалось проверить подлинность словаря. Откройте Folio через HTTPS.');
  const response=await fetch(url,{signal,mode:'same-origin',credentials:'same-origin',redirect:'error'});
  if(!response.ok||!response.body)throw new Error('Не удалось загрузить словарь. Проверьте соединение и попробуйте снова.');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{
    for(;;){checkSignal(signal);const {done,value}=await reader.read();if(done)break;
      length+=value.length;if(length>(expected||limit)||length>limit){await reader.cancel();throw formatError()}chunks.push(value);
    }
  }finally{reader.releaseLock()}
  if(!length||(expected&&length!==expected))throw formatError();
  const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==digest)throw formatError();
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw formatError()}
}
function verifyManifest(m,meta,url){
  if(m?.format!==1||m.id!==meta.id||m.version!==meta.version||m.count!==meta.count||
    !natural(m.count,5_000_000)||!natural(m.keys,8_000_000)||m.keys<m.count||
    !Array.isArray(m.shards)||!natural(m.shards.length,4096))throw formatError();
  const filenames=new Set();let keys=0,bytes=0;
  for(const s of m.shards){
    if(!s||!hex64(s.sha256)||!natural(s.keys,100_000)||!natural(s.bytes,2*MB)||
      typeof s.file!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(s.file)||filenames.has(s.file))throw formatError();
    assetURL(s.file,url);filenames.add(s.file);keys+=s.keys;bytes+=s.bytes;
  }
  if(keys!==m.keys||bytes!==meta.bytes||bytes>512*MB)throw formatError();
}
function verifyShard(rows,s,previous,language){
  if(!Array.isArray(rows)||rows.length!==s.keys)throw formatError();
  let heads=0;
  for(const row of rows){
    if(!Array.isArray(row)||row.length!==2)throw formatError();const [key,senses]=row;
    if(typeof key!=='string'||!key||key<=previous||normalize(key,language)!==key||!Array.isArray(senses)||!senses.length)throw formatError();
    let exact=false;
    for(const v of senses){
      if(!Array.isArray(v)||v.length<2||v.length>6||v.some(f=>typeof f!=='string')||
        !v[0].trim()||!(v[1]?.trim()||v[2]?.trim()))throw formatError();
      if(normalize(v[0],language)===key)exact=true;
    }
    if(exact)heads++;previous=key;
  }
  return {last:previous,heads};
}
async function installRecommended(meta,{onProgress,signal}){
  checkSignal(signal);const token=generation();let completed=0,total=0,bytes=0;
  const update=phase=>{if(onProgress)try{onProgress({phase,completed,total,bytes,totalBytes:meta.bytes})}catch{}};
  try{
    const active=await begin(meta,token);if(active){bytes=meta.bytes;update('ready');return active}
    update('download');const url=assetURL(meta.manifest,import.meta.url);
    const m=await verifiedJSON(url,meta.manifestSha256,0,2*MB,signal);verifyManifest(m,meta,url);
    total=m.shards.length;let last='',count=0;
    for(const s of m.shards){
      checkSignal(signal);update('download');
      const rows=await verifiedJSON(assetURL(s.file,url),s.sha256,s.bytes,2*MB,signal);
      const checked=verifyShard(rows,s,last,meta.language);last=checked.last;count+=checked.heads;bytes+=s.bytes;
      checkSignal(signal);update('index');checkSignal(signal);await writeRows(meta.id,token,rows);completed++;
    }
    if(count!==m.count)throw formatError();
    checkSignal(signal);const pack=await publish({...meta,...(typeof m.notice==='string'?{notice:m.notice}:{})},token,signal);update('ready');return pack;
  }catch(e){await discard(meta.id,token).catch(()=>{});throw asInstallError(e)}
}
export async function installDictionary(id,options={}){
  const meta=dictionaryPacks.find(p=>p.id===id);if(!meta)throw new Error('Неизвестный словарь.');
  if(meta.manifest)return installRecommended(meta,options);
  checkSignal(options.signal);const existing=(await getInstalledDictionaries()).find(p=>p.id===id&&p.version===meta.version);
  if(existing){try{options.onProgress?.({phase:'ready',completed:1,total:1,bytes:meta.bytes,totalBytes:meta.bytes})}catch{}return existing}
  try{options.onProgress?.({phase:'download',completed:0,total:1,bytes:0,totalBytes:meta.bytes})}catch{}
  const response=await fetch(new URL('./lexicon/curated.json',import.meta.url),{signal:options.signal,mode:'same-origin',redirect:'error'});
  if(!response.ok)throw new Error('Для загрузки словаря нужно подключение.');
  const data=await response.json(),rows=[];
  for(const [head,senses] of Object.entries(data))for(const [pos,translation,definition,aliases,example] of senses){
    if(meta.language==='ru'){for(const t of translation.split(';'))rows.push([t,{translation:head,definition,pos,example,source:'Folio'}])}
    else rows.push([head,{...(meta.target==='ru'?{translation}:{}),definition,pos,example,source:'Folio'},aliases?aliases.split(','):[]]);
  }
  checkSignal(options.signal);return saveRows(meta,rows,options);
}
const importMeta=(name,language,target,source)=>({id:'local-'+crypto.randomUUID(),title:clean(name,100)||'Личный словарь',language,target,source});
export async function importDictionaryTsv(text,{language='en',target='ru',name}={}){
  if(typeof text!=='string'||text.length>30_000_000) throw new Error('Файл должен быть TSV размером до 30 млн символов.');
  const meta=importMeta(name,language,target,'Личный TSV');
  const rows=[];
  for (const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)){
    if(!line.trim()||line.startsWith('#')) continue;
    const [word,t,d,p,a,e,pron] = line.split('\t');
    if(!word?.trim() || !(t?.trim()||d?.trim())) continue;
    if(/^(word|headword)$/i.test(word)&&/^translation$/i.test(t)) continue;
    rows.push([word,{translation:clean(t,1200),definition:clean(d,1200),pos:clean(p,40),example:clean(e,500),pronunciation:clean(pron,80),source:meta.source},(a||'').split(',').slice(0,32)]);
    if(rows.length>180000) throw new Error('Слишком много строк в TSV.');
  }
  return saveRows(meta,rows);
}
export async function importFreeDictTei(text,{language='en',target='ru',name}={}){
  if(typeof text!=='string'||text.length>45_000_000) throw new Error('Файл TEI слишком велик.');
  if(/<!ENTITY/i.test(text)) throw new Error('В этом файле TEI есть неподдерживаемые объявления.');
  const xml=new DOMParser().parseFromString(text.replace(/<!DOCTYPE[^>]*>/i,''),'application/xml');
  if(xml.querySelector('parsererror')||xml.documentElement.localName!=='TEI') throw new Error('Выберите словарь FreeDict .tei или .xml.');
  const meta=importMeta(name,language,target,'FreeDict · файл пользователя');
  const entries=xml.getElementsByTagNameNS('*','entry');
  if(entries.length>150000) throw new Error('Слишком много словарных статей.');
  const rows=[];
  for(const node of entries){
    const get=(n,t)=>Array.from(n.getElementsByTagNameNS('*',t));
    const [main,...alt]=get(node,'orth').map(x=>clean(x.textContent,120)).filter(Boolean);
    const pos=clean(get(node,'pos')[0]?.textContent,40);
    for(const sense of get(node,'sense').slice(0,12)){
      const translation=get(sense,'cit').filter(c=>['trans','translation'].includes(c.getAttribute('type'))).flatMap(c=>get(c,'quote').map(q=>clean(q.textContent,240))).filter(Boolean).join('; ').slice(0,1200);
      const definition=clean(get(sense,'def')[0]?.textContent,1200);
      if(main&&(translation||definition)) rows.push([main,{translation,definition,pos,source:meta.source},alt.slice(0,32)]);
    }
  }
  return saveRows(meta,rows);
}
// The only inferred forms are deterministic and local. Mark them as guesses; never give them the rank
// of a publisher's headword/alias. No English rules are run on Russian or other languages.
function candidates(w,lang){
  if(lang!=='en'||w.includes(' '))return [];
  const s=new Set();
  if(w.endsWith("'s"))s.add(w.slice(0,-2));
  if(w.length>=5&&w.endsWith('ies'))s.add(w.slice(0,-3)+'y');
  if(w.length>=5&&/(?:sh|ch|ss|x|z)es$/.test(w))s.add(w.slice(0,-2));
  if(w.length>=4&&w.endsWith('s')&&!/(ss|us|is)$/.test(w))s.add(w.slice(0,-1));
  if(w.length>=5&&w.endsWith('es'))s.add(w.slice(0,-2));
  for(const suffix of ['ing','ed'])if(w.length>=suffix.length+2&&w.endsWith(suffix)){
    const b=w.slice(0,-suffix.length);
    if(b.endsWith('i')&&suffix==='ed')s.add(b.slice(0,-1)+'y');
    if(b.length>2&&b.at(-1)===b.at(-2)&&/[bdfgklmnprstz]$/.test(b))s.add(b.slice(0,-1));
    s.add(b);s.add(b+'e');
  }
  s.delete(w);return [...s];
}
const hot=[];let hotChars=0; // bounded LRU of immutable blocks, not a whole-dictionary or stale result cache
function rememberBlock(b){
  if(!b||b.chars>64_000)return;
  const existing=hot.findIndex(v=>v.id===b.id&&v.key===b.key);
  if(existing>=0){const [same]=hot.splice(existing,1);hot.unshift(same);return}
  hot.unshift(b);hotChars+=b.chars;
  while(hot.length>40||hotChars>400_000)hotChars-=hot.pop().chars;
}
function cachedBlock(id,k){
  const i=hot.findIndex(b=>b.id===id&&b.key<=k&&k<=b.rows[b.rows.length-1][0]);
  if(i<0)return null;const [match]=hot.splice(i,1);hot.unshift(match);return match;
}
function searchBlock(b,k){
  if(!b)return null;let lo=0,hi=b.rows.length-1;
  while(lo<=hi){const mid=(lo+hi)>>>1,[word,senses]=b.rows[mid];if(word===k)return senses;if(word<k)lo=mid+1;else hi=mid-1}
  return null;
}
function readWord(store,pack,k){
  if(!pack.generation){ // read older installations in place: no new upload required
    return request(store.get([pack.id,k])).then(record=>record?.entries.map(e=>tuple(record.headword,e))||null);
  }
  const cached=cachedBlock(pack.generation,k);if(cached)return Promise.resolve(searchBlock(cached,k));
  const range=IDBKeyRange.bound([pack.generation],[pack.generation,k]);
  return request(store.openCursor(range,'prev')).then(c=>{const b=c?.value;rememberBlock(b);return searchBlock(b,k)});
}
const baseTitle='Базовый словарь Folio';
function basePack(target){return {id:'builtin-en-'+target,title:baseTitle,source:baseTitle,language:'en',target}}
function compatible(p,{language,target,packId}){return p.language===language&&(!packId||p.id===packId)&&(p.target===target||(!packId&&p.target===language))}
function lookupPass(keys,opts){
  const singles=[];
  if(opts.language==='en'){
    const pack=basePack(opts.target==='ru'?'ru':'en');
    if(compatible(pack,opts))for(const key of keys){
      const values=[];
      if(Object.hasOwn(builtIn,key)){
        const [t,pos,d,ipa,ex]=builtIn[key];values.push([key,pack.target==='ru'?t:'',d,pos,ex,ipa]);
      }
      const verb=commonEnglishVerb(key), homograph=commonEnglishHomograph(key);
      if(verb)values.push([key,pack.target==='ru'?verb.ru:'',verb.en,'verb']);
      if(homograph){
        const [ru,en,pos]=homograph;values.push([key,pack.target==='ru'?ru:'',en,pos]);
      }
      if(values.length)singles.push({key,pack,values});
    }
  }
  return db().then(d=>new Promise((resolve,reject)=>{
    const tx=d.transaction(['packs','words'],'readonly'),store=tx.objectStore('words');
    // Catalogue snapshot and index seeks use ONE transaction: a simultaneous new version cannot invalidate
    // the generation between getAll() and the word reads. Hot pages include the unique generation ID.
    const req=tx.objectStore('packs').getAll();
    req.onerror=()=>reject(req.error);tx.onabort=()=>reject(tx.error||new Error('Не удалось прочесть словари.'));
    req.onsuccess=()=>{
      try{
        const packs=req.result.filter(p=>compatible(p,opts));
        const jobs=keys.flatMap(key=>packs.map(pack=>readWord(store,pack,key).then(values=>values?{key,pack,values}:null)));
        Promise.all(jobs).then(found=>resolve({hits:[...found.filter(Boolean),...singles]}),reject);
      }catch(e){reject(e)}
    };
  })).catch(error=>({hits:singles,error}));
}
const knownPos=new Set(['noun','verb','adjective','adverb','preposition','pronoun','conjunction','interjection','determiner','numeral','particle']);
const canonicalPos=s=>{const p=String(s||'').toLowerCase().replace(/\.$/,'').trim(),label=({n:'noun',v:'verb',adj:'adjective',adv:'adverb','proper noun':'noun'})[p]||p;return knownPos.has(label)?label:''};
const infoOf=(pack,source)=>({packId:pack.id,title:pack.title,source:source||pack.source,target:pack.target});
const senseKey=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\u0301/g,'').replace(/\s+/g,' ').trim();
// A publisher's first monolingual sense can help order a bilingual entry's several glosses. This is a
// lexical tie-break only, not a sentence translation. No query corpus, online service or hardcoded words.
const glossStop=new Set('a an as at be by for from in into is it of on or the this to with that who which and also especially one something some used'.split(' '));
const glossTerms=text=>new Set((text.toLowerCase().replace(/^\s*\([^)]*\)\s*/,'').match(/[a-z]+/g)||[]).filter(w=>!glossStop.has(w)));
function ranked(entries,opts){
  const reference=new Map();
  if(opts.language==='en'&&opts.target!=='en'){
    for(const e of entries)if(e.target==='en'&&e.definition&&!e.translation){
      const k=normalize(e.headword,'en'),old=reference.get(k),priority=(e.matchType==='inferred'?2:0)+(recommendedPacks.some(m=>m.id===e.packId)?0:1);
      if(!old||priority<old.priority)reference.set(k,{priority,tokens:glossTerms(e.definition),pos:canonicalPos(e.pos)});
    }
  }
  const affinity=e=>{
    const ref=reference.get(normalize(e.headword,'en'));if(!e.translation||!ref)return 0;
    const terms=glossTerms(e.definition);let common=0;for(const w of ref.tokens)if(terms.has(w))common++;
    // Don't make length itself a ranking signal; on equal overlaps retain publisher order.
    return common*4+(ref.pos&&ref.pos===canonicalPos(e.pos)?1:0);
  };
  const rank=e=>[
    e.matchType==='inferred'?1:0,
    e.target===opts.target&&(opts.target===opts.language||e.translation)?0:1,
    e.matchType==='exact'?0:1,
    e.packId===opts.preferredPackId?0:1,
    e.packId.startsWith('local-')?0:e.packId.startsWith('builtin-')?3:recommendedPacks.some(m=>m.id===e.packId)?1:2,
    -affinity(e),e.order
  ];
  const sorted=entries.map(e=>[rank(e),e]).sort(([a],[b])=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0});
  const accepted=[],groups=new Map();
  for(const [,e] of sorted){
    const key=JSON.stringify([e.target,senseKey(e.headword),e.translation?'t':'d',senseKey(e.translation||e.definition)]);
    let similar=groups.get(key);if(!similar)groups.set(key,similar=[]);
    const same=similar.find(other=>(!other.pos||!e.pos||senseKey(other.pos)===senseKey(e.pos))&&(!other.definition||!e.definition||senseKey(other.definition)===senseKey(e.definition)));
    if(!same){delete e.order;accepted.push(e);similar.push(e);continue}
    // Identical gloss, compatible sense. Keep independent evidence and every distinct sense, without
    // repeating a line simply because the same article occurs in two sources.
    for(const source of e.sources)if(!same.sources.some(s=>s.packId===source.packId&&s.source===source.source&&s.example===source.example&&s.pronunciation===source.pronunciation))same.sources.push(source);
    for(const k of ['definition','example','pos','pronunciation'])if(!same[k]&&e[k])same[k]=e[k];
  }
  return accepted;
}
export async function lookupWord(word,{language='en',target='ru',packId,preferredPackId}={}){
  language=String(language).toLowerCase().split(/[-_]/)[0];target=String(target).toLowerCase().split(/[-_]/)[0];
  const key=normalize(word,language),opts={language,target,packId,preferredPackId};
  if(!key||key.length>240)return null;
  const direct=await lookupPass([key],opts),out=[],lemmas=new Map();
  function collect(hits,method){
    for(const {key:probe,pack,values} of hits)for(const [headword,translation='',definition='',pos='',example='',pronunciation='',origin=''] of values){
      const head=normalize(headword,language);
      // Do not recursively follow alias -> alias or give an unrelated canonical head a verified relation.
      const part=canonicalPos(pos),attested=lemmas.get(probe);
      if(method==='lemma'&&(head!==probe||(part&&!attested.has('')&&!attested.has(part))))continue;
      const matchType=method==='guess'?'inferred':method==='direct'&&head===key?'exact':'alias';
      const source=origin||pack.source,evidence=infoOf(pack,source);
      if(method==='direct'&&head!==key&&head.length<=240){
        let parts=lemmas.get(head);if(!parts)lemmas.set(head,parts=new Map());
        if(!parts.has(part))parts.set(part,evidence);
      }
      out.push({headword,translation,definition,pos,example,pronunciation,source,packId:pack.id,packTitle:pack.title,target:pack.target,matchType,
        ...(method==='lemma'?{lemmaSource:attested.get(part)||attested.get('')||attested.values().next().value}:{}),
        sources:[{...evidence,headword,translation,definition,pos,example,pronunciation}],order:out.length});
    }
  }
  collect(direct.hits,'direct');
  if(language==='en')for(const head of commonEnglishBaseForms(key)){
    // A local editorial alias only permits the verb sense. Exact entries and
    // evidence from installed dictionaries remain intact and rank normally.
    let parts=lemmas.get(head);
    if(!parts)lemmas.set(head,parts=new Map());
    if(!parts.has('verb')&&!parts.has(''))parts.set('verb',{packId:'builtin-en-forms',title:'Формы глаголов Folio',source:'Формы глаголов Folio',target:'en'});
  }
  // A dictionary-attested irregular form also unlocks translations in a different installed dictionary.
  // Limit secondary seeks for adversarial imports; all the attested senses themselves stay visible.
  if(lemmas.size){const pass=await lookupPass([...lemmas.keys()].slice(0,12),opts);collect(pass.hits,'lemma')}
  if(!out.some(e=>e.target===target&&(language===target||e.translation))){
    const guesses=candidates(key,language).filter(k=>!lemmas.has(k));
    if(guesses.length)collect((await lookupPass(guesses,opts)).hits,'guess');
  }
  if(!out.length){if(direct.error)throw direct.error;return null}
  const entries=ranked(out,opts),first=entries[0],sources=[];
  for(const e of entries)for(const s of e.sources)if(!sources.some(p=>s.packId===p.packId&&p.source===s.source))sources.push({packId:s.packId,title:s.title,source:s.source,target:s.target});
  return {headword:first.headword,entries,sources,matchType:first.matchType,...(first.matchType!=='exact'?{matchedForm:key}:{})};
}


async function inflateDict(bytes){
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks=[]; let length=0;
  for(;;){
    const {value,done}=await reader.read(); if(done)break;
    length+=value.length;
    if(length>60*MB){await reader.cancel();throw new Error('Несжатый словарь больше 60 МБ.');}
    chunks.push(value);
  }
  const out=new Uint8Array(length); let at=0;
  for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}
  return out;
}
export async function parseStarDict(buffer,{language='en',target='ru',name,packId}={}){
  if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<22||buffer.byteLength>45*MB) throw new Error('Выберите ZIP StarDict размером до 45 МБ.');
  const archive=zip(buffer,{maxDocument:60*MB,maxTotal:75*MB}), paths=archive.names();
  const files=paths.filter(n=>/\.ifo$/i.test(n) && !n.startsWith('__MACOSX/'));
  if(files.length!==1) throw new Error('В ZIP должен быть один словарь StarDict (.ifo, .idx, .dict или .dict.dz).');
  const ifo=files[0], base=ifo.slice(0,-4);
  const find=suffix=>paths.find(n=>n.toLowerCase()===(base+suffix).toLowerCase());
  const idx=find('.idx'), raw=find('.dict'), compressed=find('.dict.dz');
  if(!idx||(!raw&&!compressed)) throw new Error('В ZIP нет индекса или данных StarDict.');
  const decode=new TextDecoder('utf-8',{fatal:true});
  const settings=Object.fromEntries((await archive.read(ifo)).split(/\r?\n/).slice(1).map(l=>{const i=l.indexOf('=');return i<0?['','']:[l.slice(0,i),l.slice(i+1)];}));
  const count=Number(settings.wordcount), type=settings.sametypesequence;
  if(!Number.isSafeInteger(count)||count<1||count>150000||settings.idxoffsetbits==='64'||(type&&!['m','h','x','g'].includes(type))) throw new Error('Неподдерживаемый формат StarDict.');
  const indexBytes=await archive.read(idx,{binary:true});
  if(Number(settings.idxfilesize)!==indexBytes.length) throw new Error('Индекс StarDict повреждён.');
  const dictBytes=raw ? await archive.read(raw,{binary:true}) : await inflateDict(await archive.read(compressed,{binary:true}));
  const index=new DataView(indexBytes.buffer,indexBytes.byteOffset,indexBytes.byteLength);
  const official=externalDictionaryPacks.find(p=>p.id===packId && p.language===language && p.target===target);
  const meta=importMeta(name||settings.bookname||official?.title,language,target,official ? official.source : 'Личный StarDict');
  if(official) {meta.license=official.license;meta.url=official.url;}
  const rows=[];let cursor=0;
  for(let i=0;i<count;i++){
    const stop=indexBytes.indexOf(0,cursor);
    if(stop<=cursor||stop-cursor>600||stop+9>indexBytes.length)throw new Error('Повреждённая запись индекса StarDict.');
    const word=decode.decode(indexBytes.subarray(cursor,stop));
    const offset=index.getUint32(stop+1), size=index.getUint32(stop+5);
    cursor=stop+9;
    if(offset+size>dictBytes.length || size>512*1024)throw new Error('Неверное смещение или размер статьи StarDict.');
    let content=dictBytes.subarray(offset,offset+size);
    const entryType=type||String.fromCharCode(content[0]);
    if(!type)content=content.subarray(1);
    if(!['m','h','x','g'].includes(entryType))continue;
    let definition=decode.decode(content);
    if(entryType!=='m'){
      // Render no imported markup. Strip active content first; decode common entities into inert text.
      definition=definition.replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<[^>]*>/g,' ').replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g,(_,key)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ','#39':"'"})[key]);
    }
    definition=clean(definition.replace(/\s+/g,' '),1200);
    if(definition) rows.push([word,{[target===language?'definition':'translation']:definition,source:meta.source}]);
  }
  if(cursor!==indexBytes.length||!rows.length) throw new Error('Индекс StarDict повреждён или словарь пуст.');
  return {meta,rows};
}
export async function importStarDictZip(buffer,options){
  const {meta,rows}=await parseStarDict(buffer,options);
  return saveRows(meta,rows);
}
