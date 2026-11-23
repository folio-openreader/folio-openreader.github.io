import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLocal,captureLocal,finishLocal,projectLocal} from '../dist/sync-state.js';
import {emptySnapshot,editSnapshot,wordChange,progressChange,bookmarkChange,editionKey,removeChange,mergeSnapshots} from '../dist/sync-vault.js';
import {loadLearning,trackWord,removeWord,recordEncounter,noteLookup,encounterCount,packLearning,markKnown,review} from '../dist/learning-core.js';

const device='1'.repeat(32),peer='f'.repeat(32),id='starter-one',sha256='a'.repeat(64),ed=editionKey(id,sha256);
const pg=(chapter=0,paragraph=1,fraction=.25)=>({chapter,paragraph,fraction});
const word=(w,last=0,schedule=0)=>wordChange({word:w,language:'en',wins:0,manual:false,lapsed:false,lastActionAt:last,nextReviewAt:schedule});
const blank=()=>({state:{prefs:{provider:'never-send-this'},lastBook:'private-id',positions:{},bookmarks:{}},
  learning:loadLearning(),editions:[{id,sha256,paragraphCounts:[3,2]}],device,now:10000});
const snapshot=changes=>editSnapshot(emptySnapshot(),peer,changes), lookup=(s,k)=>s.records.find(r=>r.key===k);
const wordsKey='w:en:river';

test('allowlist, no first-absence deletions, mixed local/private data stays local',()=>{
  const a=blank(),r=trackWord(a.learning,'River','en',1000);
  recordEncounter(r,{bookId:'secret-book',chapter:2,paragraph:3,offset:17});markKnown(r,1100);
  r.gloss='sensitive gloss';r.context='secret prose';
  a.state.positions[id]={...pg(),translation:'hidden quote'};a.state.bookmarks[id]=[pg(1,0)];
  for(const k of ['demo','local-uuid','article-private','starter-legacy']){
    a.state.positions[k]=pg();a.state.bookmarks[k]=[pg()];}
  const out=projectLocal(a);assert.deepEqual(out,[
    {key:'b:'+ed+':1:0',value:.25},{key:'p:'+ed,value:[0,1,.25]},
    {key:wordsKey,value:[0,true,false,1100,1100]}]);
  assert(!JSON.stringify(captureLocal(a)).match(/prose|private|secret|provider|translation|gloss/));
  const stale=snapshot([word('unseen')]),first=captureLocal({...a,snapshot:stale});
  assert.deepEqual(lookup(first.snapshot,'w:en:unseen'),stale.records[0]);assert(!first.projection.some(x=>x.key==='w:en:unseen'));
});

test('capture unchanged, local evidence-only edit, deliberate delete + readd',()=>{
  const a=blank(),card=trackWord(a.learning,'river','en',10);a.state.bookmarks[id]=[pg()];
  const first=captureLocal(a);
  noteLookup(card,{bookId:'private',chapter:0,paragraph:1,offset:14},20);
  const captured=captureLocal({...a,snapshot:first.snapshot,previous:first.projection});
  assert.deepEqual(captured,first);
  removeWord(a.learning,'river','en');a.state.bookmarks[id]=[];
  const deleted=captureLocal({...a,snapshot:first.snapshot,previous:first.projection});
  for(const row of deleted.snapshot.records){assert.equal(row.n,2);assert.equal(row.value,null)}
  assert.equal(deleted.projection.length,2);
  trackWord(a.learning,'river','en',15);a.state.bookmarks[id]=[pg()];
  const readded=captureLocal({...a,snapshot:deleted.snapshot,previous:deleted.projection});
  for(const row of readded.snapshot.records){assert.equal(row.n,3);assert.notEqual(row.value,null)}
});

test('unknown, unloaded and changed-fingerprint books never tombstone or materialize',()=>{
  const a=blank();a.state.positions[id]=pg(1,1);a.state.bookmarks[id]=[pg()];
  const staged=captureLocal(a), old=staged.snapshot;
  const none=captureLocal({...a,editions:[],snapshot:old,previous:staged.projection});
  assert.deepEqual(none.snapshot,old);assert.deepEqual(none.projection,[]);
  const mismatch=applyLocal({...a,editions:[{...a.editions[0],sha256:'b'.repeat(64)}],
    snapshot:old,state:{...a.state,positions:{},bookmarks:{}}});
  assert.deepEqual(mismatch.state.positions,{});assert.equal(mismatch.counts.deferred,2);
  const unloaded={...a,state:{...a.state,positions:{},bookmarks:{}}};
  const visible=captureLocal({...unloaded,snapshot:none.snapshot,previous:none.projection});
  assert.deepEqual(visible.snapshot,old);
  const applied=applyLocal({...unloaded,snapshot:visible.snapshot});assert.deepEqual(applied.state,a.state);
});

