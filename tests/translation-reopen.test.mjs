import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {translationPack} from '../dist/local-translation.js';

const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const section=app.slice(app.indexOf('const localTranslator=createLocalTranslator();'),app.indexOf('\nfunction renderRibbon(){'));
function session(disk,{ready=false,cached=false,id='book-a',target='ru',quota=false,translate}={}){
  const els={};let panels=0,updates=0,finished=0,writes=0,invalidations=0;
  const listeners=new Map(),timers=new Map(),calls=[];let nextTimer=0;
  const listen=(event,cb)=>{const list=listeners.get(event)||[];list.push(cb);listeners.set(event,list)};
  const emit=(event,detail={})=>{for(const cb of listeners.get(event)||[])cb(detail)};
  const document={hidden:false,addEventListener:listen};
  const get=id=>els[id]??={hidden:false,addEventListener(){},open:false};
  const book={id,chapters:[{paragraphs:[{text:'Fictional paragraph'}]}]};
  const localStorage={getItem:key=>disk.get(key),setItem:(key,value)=>{if(quota)throw new DOMException('เต็ม','QuotaExceededError');disk.set(key,value);writes++}};
  const scope={
    current:book,chapter:0,paragraph:0,state:{prefs:{dictionaryTarget:target}},
    readingSourceLanguage:()=> 'en',sourceLanguage:t=>t&&'en',localStorage,storedValue:localStorage.getItem,translationPack,
    supportsTranslation:(from,to)=>!!translationPack(from,to),
    createLocalTranslator:()=>({peek:()=>cached?'Перевод':null,installed:async()=>typeof ready==='function'?ready():ready,capabilities:()=>true,translate:async(_text,opts)=>{finished++;calls.push(opts.allowNetwork);return translate?.(opts)},forgetScope(){},invalidateCache(){invalidations++},stop(){}}),
    $:get,window:{addEventListener:listen},document,
    setTimeout(cb){const id=++nextTimer;timers.set(id,cb);return id},clearTimeout:id=>timers.delete(id),
    syncTranslation:()=>updates++,ribbonManual:false,
  };
  const context={...scope,markPanel:()=>panels++};
  runInNewContext(section+'\nopenLocalDialog=()=>markPanel();\nglobalThis.readMode=()=>localEnabled(currentLocalTarget());\nglobalThis.auto=()=>{queueLocal(currentLocalTarget());return pumpLocal()};\nglobalThis.removeBook=forgetLocalBook;globalThis.setup=()=>{localDialogTarget=currentLocalTarget();return $("#local-translation-start").onclick()};',context);
  return {tap:()=>get('#local-translation-open').onclick(),mode:context.readMode,auto:context.auto,setup:context.setup,hide(events=['visibilitychange','pagehide']){document.hidden=true;for(const event of events)emit(event)},
    show(){document.hidden=false;emit('pageshow',{persisted:true});emit('visibilitychange')},
    async flush(){for(const [id,cb] of [...timers])if(timers.delete(id))await cb()},
    calls,writes:()=>writes,invalidations:()=>invalidations,clear(){disk.clear();emit('storage',{key:null})},switchBook:id=>{context.current={...book,id}},remove:context.removeBook,switchTarget:value=>scope.state.prefs.dictionaryTarget=value,stats:()=>({panels,updates,finished})};
}
test('paragraph mode survives fresh reading sessions, supports Pause and respects book/model pair',async()=>{
  const disk=new Map();
  const first=session(disk,{ready:true});
  assert.equal(first.mode(),false);
  await first.tap();assert.equal(first.mode(),true);assert.equal(first.stats().panels,0);
  const next=session(disk,{cached:true,target:'ru-RU'});
  assert.equal(next.mode(),true);
  await next.auto();assert.equal(next.stats().finished,0);
  await next.tap();assert.equal(next.mode(),false);
  assert.equal(session(disk,{ready:true}).mode(),false);
  await session(disk,{ready:true}).tap();
  assert.equal(session(disk,{target:'hi-IN'}).mode(),false);
  assert.equal(session(disk,{id:'book-b'}).mode(),false);
  const evicted=session(disk);
  await evicted.auto();assert.equal(evicted.stats().finished,0);assert.equal(evicted.stats().panels,0);
  const neverEnabled=session(disk,{id:'another-book'});
  await neverEnabled.tap();assert.equal(neverEnabled.mode(),false);assert.equal(neverEnabled.stats().panels,1);
  session(disk).remove('book-a');assert.equal(session(disk,{ready:true}).mode(),false);
  await session(disk,{ready:true}).tap();
  disk.clear();assert.equal(session(disk,{ready:true}).mode(),false);
});

