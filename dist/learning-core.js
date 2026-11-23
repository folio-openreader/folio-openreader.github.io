// Local-only learning evidence. Mutators change records owned by loadLearning; no I/O,
// passage text, glosses, guessed lemmas, skipped-page inference or passive mastery.
export const LEARNING_LIMITS = Object.freeze({words:20000, perWord:256, tokens:40000});
const DAY=86400000, RETRY=600000, MAX_DATE=8.64e15, WAIT=[0,DAY,3*DAY,14*DAY];
const wordPattern=/^[\p{L}][\p{L}\p{M}]*(?:['-][\p{L}][\p{L}\p{M}]*)*$/u;
const sourcePattern=/^[a-z0-9][a-z0-9_-]{0,63}$/i;
const bag=()=>Object.create(null), owners=new WeakMap(), sizes=new WeakMap();
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const isObj=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const integer=(x,max)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
const time=(n,fallback=0)=>integer(n,MAX_DATE)?n:fallback;
const safeNext=(n,delay)=>Math.min(MAX_DATE,n+delay);

const languages=new Map();
function languageId(input){
  if(typeof input!=='string'||input.length>40||!input.trim())return 'und';
  if(languages.has(input))return languages.get(input);
  let out='und';
  try{const l=new Intl.Locale(input.trim());out=(l.language||'und')+(l.script?'-'+l.script:'')}catch{}
  if(languages.size<256)languages.set(input,out);
  return out;
}
export function normalizeWord(text,language='und'){
  if(typeof text!=='string'||text.length>256)return '';
  // Preserve accents, ё, scripts and inflections. Only typographic variants of
  // apostrophe/hyphen are equivalent. En/em dashes are punctuation, not hyphens.
  const s=text.normalize('NFC').replace(/[‘’ʼ]/gu,"'").replace(/[‐‑]/gu,'-')
    .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu,'');
  if(!s||s.length>128||!wordPattern.test(s))return '';
  return s.toLocaleLowerCase(languageId(language)).normalize('NFC');
}
export function wordKey(text,language){const lang=languageId(language),w=normalizeWord(text,lang);return w?lang+':'+w:''}
export function getWord(state,text,lang){return state?.words?.[wordKey(text,lang)]||null}
export function trackWord(state,text,lang,now=Date.now()){
  const language=languageId(lang),word=normalizeWord(text,language),key=language+':'+word;
  if(!word||!sizes.has(state))return null;
  if(own(state.words,key))return state.words[key];
  const size=sizes.get(state);if(size.words>=LEARNING_LIMITS.words)return null;
  const createdAt=time(now);
  const r={key,word,language,createdAt,wins:0,manual:false,lapsed:false,lastActionAt:0,nextReviewAt:createdAt,seen:bag()};
  state.words[key]=r;size.words++;owners.set(r,{size,tokens:0,passages:0});return r;
}
function detach(state,text,lang){
  const r=getWord(state,text,lang),meta=owners.get(r);
  if(!meta||sizes.get(state)!==meta.size)return null;
  meta.size.words--;meta.size.tokens-=meta.tokens;owners.delete(r);delete state.words[r.key];return {r,meta};
}
export function removeWord(state,text,lang){return !!detach(state,text,lang)}
// Reversible within the current word card; never overwrites a newer record.
export function detachWord(state,text,lang){
  const removed=detach(state,text,lang);
  if(!removed)return null;
  let usable=true;
  return target=>{
    const {r,meta}=removed,s=sizes.get(target);
    if(!usable||s!==meta.size||own(target.words,r.key)||s.words>=LEARNING_LIMITS.words||s.tokens+meta.tokens>LEARNING_LIMITS.tokens)return null;
    usable=false;target.words[r.key]=r;s.words++;s.tokens+=meta.tokens;owners.set(r,meta);return r;
  };
}
function address(loc){
  if(!loc||typeof loc.bookId!=='string'||!sourcePattern.test(loc.bookId)||!integer(loc.chapter,65535)||!integer(loc.paragraph,65535))return null;
  const off=loc.offset===undefined?0:loc.offset;
  if(!integer(off,16*1024*1024))return null;
  return [loc.bookId+'/'+loc.chapter+'/'+loc.paragraph,off];
}
function validPass(s){
  if(s.length>80)return false;
  const p=s.split('/');
  return p.length===3&&sourcePattern.test(p[0])&&p.slice(1).every(v=>/^(?:0|[1-9]\d{0,4})$/.test(v)&&Number(v)<=65535);
}
// Negative encoding records a lookup flag at the same offset; no second copy
// of that token. The core never evicts addresses to make room: eviction would
// make a reread look new. Past the cap counters are a conservative lower bound.
function insert(r,pass,offset,lookup){
  const m=owners.get(r);if(!m)return false;
  const list=r.seen[pass],tag=-(offset+1);
  if(list){
    if(list.includes(tag))return false;
    const i=list.indexOf(offset);
    if(i>=0){if(!lookup)return false;list[i]=tag;return true}
  }
  if(m.tokens>=LEARNING_LIMITS.perWord||m.size.tokens>=LEARNING_LIMITS.tokens)return false;
  if(!list){r.seen[pass]=[];m.passages++}
  r.seen[pass].push(lookup?tag:offset);m.tokens++;m.size.tokens++;return true;
}
export function recordEncounter(record,loc,_now=Date.now()){
  const a=address(loc);return !!a&&insert(record,...a,false);
}
export function noteLookup(record,loc,now=Date.now()){
  const a=address(loc);if(!a||!insert(record,...a,true))return false;
  if(!record.manual&&record.wins>0&&time(now)>=record.lastActionAt+RETRY)lapse(record,time(now));
  return true;
}
export function encounterCount(r){return owners.get(r)?.tokens||0}
export function passageCount(r){return owners.get(r)?.passages||0}
export function stage(r){
  if(r.manual||r.wins>=3)return 'known';
  if(r.wins>=2||(r.wins===1&&passageCount(r)>=3))return 'almost';
  return r.wins||r.lapsed||passageCount(r)>=2?'learning':'new';
}
export function due(r,now=Date.now()){return !!r&&!r.manual&&time(now)>=r.nextReviewAt}
function lapse(r,now){
  r.manual=false;r.wins=0;r.lapsed=true;r.lastActionAt=now;r.nextReviewAt=safeNext(now,RETRY);
}
export function review(r,{recalled,now=Date.now()}={}){
  if(!owners.has(r)||typeof recalled!=='boolean'||!integer(now,MAX_DATE)||now<r.lastActionAt)return false;
  if(!recalled){lapse(r,now);return true}
  if(!due(r,now))return false;
  r.manual=false;r.lapsed=false;r.wins=Math.min(3,r.wins+1);r.lastActionAt=now;r.nextReviewAt=safeNext(now,WAIT[r.wins]);return true;
}
export function markKnown(r,now=Date.now()){
  if(!owners.has(r)||r.manual||!integer(now,MAX_DATE)||now<r.lastActionAt)return false;
  r.manual=true;r.lapsed=false;r.lastActionAt=now;r.nextReviewAt=now;return true;
}
export function resumeLearning(r,now=Date.now()){
  if(!owners.has(r)||stage(r)!=='known'||!integer(now,MAX_DATE)||now<r.lastActionAt)return false;
  lapse(r,now);r.nextReviewAt=now;return true;
}
export function stats(state,now=Date.now()){
  const s={total:0,new:0,learning:0,almost:0,known:0,due:0};
  for(const r of Object.values(state.words)){s.total++;s[stage(r)]++;if(due(r,now))s.due++}return s;
}
export function bookStats(state,bookId){
  let words=0,encounters=0,passages=0;
  if(typeof bookId==='string'&&sourcePattern.test(bookId)){
    const prefix=bookId+'/';
    for(const r of Object.values(state.words)){
      let counted=false;
      for(const k in r.seen)if(k.startsWith(prefix)){passages++;encounters+=r.seen[k].length;counted=true}
      if(counted)words++;
    }
  }
  return {words,encounters,passages};
}
// Stable compact serialized rows: no browser internals, derived labels or raw prose.
function row(r){return [r.word,r.language,r.createdAt,r.wins,r.manual?1:0,r.lapsed?1:0,r.lastActionAt,r.nextReviewAt,r.seen]}
export function packLearning(state,{excludeKeys}={}){
  const rows=[];
  for(const r of Object.values(state.words)){
    if(excludeKeys?.has(r.key))continue;
    const a=row(r),seen=bag();for(const k in r.seen)seen[k]=[...r.seen[k]];a[8]=seen;rows.push(a);
  }
  return {version:1,rows};
}
function evidenceRank(action){
  // At tied timestamps prefer failure over success, and real activity over a bare import.
  return [action.lastActionAt,action.lapsed?3:action.manual?2:action.wins?1:0,-action.wins,action.nextReviewAt];
}
function newer(a,b){
  const x=evidenceRank(a),y=evidenceRank(b);
  for(let i=0;i<x.length;i++)if(x[i]!==y[i])return x[i]>y[i];
  return false;
}
function ingest(state,raw,now){
  if(!isObj(raw)||raw.version!==1)return;
  const rows=Array.isArray(raw.rows)?raw.rows:sizes.has(raw)?Object.values(raw.words).map(row):[];
  for(let i=0;i<Math.min(rows.length,LEARNING_LIMITS.words);i++){
    const a=rows[i];if(!Array.isArray(a)||a.length!==9||typeof a[1]!=='string'||a[1].length>40)continue;
    const created=Math.min(now,time(a[2],now)),old=getWord(state,a[0],a[1]),r=old||trackWord(state,a[0],a[1],created);
    if(!r)continue;
    const lastActionAt=Math.min(now,time(a[6])),wins=integer(a[3],3)?a[3]:0;
    const action={wins,manual:a[4]===1,lapsed:a[5]===1,lastActionAt,
      nextReviewAt:Math.min(safeNext(Math.max(created,lastActionAt),WAIT[3]),time(a[7],created))};
    if(!old||newer(action,r))Object.assign(r,action);
    r.createdAt=Math.min(r.createdAt,created);
    if(!isObj(a[8]))continue;
    let checked=0,examined=0;
    for(const k in a[8]){
      if(++checked>LEARNING_LIMITS.perWord||examined>=LEARNING_LIMITS.perWord)break;
      const offsets=a[8][k];if(!own(a[8],k)||!validPass(k)||!Array.isArray(offsets))continue;
      for(let j=0;j<offsets.length&&examined<LEARNING_LIMITS.perWord;j++){
        examined++;const v=offsets[j];if(typeof v!=='number')continue;
        const lookup=v<0,off=lookup?-v-1:v;if(integer(off,16*1024*1024))insert(r,k,off,lookup);
      }
    }
  }
}
export function loadLearning(raw=null,legacyWords=[],now=Date.now()){
  now=time(now);const state={version:1,words:bag()};sizes.set(state,{words:0,tokens:0});ingest(state,raw,now);
  if(Array.isArray(legacyWords)&&legacyWords.length){
    // v5 stored only strings. Preserve plausible historic dictionary language
    // only for those old cards. Never guess a language for newly imported books.
    const represented=new Set(Object.values(state.words).map(r=>r.word));
    for(let i=0;i<Math.min(legacyWords.length,LEARNING_LIMITS.words);i++){
      const t=legacyWords[i];if(typeof t!=='string'||t.length>256)continue;
      const lang=/\p{Script=Cyrillic}/u.test(t)?'ru':/\p{Script=Latin}/u.test(t)?'en':'und';
      const w=normalizeWord(t,lang);if(w&&!represented.has(w)){trackWord(state,w,lang,now);represented.add(w)}
    }
  }
  return state;
}
export function mergeLearning(state,incoming,now=Date.now()){
  const result=loadLearning(state,[],now);ingest(result,incoming,time(now));return result;
}