test('bound remote only, backwards read and bookmark bounds; deferred invalid remote coords never applied',()=>{
  const a=blank();a.state.positions[id]=pg(1,1);a.state.bookmarks[id]=[pg()];
  a.state.positions['local-import']=pg(8,1);a.state.bookmarks['local-import']=[pg(8,2)];
  const r=snapshot([progressChange(ed,pg(0,0)),bookmarkChange(ed,pg(1,2)),removeChange('b:'+ed+':0:1')]);
  const out=applyLocal({...a,snapshot:r});
  assert.deepEqual(out.state.positions[id],pg(0,0));assert.deepEqual(out.state.bookmarks[id],[]);
  assert.deepEqual(out.state.positions['local-import'],pg(8,1));assert.deepEqual(out.state.bookmarks['local-import'],[pg(8,2)]);
  assert.equal(out.counts.deferred,1);assert.equal(out.counts.removed,1);assert.equal(out.counts.updated,1);
  assert.equal(out.projection.length,2);
  assert.deepEqual(a.state.positions[id],pg(1,1));assert.deepEqual(a.state.bookmarks[id],[pg()]);
  const bad=applyLocal({...a,snapshot:snapshot([progressChange(ed,pg(4,0))])});
  assert.equal(bad.counts.deferred,1);assert.deepEqual(bad.state,a.state);
});

test('learning-core ownership and local encounter evidence survive word-only apply; no fake evidence',()=>{
  const a=blank(),existing=trackWord(a.learning,'river','en',300);recordEncounter(existing,{bookId:'local',chapter:0,paragraph:1,offset:17});
  const newState=snapshot([wordChange({...existing,manual:true,lastActionAt:1000,nextReviewAt:1000}),word('bird')]);
  const out=applyLocal({...a,snapshot:newState});
  assert.equal(existing.manual,false);assert.equal(out.learning.words['en:river'].manual,true);
  assert.equal(out.learning.words['en:river'].createdAt,300);
  assert.equal(encounterCount(out.learning.words['en:river']),1);assert.equal(encounterCount(out.learning.words['en:bird']),0);
  assert.deepEqual(packLearning(a.learning).rows[0][8],packLearning(out.learning).rows.find(x=>x[0]==='river')[8]);
  assert.equal(out.counts.added,1);assert.equal(out.counts.updated,1);
  const m=editSnapshot(newState,peer,[removeChange(wordsKey)]);
  const del=applyLocal({...a,learning:out.learning,snapshot:m});assert(!del.learning.words['en:river']);assert(out.learning.words['en:river']);
});

test('same-key mutation during dialog beats old preview; unrelated live changes and local state preserved',()=>{
  const a=blank(),card=trackWord(a.learning,'river','en',0);a.state.positions[id]=pg(1,0);
  const staged=captureLocal(a);
  let remote=editSnapshot(staged.snapshot,peer,[removeChange(wordsKey),word('goose'),progressChange(ed,pg())]);
  remote=editSnapshot(remote,peer,[progressChange(ed,pg(0,2))]);
  a.state.positions[id]=pg(0,0);a.state.prefs.appearance='changed';a.state.positions.private=pg(5,7);
  markKnown(card,175);
  const res=finishLocal({...a,staged,remote});
  assert.deepEqual(res.state.positions[id],pg(0,0));assert.equal(res.state.prefs.appearance,'changed');
  assert.deepEqual(res.state.positions.private,pg(5,7));assert.equal(res.learning.words['en:river'].manual,true);
  assert(res.learning.words['en:goose']);assert.equal(lookup(res.snapshot,'p:'+ed).n,4);
  assert.equal(lookup(res.snapshot,wordsKey).n,3);
  assert.deepEqual(mergeSnapshots(remote,res.snapshot),res.snapshot);
  const again=captureLocal({...a,state:res.state,learning:res.learning,snapshot:res.snapshot,previous:res.projection});
  assert.deepEqual(again.snapshot,res.snapshot);assert.deepEqual(again.projection,res.projection);
});

