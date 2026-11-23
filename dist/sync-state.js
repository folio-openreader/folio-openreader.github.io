// Pure bridge; no fetch, catalog lookup, persistent storage, timers or app globals.
// Callers supply only proven, currently writable bindings (see HANDOFF).
import {loadLearning,trackWord,removeWord} from './learning-core.js';
import {wordChange,editionKey,progressChange,bookmarkChange,removeChange,emptySnapshot,
        editSnapshot,mergeSnapshots,VAULT_LIMITS} from './sync-vault.js';

const AMAX=8.64e15, FORTNIGHT=14*86400000, own=(o,k)=>Object.hasOwn(o,k);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function fail(code='SYNC_LOCAL_INVALID'){const e=new Error(code);e.code=code;throw e}
const limit=()=>fail('VAULT_LIMIT');
const pos=(c,p,f)=>({chapter:c,paragraph:p,fraction:f});
const compare=(a,b)=>a.key<b.key?-1:a.key>b.key?1:0;
const rows=m=>[...m].map(([key,value])=>({key,value})).sort(compare);
const exceeds=n=>n>VAULT_LIMITS.records;

function sources({state,learning,editions=[]}){
  if(!obj(state?.positions)||!obj(state?.bookmarks)||learning?.version!==1||!obj(learning.words)
      ||!Array.isArray(editions)||editions.length>48)fail();
  const byEdition=new Map(),ids=new Set();
  for(const x of editions){
    if(!x||!Array.isArray(x.paragraphCounts)||!x.paragraphCounts.length||x.paragraphCounts.length>1024||
        x.paragraphCounts.some(n=>!Number.isSafeInteger(n)||n<1||n>16000)||
        x.paragraphCounts.reduce((a,b)=>a+b,0)>16000||ids.has(x.id))fail();
    const ed=editionKey(x.id,x.sha256);
    byEdition.set(ed,x);ids.add(x.id);
  }
  return byEdition;
}
function addressable(x,c,p){
  return !!x&&Number.isInteger(c)&&c>=0&&c<x.paragraphCounts.length&&
      Number.isInteger(p)&&p>=0&&p<x.paragraphCounts[c];
}
function coord(x,p){
  if(!addressable(x,p?.chapter,p?.paragraph))fail();
  // Stricter than safePosition: don't clamp/repair an invalid source while syncing.
  return pos(p.chapter,p.paragraph,p.fraction??0);
}
function target(key,value,scope){
  const [kind,ed,c,p]=key.split(':');
  if(kind==='w')return true;
  const s=scope.get(ed);
  return !!s&&(kind==='b'?addressable(s,Number(c),Number(p)):value===null||addressable(s,value[0],value[1]));
}
function localView(args,scope){
  const m=new Map();
  function insert({key,value}){
    if(m.has(key))fail();
    m.set(key,value);if(exceeds(m.size))limit();
  }
  for(const [key,record] of Object.entries(args.learning.words)){
    const v=wordChange(record);if(v.key!=='w:'+key)fail();insert(v);
  }
  for(const [edition,x] of scope){
    const posns=args.state.positions, marks=args.state.bookmarks;
    if(own(posns,x.id))insert(progressChange(edition,coord(x,posns[x.id])));
    if(own(marks,x.id)){
      if(!Array.isArray(marks[x.id]))fail();
      for(const p of marks[x.id])insert(bookmarkChange(edition,coord(x,p)));
    }
  }
  return m;
}
export function projectLocal(args){return rows(localView(args,sources(args)))}

// Per-vault materialization baseline, not a second candidate snapshot. An explicit
// null is evidence a tombstone reached THIS device: a subsequent re-add is real.
function changesSince(args,snapshot,scope){
  const previous=args.previous??[], live=localView(args,scope), prior=new Map(), delta=[], observed=new Map();
  if(!Array.isArray(previous))fail();
  if(exceeds(previous.length))limit();
  const journal=new Map(snapshot.records.map(r=>[r.key,r]));
  for(const r of previous){
    if(!obj(r)||Object.keys(r).length!==2||!own(r,'key')||!own(r,'value')||prior.has(r.key)||
       !journal.has(r.key))fail();
    const v=r.value,k=r.key;
    if(!same(v,journal.get(k).value))fail();
    prior.set(k,v);
  }
  for(const [key,value] of live){
    // A previously deferred winner is NOT a locally edited item. Apply it first.
    if(!prior.has(key)&&journal.has(key))continue;
    if(!prior.has(key)||!same(value,prior.get(key)))delta.push({key,value});
    observed.set(key,value);
  }
  for(const [key,before] of prior){
    // Complete local vocabulary and proven edition only. A vanished shelf item,
    // inaccessible edition or out-of-bounds record is not a deletion.
    if(!live.has(key)&&target(key,before,scope)){
      if(before!==null)delta.push(removeChange(key));observed.set(key,null);
    }
  }
  return {delta,projection:rows(observed),observed,live};
}
export function captureLocal(args){
  const snapshot=mergeSnapshots(emptySnapshot(),args.snapshot??emptySnapshot());
  const scope=sources(args),{delta,projection,observed,live}=changesSince(args,snapshot,scope);
  // Ephemeral observations, NOT an acknowledged/persisted baseline. A record
  // deferred on a previous run can become eligible but not yet applied. If the
  // user edits it during this transfer, that fresh edit must still be preserved.
  const pending=new Map();
  for(const {key,value} of snapshot.records){
    if(!observed.has(key)&&target(key,value,scope))pending.set(key,live.get(key)??null);
  }
  return {snapshot:editSnapshot(snapshot,args.device,delta),projection,pending:rows(pending)};
}

