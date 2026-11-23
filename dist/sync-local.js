// Local-only vocabulary storage, loaded only after explicit transfer or on an enrolled device.
// Exactly ONE atomic Storage.setItem commits owned rows, all vault journals and baselines.
// Old clients can still edit v1 but never write this v2 key; diverging v1 is preserved.
import {loadLearning,packLearning,mergeLearning} from './learning-core.js';
export const STORE='folio-word-store-v2', LEGACY='folio-learning-v1', LOCK='folio-word-store-v2:writer';
const id=/^[a-f0-9]{32}$/,sha=/^[a-f0-9]{64}$/,MAX_DATE=8640000000000000;
export function stop(code){throw Object.assign(new Error(code),{code})}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function parseWords(packed){
  if(!packed||packed.version!==1||!Array.isArray(packed.rows))stop('local-invalid');
  const owned=loadLearning(packed,[],MAX_DATE);
  if(!same(packLearning(owned),packed))stop('local-invalid');
  return owned;
}
function parse(raw){
  let r;try{r=JSON.parse(raw)}catch{stop('local-invalid')}
  if(r?.v!==1||!id.test(r.device)||!sha.test(r.legacyHash)||!r.vaults||
      typeof r.vaults!=='object'||Array.isArray(r.vaults)||Object.keys(r.vaults).length>8||
      Object.keys(r.vaults).some(k=>!id.test(k)))stop('local-invalid');
  parseWords(r.words);return r;
}
async function digest(text){
  if(typeof text!=='string'||!globalThis.crypto?.subtle)stop('local-invalid');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
}
export function createWordStore({storage,locks,legacyCursor,legacyListCursor,liveWords,onApplied=()=>{}}){
  // Keep one exact copy of the last durable bytes for stale-tab detection.
  let raw=storage.getItem(STORE),row=raw===null?null:parse(raw),held=false,claim=null,release=null,epoch=0;
  let verifiedLegacy=null;
  const fresh=()=>{if(storage.getItem(STORE)!==raw)stop('local-changed')};
  const cursor=()=>{
    fresh();const v=storage.getItem(LEGACY),list=v===null?storage.getItem('folio-words'):null;
    if(!row&&(legacyCursor()!==v||v===null&&(legacyListCursor?.()??null)!==list))stop('local-changed');
    // Type tags distinguish no record, legacy string list, and v1 packed rows.
    return v!==null?'v:'+v:list!==null?'l:'+list:'n:';
  };
  const unpack=bytes=>{
    if(bytes==='n:')return loadLearning();
    let value;try{value=JSON.parse(bytes.slice(2))}catch{stop('local-invalid')}
    if(bytes.startsWith('v:'))return parseWords(value);
    if(!Array.isArray(value)||value.length>20000||value.some(w=>typeof w!=='string'||!w||w.length>128))stop('local-invalid');
    const owned=loadLearning(null,value);
    if(Object.keys(owned.words).length!==value.length)stop('local-invalid');return owned;
  };
  async function own(){
    if(held)return true;
    if(!locks?.request)stop('local-locks');
    if(!claim){
      const at=epoch,result=Promise.withResolvers?Promise.withResolvers():deferred();
      claim=result.promise;
      void locks.request(LOCK,{mode:'exclusive',ifAvailable:true},lock=>{
        if(!lock||at!==epoch){result.resolve(false);return}
        const parked=deferred();release=parked.resolve;held=true;result.resolve(true);
        return parked.promise;
      }).catch(()=>result.reject(Object.assign(new Error('local-locks'),{code:'local-locks'})));
    }
    const pending=claim;
    try{return await pending}finally{if(claim===pending)claim=null}
  }
  function close(){epoch++;held=false;release?.();release=null}
  async function source(){
    const bytes=cursor();
    if(!row){
      const old=unpack(bytes);
      if(!bytes.startsWith('v:')&&!same(Object.keys(old.words).sort(),Object.keys(liveWords().words).sort()))stop('local-changed'); // Never infer an empty device from unreadable/normalized-away records.
    }
    const hash=verifiedLegacy?.bytes===bytes?verifiedLegacy.hash:await digest(bytes);
    if(bytes!==cursor())stop('local-changed');
    verifiedLegacy={bytes,hash};
    if(row&&row.legacyHash!==hash)stop('legacy-fork');
    return {bytes,hash};
  }
  function validSource(src){
    if(cursor()!==src.bytes||row&&row.legacyHash!==src.hash)stop('local-changed');
  }
  function store(next){
    if(!held)stop('local-busy');fresh();
    const bytes=JSON.stringify(next);
    try{storage.setItem(STORE,bytes)}catch{stop('local-quota')}
    raw=bytes;row=next;
  }
  function current(vault){fresh();if(!id.test(vault))stop('local-invalid');
    let v=row?.vaults[vault];
    if(!v){
      const text=storage.getItem('folio-sync-export-v1:'+vault);
      if(text!==null){
        try{v=JSON.parse(text)}catch{stop('local-invalid')}
        if(v?.v!==1||!id.test(v.device))stop('local-invalid');
      }
    }
    if(v&&(!Object.hasOwn(v,'snapshot')||!Array.isArray(v.projection)))stop('local-invalid');
    return {snapshot:v?.snapshot,previous:v?.projection,github:v?.github,device:row?.device??v?.device};
  }
  function commit({vault,device,snapshot,projection,github,learning,src}){
    validSource(src);const old=current(vault);
    if(old.device&&old.device!==device||!id.test(device))stop('local-changed');
    if(row&&!Object.hasOwn(row.vaults,vault)&&Object.keys(row.vaults).length>=8)stop('local-vault-limit');
    const words=packLearning(learning),entry={snapshot,projection,...((github||old.github)?{github:github||old.github}:{})};
    store({v:1,device,legacyHash:src.hash,words,vaults:{...row?.vaults,[vault]:entry}});
    onApplied(learning); // caller only updates view/model after durable success
  }
  function commitExport(payload){
    if(row){commit(payload);return}
    const {vault,device,snapshot,projection,src}=payload;validSource(src);
    if(!held)stop('local-busy');
    const old=current(vault);if(!id.test(device)||old.device&&old.device!==device)stop('local-changed');
    // A download never migrates or rewrites ordinary reader data. The next capture
    // detects edits after this journal; the unchanged reader still supports its normal tabs.
    const prefix='folio-sync-export-v1:',key=prefix+vault,bytes=JSON.stringify({v:1,device,snapshot,projection});
    let count=1,chars=key.length+bytes.length;
    for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k!==key&&k?.startsWith(prefix)){count++;chars+=k.length+(storage.getItem(k)?.length||0)}}
    // Bounded local growth: no pruning of past tombstones or unrelated stored data.
    if(count>4||chars>512*1024)stop('export-journal-limit');
    try{storage.setItem(key,bytes)}
    catch{stop('local-quota')}
  }
  function assertEditor(){if(!row)stop('local-invalid');if(!held)stop('local-busy');fresh()}
  function saveWords(words){assertEditor();store({...row,words})}
  async function legacyReview(){
    if(!row)stop('local-invalid');
    const bytes=cursor(),hash=await digest(bytes);if(bytes!==cursor())stop('local-changed');
    if(hash===row.legacyHash)stop('no-legacy-fork');
    const other=unpack(bytes),before=JSON.stringify(packLearning(liveWords()));
    const merged=mergeLearning(liveWords(),other,MAX_DATE);
    // Refuse capacity, clamp or silent evidence loss instead of acknowledging an incomplete reconciliation.
    for(const view of [other,liveWords()])for(const [key,r] of Object.entries(view.words)){
      const card=merged.words[key];if(!card)stop('local-capacity');
      for(const [where,offsets] of Object.entries(r.seen))for(const x of offsets)
        if(!card.seen[where]?.some(y=>y===x||x>=0&&y===-x-1))stop('local-capacity');
    }
    const added=Object.keys(merged.words).length-Object.keys(liveWords().words).length;
    let spent=false;
    return {added,async apply(signal){
      if(spent)stop('local-changed');spent=true;if(!await own())stop('local-busy');
      signal?.throwIfAborted();if(bytes!==cursor()||JSON.stringify(packLearning(liveWords()))!==before)stop('local-changed');
      store({...row,legacyHash:hash,words:packLearning(merged)});onApplied(merged);
    }};
  }
  return {get enrolled(){return row!==null},get packed(){return row?.words},get held(){return held},
          own,close,current,source,validSource,commit,commitExport,saveWords,assertEditor,legacyReview};
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