test('remote date does not stand in for logical revision; future time deferred without stamp churn',()=>{
  const a=blank(),card=trackWord(a.learning,'river','en',100);review(card,{recalled:true,now:8000});
  const staged=captureLocal(a),remote=editSnapshot(staged.snapshot,peer,[word('river',1000,1200),word('future',11000,12000)]);
  const done=finishLocal({...a,staged,remote});assert.equal(done.learning.words['en:river'].lastActionAt,1000);
  assert(!done.learning.words['en:future']);assert.equal(done.counts.deferred,1);
  const next={...a,state:done.state,learning:done.learning,snapshot:done.snapshot,previous:done.projection};
  const cap=captureLocal(next);assert.deepEqual(cap.snapshot,done.snapshot);
  const later=finishLocal({...next,now:15000,staged:cap,remote:done.snapshot});
  assert.equal(later.learning.words['en:future'].lastActionAt,11000);assert.equal(later.counts.deferred,0);
});

test('reject invalid local collections or corrupt/materialization baseline before deletions',()=>{
  const a=blank(),staged=captureLocal({...a,state:{...a.state,bookmarks:{[id]:[pg()]}}});
  for(const bookmarks of [{[id]:null},{[id]:[pg(-1)]},{[id]:[pg(),pg()]}]){
    assert.throws(()=>captureLocal({...a,state:{...a.state,bookmarks},snapshot:staged.snapshot,previous:staged.projection}),{code:'SYNC_LOCAL_INVALID'});
  }
  assert.throws(()=>captureLocal({...a,snapshot:staged.snapshot,previous:[{key:'w:en:x',value:null}]}),{code:'SYNC_LOCAL_INVALID'});
  assert.throws(()=>applyLocal({...a,snapshot:{version:1,records:[{key:'w:en:x',value:[1,false,false,999,0],d:device,n:1}]}}),{code:'VAULT_INVALID'});
});

test('actual modal-time edit or removal to an eligible but not-yet-applied pending record survives',()=>{
  const a=blank();a.state.positions[id]=pg(1,1);a.state.bookmarks[id]=[pg()];
  const stored=snapshot([progressChange(ed,pg(0,1)),bookmarkChange(ed,pg(0,1,.9)),word('bird',0,1)]);
  const staged=captureLocal({...a,snapshot:stored,previous:[]});
  assert.equal(staged.projection.length,0); // never mark these as previously applied
  const untouched=finishLocal({...a,staged,remote:stored});
  assert.deepEqual(untouched.state.positions[id],pg(0,1));assert.deepEqual(untouched.state.bookmarks[id],[pg(0,1,.9)]);
  a.state.positions[id]=pg(0,2);a.state.bookmarks[id]=[];trackWord(a.learning,'bird','en',200);
  const edited=finishLocal({...a,staged,remote:stored});
  assert.deepEqual(edited.state.positions[id],pg(0,2));assert.deepEqual(edited.state.bookmarks[id],[]);
  assert.equal(lookup(edited.snapshot,'b:'+ed+':0:1').value,null);
  assert.equal(edited.learning.words['en:bird'].nextReviewAt,200);
  assert(edited.snapshot.records.every(r=>r.n===2));
  // Dropping eligibility while dialog open is not removal.
  const unplug=finishLocal({...a,editions:[],staged,remote:stored});
  assert.equal(lookup(unplug.snapshot,'b:'+ed+':0:1').value,.9);
});

test('applied remote word + bookmark deliberately deleted locally, stale peer merge cannot resurrect',()=>{
  const a=blank(),staged=captureLocal(a),remote=snapshot([word('river'),bookmarkChange(ed,pg())]);
  const initial=finishLocal({...a,staged,remote});
  const {state,learning}=initial;removeWord(learning,'river','en');state.bookmarks[id]=[];
  const captured=captureLocal({...a,state,learning,snapshot:initial.snapshot,previous:initial.projection});
  const final=finishLocal({...a,state,learning,staged:captured,remote});
  assert(final.snapshot.records.every(r=>r.n===2&&r.value===null));
  assert.deepEqual(final.state.bookmarks[id],[]);assert(!final.learning.words['en:river']);
});