test('no stale install click enables a new language or opens setup after scope changes',async()=>{
  const disk=new Map();let release;
  const page=session(disk,{ready:()=>new Promise(resolve=>{release=resolve})});
  const tapping=page.tap();
  page.switchTarget('hi');release(false);await tapping;
  assert.equal(page.mode(),false);assert.equal(page.stats().panels,0);
  assert.equal(session(disk,{ready:true,target:'ru'}).mode(),false);
});

test('quota failure keeps the explicit mode usable in this session but not after reopen',async()=>{
  const disk=new Map(),page=session(disk,{ready:true,quota:true});
  await page.tap();await page.auto();
  assert.equal(page.mode(),true);assert.equal(page.stats().finished,1);assert.equal(page.stats().panels,0);
  assert.equal(session(disk,{ready:true}).mode(),false);
});

function pending(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
const modes=()=>new Map([['folio-local-translation-mode-v1',JSON.stringify([JSON.stringify(['book-a','en','ru'])])]]);
test('late installed check cannot start work after hide; foreground resumes offline exactly once',async()=>{
  const check=pending();let probes=0;
  const h=session(modes(),{ready:()=>++probes===1?check.promise:true});
  const auto=h.auto();
  h.hide();check.resolve(true);await auto;
  assert.deepEqual(h.calls,[]);assert.equal(h.stats().panels,0);assert.equal(h.writes(),0);
  h.show();await h.flush();
  assert.deepEqual(h.calls,[false]);assert.equal(h.stats().panels,0);assert.equal(h.writes(),0);
});
test('pending enable tap does not open setup or enable a book after hide or warm return',async()=>{
  for(const status of [false,true]){
    const check=pending(),h=session(new Map(),{ready:()=>check.promise});
    const tap=h.tap();h.hide();h.show();check.resolve(status);await tap;await h.flush();
    assert.equal(h.stats().panels,0);assert.equal(h.writes(),0);assert.equal(h.mode(),false);assert.deepEqual(h.calls,[]);
  }
});
test('a queued explicit download does not restart automatically after hiding; Pause stays paused',async()=>{
  const h=session(modes(),{ready:true});h.setup();h.hide();h.show();await h.flush();
  assert.deepEqual(h.calls,[false]); // current installed pack, never a restart of the authorized download
  await h.tap();assert.equal(h.mode(),false);
  h.hide();h.show();await h.flush();assert.deepEqual(h.calls,[false]);
});

test('resumed current probe is independent of unresolved old probe',async()=>{
  const old=pending(),fresh=pending();let probes=0;
  const h=session(modes(),{ready:()=>++probes===1?old.promise:fresh.promise});
  const before=h.auto();h.hide(['pagehide']);h.show();
  const after=h.flush();assert.equal(probes,2);
  old.resolve(true);await before;assert.deepEqual(h.calls,[]);
  fresh.resolve(true);await after;assert.deepEqual(h.calls,[false]);
});
test('automatic check waits only for the current book and target language',async()=>{
  for(const change of [h=>h.switchBook('book-b'),h=>h.switchTarget('hi')]){
    const checked=pending(),h=session(modes(),{ready:()=>checked.promise});
    const before=h.auto();change(h);checked.resolve(true);await before;
    assert.deepEqual(h.calls,[]);assert.equal(h.writes(),0);assert.equal(h.stats().panels,0);
  }
});
test('an active explicit job hidden before completion does not re-request its download',async()=>{
  const job=pending(),h=session(modes(),{ready:false,translate:()=>job.promise});
  h.setup();const first=h.flush();
  assert.deepEqual(h.calls,[true]);h.hide(['visibilitychange']);h.show();
  await h.flush();assert.deepEqual(h.calls,[true]);assert.equal(h.stats().panels,0);
  const oldWrites=h.writes();job.resolve();await first;
  assert.equal(h.writes(),oldWrites);assert.deepEqual(h.calls,[true]);assert.equal(h.stats().panels,0);
});

test('a storage clear invalidates a scheduled check and resets inherited automatic mode without writing storage',async()=>{
  const check=pending(),h=session(modes(),{ready:()=>check.promise});
  const before=h.auto();
  h.clear();check.resolve(true);await before;
  assert.equal(h.invalidations(),1);assert.equal(h.mode(),false);
  assert.equal(h.writes(),0);assert.equal(h.stats().panels,0);assert.deepEqual(h.calls,[]);
});
