import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncController} from '../dist/sync-controller.js';
import {createWordStore,STORE,LEGACY} from '../dist/sync-local.js';
import {generateRecoveryCode,unlockVault,openVault,sealVault,editSnapshot,mergeSnapshots,progressChange,editionKey,newDeviceId} from '../dist/sync-vault.js';
import {loadLearning,packLearning,trackWord,getWord,removeWord,markKnown,recordEncounter,encounterCount} from '../dist/learning-core.js';
class Mem{
  data=new Map();fail=false;
  get length(){return this.data.size}
  key(i){return [...this.data.keys()][i]??null}
  getItem(k){return this.data.get(k)??null}
  setItem(k,v){if(this.fail)throw new Error('quota');this.data.set(k,v)}
}
class Locks{
  held=false;
  async request(n,o,cb){if(this.held)return cb(null);this.held=true;try{return await cb({name:n})}finally{this.held=false}}
}
const codeErr=c=>e=>e.code===c;
const blob=text=>new Blob([text]);
const click={};
function device(words=[],mem=new Mem(),locks=new Locks(),factory){
  let live=loadLearning(),cursor;
  const old=mem.getItem(LEGACY);
  if(old===null){for(const w of words)trackWord(live,w,'en',100);mem.setItem(LEGACY,JSON.stringify(packLearning(live)))}
  else live=loadLearning(JSON.parse(old));
  cursor=mem.getItem(LEGACY);
  const disk=createWordStore({storage:mem,locks,legacyCursor:()=>cursor,liveWords:()=>live,onApplied:s=>live=s});
  if(disk.packed)live=loadLearning(disk.packed);
  const ctl=createSyncController({disk,liveWords:()=>live,githubFactory:factory});
  return {disk,mem,locks,ctl,get live(){return live},save(){const p=packLearning(live);
    if(disk.enrolled)disk.saveWords(p);else{cursor=JSON.stringify(p);mem.setItem(LEGACY,cursor)}}};
}
async function transmit(d,code){const x=await d.ctl.exportFile({code});x.finalize();x.discard();return x.sealed}
async function preview(d,code,text){return d.ctl.previewFile({code,file:blob(text)})}
async function take(d,code,text){const p=await preview(d,code,text);if(p.kind!=='unchanged')await p.apply(click);p.discard?.();return p}
test('two stores: file merge, local evidence and provenance privacy, clocked deletion, stale file, later re-add',async()=>{
  const a=device(['river']),b=device(['moon']),code=generateRecoveryCode(),session=await unlockVault(code);
  const r=getWord(a.live,'river','en');recordEncounter(r,{bookId:'private-book',chapter:2,paragraph:3,offset:10});a.save();
  b.mem.setItem('folio-v2','private-position-settings');b.mem.setItem('other-token','pretend-secret');
  const first=await transmit(a,code);assert.doesNotMatch(first,/river|private-book/);
  const unpacked=await openVault(session,first);assert.doesNotMatch(JSON.stringify(unpacked),/private-book|pretend-secret|seen/);
  const original=b.mem.getItem(LEGACY),plan=await preview(b,code,first);
  assert.equal(b.mem.getItem(STORE),null);assert.equal(plan.summary.added,1);plan.discard();
  await assert.rejects(()=>plan.apply(click),codeErr('local-changed'));assert.ok(!getWord(b.live,'river','en'));
  await take(b,code,first);assert.equal(b.mem.getItem(LEGACY),original);assert.equal(encounterCount(getWord(b.live,'river','en')),0);
  assert.ok(getWord(b.live,'moon','en'));assert.equal(b.mem.getItem('folio-v2'),'private-position-settings');
  const back=await transmit(b,code);await take(a,code,back);assert.equal(encounterCount(getWord(a.live,'river','en')),1);
  removeWord(b.live,'river','en');b.save();const deleted=await transmit(b,code);
  const deletion=await preview(a,code,deleted);assert.equal(deletion.summary.removed,1);
  trackWord(a.live,'sun','en',110);a.save();await deletion.apply(click);assert.ok(getWord(a.live,'sun','en'));
  assert.ok(!getWord(a.live,'river','en'));await take(a,code,first);assert.ok(!getWord(a.live,'river','en'));
  trackWord(a.live,'river','en',130);a.save();await take(b,code,await transmit(a,code));assert.ok(getWord(b.live,'river','en'));
  assert.ok(!a.mem.getItem(STORE).includes(code));
});
test('invalid or aborted import, outdated consent, denied storage and changed legacy leave authority intact',async()=>{
  const a=device(['meadow']),b=device(['meadow']),code=generateRecoveryCode();const first=await transmit(a,code);await take(b,code,first);
  const old=b.mem.getItem(STORE);await assert.rejects(()=>preview(b,generateRecoveryCode(),first),codeErr('VAULT_AUTH'));
  await assert.rejects(()=>preview(b,code,'{}'));assert.equal(b.mem.getItem(STORE),old);
  const abort=new AbortController();abort.abort();
  await assert.rejects(()=>b.ctl.previewFile({file:blob(first),code,signal:abort.signal}));
  removeWord(a.live,'meadow','en');a.save();const gone=await transmit(a,code),p=await preview(b,code,gone);
  recordEncounter(getWord(b.live,'meadow','en'),{bookId:'secret',chapter:0,paragraph:0,offset:0});b.save();
  await assert.rejects(()=>p.apply(click),codeErr('local-changed'));assert.ok(getWord(b.live,'meadow','en'));
  const t=await preview(b,code,gone),before=b.mem.getItem(STORE);b.mem.fail=true;
  await assert.rejects(()=>t.apply(click),codeErr('local-quota'));b.mem.fail=false;
  assert.equal(b.mem.getItem(STORE),before);assert.ok(getWord(b.live,'meadow','en'));
  const fork=loadLearning(JSON.parse(b.mem.getItem(LEGACY)));trackWord(fork,'oldtab','en',120);
  b.mem.setItem(LEGACY,JSON.stringify(packLearning(fork)));await assert.rejects(()=>preview(b,code,gone),codeErr('legacy-fork'));
  const recover=await b.disk.legacyReview();assert.equal(recover.added,1);await recover.apply();assert.ok(getWord(b.live,'oldtab','en'));
  const clean=await preview(b,code,gone);clean.discard?.();
});
test('local writer edits during the very first preview are rebased before migrating; a foreign legacy writer is rejected',async()=>{
  const a=device(['rose']),b=device(['twig']),code=generateRecoveryCode(),f=await transmit(a,code);
  const p=await preview(b,code,f);trackWord(b.live,'grass','en',125);b.save();await p.apply(click);
  for(const k of ['rose','twig','grass'])assert.ok(getWord(b.live,k,'en'));
  const c=device(['stone']),plan=await preview(c,code,f);
  c.mem.setItem(LEGACY,JSON.stringify({version:1,rows:[]}));
  await assert.rejects(()=>plan.apply(click),codeErr('local-changed'));assert.equal(c.mem.getItem(STORE),null);
});
test('enrollment race, other tab, missing Web Locks, damaged baseline, and interrupted download',async()=>{
  const a=device(['pine']),code=generateRecoveryCode();
  const pending=await a.ctl.exportFile({code});assert.equal(a.mem.getItem(STORE),null);pending.discard();
  assert.throws(()=>pending.finalize(),codeErr('local-changed'));
  const first=await transmit(a,code);assert.equal(a.mem.getItem(STORE),null);
  const sender=device(['maple']);await take(a,code,await transmit(sender,code));
  const b=device([],a.mem,a.locks),raw=a.mem.getItem(STORE);
  assert.equal(await b.disk.own(),false);assert.throws(()=>b.save(),codeErr('local-busy'));
  await assert.rejects(()=>b.ctl.exportFile({code}),codeErr('local-busy'));assert.equal(a.mem.getItem(STORE),raw);
  a.disk.close();await new Promise(r=>setImmediate(r));assert.equal(await b.disk.own(),true);
  const tmp=device(['oak'],new Mem(),{});const p=await preview(tmp,code,first);await assert.rejects(()=>p.apply(click),codeErr('local-locks'));
  assert.equal(tmp.mem.getItem(STORE),null);tmp.mem.setItem(LEGACY,'{}');
  await assert.rejects(()=>preview(tmp,code,first));assert.equal(tmp.mem.getItem(STORE),null);
});
test('never-used receiver, legacy-list-only receiver, and explicit export preserve their source stores',async()=>{
  const peer=device(['lily']),code=generateRecoveryCode(),payload=await transmit(peer,code);
  assert.equal(peer.mem.getItem(STORE),null);
  for(const list of [null,'["birch"]']){
    const storage=new Mem(),locks=new Locks();
    if(list!==null)storage.setItem('folio-words',list);
    let live=loadLearning(null,list?JSON.parse(list):[]);
    const disk=createWordStore({storage,locks,legacyCursor:()=>null,legacyListCursor:()=>list,liveWords:()=>live,onApplied:s=>live=s});
    const ctl=createSyncController({disk,liveWords:()=>live});
    const plan=await ctl.previewFile({file:blob(payload),code});
    assert.equal(storage.getItem(STORE),null);assert.equal(storage.getItem(LEGACY),null);
    await plan.apply(click);assert.ok(getWord(live,'lily','en'));if(list)assert.ok(getWord(live,'birch','en'));
    assert.equal(storage.getItem(LEGACY),null);assert.equal(storage.getItem('folio-words'),list);
  }
});
test('export-only journals stop at their combined budget, never prune or migrate active reader storage',async()=>{
  const d=device(['tree']),codes=Array.from({length:5},()=>generateRecoveryCode());
  for(const c of codes.slice(0,4))await transmit(d,c);
  const before=[...d.mem.data];
  const x=await d.ctl.exportFile({code:codes[4]});assert.throws(()=>x.finalize(),codeErr('export-journal-limit'));x.discard();
  assert.deepEqual([...d.mem.data],before);assert.equal(d.mem.getItem(STORE),null);
  // An already known code can still export without another journal.
  await transmit(d,codes[0]);assert.equal(d.mem.length,before.length);
});
test('edition from another file remains pending through import+re-export; unknown versions never attach by catalog ID',async()=>{
  const d=device(),code=generateRecoveryCode(),session=await unlockVault(code);
  const base=await openVault(session,await transmit(d,code)),ed=editionKey('starter-one','e'.repeat(64));
  const remote=editSnapshot(base,newDeviceId(),[progressChange(ed,{chapter:1,paragraph:2,fraction:.1})]);
  d.mem.setItem('folio-v2','{"positions":{"starter-one":{"chapter":99}}}');
  const p=await preview(d,code,await sealVault(session,remote));assert.equal(p.summary.deferred,1);assert.equal(p.summary.progress,0);
  await p.apply(click);assert.equal(d.mem.getItem('folio-v2'),'{"positions":{"starter-one":{"chapter":99}}}');
  assert.deepEqual(await openVault(session,await transmit(d,code)),remote);
});
test('mock GitHub: checked create only, cancellation, conditional overwrite, content-free ciphertext, stale revision and skipped identical writes',async()=>{
  let rev=0,sealed=null,puts=0;const token='synthetic-test-only',repo='tester/folio';let lastOptions;
  function factory(opts){lastOptions=opts;let open=true;return {
    async activate(){return {id:100,branch:'main'}},async read(){assert.ok(open);return sealed?{kind:'found',sealed,revision:String(rev)}:{kind:'missing'}},
    async write(s,options){assert.ok(open);assert.ok(sealed?options.revision===String(rev):options.allowCreate===true);
      assert.doesNotMatch(s,/cloudword|synthetic-test-only/);sealed=s;rev++;puts++},disconnect(){open=false}}}
  const d=device(['cloudword'],new Mem(),new Locks(),factory),code=generateRecoveryCode(),opts={repo,token,code};
  let p=await d.ctl.previewGithub(opts);assert.equal(p.kind,'create');assert.equal(puts,0);p.discard();
  p=await d.ctl.previewGithub(opts);await p.apply(click);assert.equal(puts,1);
  assert.ok(!d.mem.getItem(STORE).includes(token));assert.ok(!d.mem.getItem(STORE).includes(code));
  p=await d.ctl.previewGithub(opts);assert.equal(p.kind,'unchanged');assert.equal(lastOptions.expectedRepoId,100);assert.equal(lastOptions.expectExisting,true);
  trackWord(d.live,'fern','en',130);d.save();p=await d.ctl.previewGithub(opts);rev++;
  await assert.rejects(()=>p.apply(click),codeErr('stale-revision'));assert.equal(puts,1);
  p=await d.ctl.previewGithub(opts);await p.apply(click);assert.equal(puts,2);
  const other=device([],new Mem(),new Locks(),factory);const wrong=generateRecoveryCode();
  await assert.rejects(()=>other.ctl.previewGithub({...opts,code:wrong}),codeErr('VAULT_AUTH'));assert.equal(puts,2);
});