const newCounts=()=>({words:0,progress:0,bookmarks:0,added:0,updated:0,removed:0,deferred:0});
function count(counts,kind,before,after){
  if(before===undefined&&after===null||same(before,after))return;
  counts[kind]++;counts[after===null?'removed':before===undefined?'added':'updated']++;
}
// Apply only an already-merged snapshot. Detached copy of owned vocabulary records;
// all unrelated state keys + scope-excluded book entries remain unchanged.
export function applyLocal(args){
  const {state,learning,now=Date.now()}=args,scope=sources(args);
  if(!Number.isSafeInteger(now)||now<0||now>AMAX)fail();
  const snapshot=mergeSnapshots(emptySnapshot(),args.snapshot), live=localView(args,scope);
  const next={...state,positions:{...state.positions},bookmarks:{...state.bookmarks}};
  const draft=loadLearning(learning,[],AMAX), counts=newCounts(), applied=new Map(), markSets=new Map();
  // A plain deserialized words object isn't an owned learning-core state.
  if(Object.keys(draft.words).length!==Object.keys(learning.words).length)fail();
  // Free removed cards before additions so an at-capacity swap can be prepared.
  for(const r of snapshot.records)if(r.key.startsWith('w:')&&r.value===null){
    const [,lang,word]=r.key.split(':');removeWord(draft,word,lang);
  }
  for(const {key,value} of snapshot.records){
    if(!target(key,value,scope)){counts.deferred++;continue}
    const [kind,a,b,c]=key.split(':'), before=live.get(key);
    let actual=value;
    if(kind==='w'){
      if(value!==null){
        const existing=draft.words[a+':'+b], [wins,manual,lapsed,lastActionAt,nextReviewAt]=value;
        // Don't clamp a peer's clock into a made-up review. Unrepresentable
        // schedules stay in the journal, pending, rather than generating edits.
        if(!same(before,value)&&(lastActionAt>now||
            nextReviewAt>Math.max(lastActionAt,existing?.createdAt??now)+FORTNIGHT)){
          counts.deferred++;continue;
        }
        const card=existing||trackWord(draft,b,a,now);if(!card)fail('SYNC_WORD_CAPACITY');
        Object.assign(card,{wins,manual,lapsed,lastActionAt,nextReviewAt});
        actual=wordChange(card).value;
      }
      count(counts,'words',before,actual);
    }else if(kind==='p'){
      const id=scope.get(a).id;
      if(value===null)delete next.positions[id];
      else if(!same(before,value))next.positions[id]=pos(...value);
      count(counts,'progress',before,value);
    }else{
      const id=scope.get(a).id;
      if(!(before===undefined&&value===null)&&!same(before,value)){
        let marks=markSets.get(id);
        if(!marks){marks=new Map((state.bookmarks[id]||[]).map(p=>[p.chapter+':'+p.paragraph,p]));markSets.set(id,marks)}
        if(value===null)marks.delete(b+':'+c);else marks.set(b+':'+c,pos(+b,+c,value));
      }
      count(counts,'bookmarks',before,value);
    }
    applied.set(key,actual);
  }
  for(const [id,marks] of markSets)next.bookmarks[id]=[...marks.values()];
  return {state:next,learning:draft,projection:rows(applied),counts};
}
// A transfer may take seconds. Caller invokes this synchronously on fresh, complete
// state immediately before guarded persistence, not on a captured/modal-open state.
export function finishLocal(args){
  const {staged,remote,device}=args;
  const base=mergeSnapshots(emptySnapshot(),staged.snapshot);
  const scope=sources(args),{delta,live}=changesSince({...args,previous:staged.projection},base,scope);
  if(!Array.isArray(staged.pending)||exceeds(staged.pending.length))fail();
  const known=new Set(base.records.map(r=>r.key));
  for(const r of staged.projection)known.delete(r.key);
  const pending=staged.pending.length?editSnapshot(emptySnapshot(),device,staged.pending).records:[];
  for(const {key,value} of pending){
    if(!known.has(key))fail();
    if(!target(key,value,scope))continue;
    const after=live.get(key)??null;
    if(!same(value,after))delta.push({key,value:after});
  }
  const snapshot=editSnapshot(mergeSnapshots(base,remote),device,delta);
  return {snapshot,...applyLocal({...args,snapshot})};
}
