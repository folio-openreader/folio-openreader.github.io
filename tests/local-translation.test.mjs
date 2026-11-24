import test from 'node:test';
import assert from 'node:assert/strict';
import {splitTranslationText,supportsTranslation,translationPack,createLocalTranslator} from '../dist/local-translation.js';

test('model language pair is explicit and does not guess known French or Russian',()=>{
  for(const value of ['en','EN','en-US'])assert.equal(supportsTranslation(value),true);
  for(const value of ['enx','fr','ru','und-Latn',null])assert.equal(supportsTranslation(value),false);
  assert.equal(supportsTranslation('en','es'),false);
  assert.equal(supportsTranslation('hi','ru'),false);
  assert.deepEqual(translationPack('en-US','hi-IN'),{source:'en',target:'hi',downloadBytes:14803564});
  assert.deepEqual(translationPack('EN'),{source:'en',target:'ru',downloadBytes:23779889});
  assert.equal(translationPack('hi','en'),null);
});
test('long paragraphs split at sentence or word boundaries without losing content',()=>{
  const source='Mary was tired. The garden was dark. She kept reading.';
  const parts=splitTranslationText(source,24);
  assert.deepEqual(parts,['Mary was tired.','The garden was dark.','She kept reading.']);
  assert.equal(parts.join(' '),source);
  assert.deepEqual(splitTranslationText('abcd🙂hello',5),['abcd','🙂hel','lo']);
  assert.throws(()=>splitTranslationText('a'.repeat(24001)),/length/);
  assert.throws(()=>splitTranslationText(' '),/empty/);
});
test('no worker means no model request',async ()=>{
  const translator=createLocalTranslator();
  if(translator.capabilities())return;
  await assert.rejects(translator.translate('hello'),/unsupported/);
  assert.equal(await translator.installed(),false);
  translator.stop();
});

test('private Folio model request keeps the same-origin login and verifies bytes',async ()=>{
  const {fetchModelShard}=await import('../dist/local-translation.js');
  const bytes=new TextEncoder().encode('abc');
  const file={path:'pinned-test.fpack',size:3,sha:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'};
  let calls=0;
  const gatedFetcher=async(url,options)=>{
    calls++;
    assert.match(url,/\/vendor\/bergamot\/model-enru\/pinned-test\.fpack$/);
    assert.equal(options.mode,'same-origin');
    assert.equal(options.redirect,'manual');
    if(options.credentials!=='same-origin')return new Response('<html>Log in</html>',{status:401});
    return new Response(bytes);
  };
  assert.deepEqual(new Uint8Array(await fetchModelShard(file,{fetcher:gatedFetcher})),bytes);
  assert.equal(calls,1);
  await assert.rejects(fetchModelShard(file,{fetcher:async()=>new Response('Log in',{status:401})}),/download-auth/);
  await assert.rejects(fetchModelShard(file,{fetcher:async()=>new Response('bad')}),/download-integrity/);
  await assert.rejects(fetchModelShard(file,{fetcher:async()=>{throw new TypeError('offline')}}),/download-network/);
  await assert.rejects(fetchModelShard({...file,path:'https://example.com/model'},{fetcher:gatedFetcher}),/download-path/);
  assert.equal(calls,1);
});

test('installation overlaps exactly two private reads with engine startup, then stays local and recovers from failed runtime and cache',{timeout:15000},async t=>{
  const {readFile}=await import('node:fs/promises');
  const globals=['Worker','caches','fetch'];
  const old=Object.fromEntries(globals.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const override=(k,value)=>Object.defineProperty(globalThis,k,{configurable:true,writable:true,value});
  t.after(()=>globals.forEach(k=>old[k]?Object.defineProperty(globalThis,k,old[k]):delete globalThis[k]));
  const cached=new Map(),cacheKeys=new Set(),workers=[],progress=[],starts=[],calls=[];
  let pendingFetches=0,maxFetches=0,offline=false,releaseInit,nextTranslationGate;
  const firstInit=new Promise(resolve=>releaseInit=resolve);
  const shardRoot=new URL('../dist/vendor/bergamot/',import.meta.url);
  class MockWorker extends EventTarget{
    constructor(){super();this.index=workers.length;workers.push(this)}
    terminate(){this.terminated=true}
    postMessage({id,name,args},transfer){
      calls.push([this.index,name]);
      void (async()=>{
        if(name==='initialize'&&!this.index)await firstInit;
        if(this.terminated)return;
        if(name==='loadTranslationModel'){
          const data=args[1];
          this.pair=args[0];
          const hindi=this.pair.to==='hi';
          assert.equal(data.model.byteLength,hindi?17141051:31561787);
          assert.equal(data.shortlist.byteLength,hindi?3504820:2774540);
          assert.equal(data.vocabs[0].byteLength,hindi?925360:904455);
          assert.equal(transfer.length,3);
        }
        if(name==='translate'){
          assert.deepEqual(args[0].models,[this.pair]);
          if(nextTranslationGate){const gate=nextTranslationGate;nextTranslationGate=null;gate.started();await gate.wait}
        }
        const result=name==='translate'?[{target:{text:this.pair.to==='hi'?'उपकरण पर':'На устройстве'}}]:undefined;
        this.dispatchEvent(new MessageEvent('message',{data:{id,result}}));
      })().catch(()=>this.dispatchEvent(new Event('error')));
    }
  }
  override('Worker',MockWorker);
  override('caches',{match:async(url,{cacheName})=>cacheKeys.has(cacheName)&&cached.has(url)?new Response(cached.get(url)):undefined,open:async key=>{
    cacheKeys.add(key);
    return {
      match:async url=>cached.has(url)?new Response(cached.get(url)):undefined,
      put:async(url,response)=>cached.set(url,await response.arrayBuffer()),
      delete:async url=>cached.delete(url)
    };
  }});
  override('fetch',async (url,options)=>{
    starts.push(url);
    assert.equal(options.credentials,'same-origin');
    assert.equal(options.mode,'same-origin');
    if(offline)throw new Error('offline');
    // Startup waits for two requests. A serialized installer cannot pass.
    if(starts.length===2)releaseInit();
    ++pendingFetches;maxFetches=Math.max(maxFetches,pendingFetches);
    try{return new Response(await readFile(new URL(new URL(url).pathname.split('/').slice(-2).join('/'),shardRoot)))}
    finally{--pendingFetches}
  });
  const disk=new Map();
  let lock=Promise.resolve(),id=0,lockGate;
  const storage=()=>({getItem:key=>disk.get(key),setItem:(key,value)=>disk.set(key,value),removeItem:key=>disk.delete(key)});
  const diskOpts={storage,uuid:()=>String(++id),locks:()=>({request(_name,fn){const gate=lockGate;lockGate=null;const next=lock.then(async()=>{if(gate){gate.started();await gate.wait}return fn()});lock=next.catch(()=>{});return next}})};
  const translator=createLocalTranslator(diskOpts);
  t.after(()=>{releaseInit();translator.stop()});
  assert.equal(await translator.translate('first paragraph',{allowNetwork:true,onProgress:(...p)=>progress.push(p)}),'На устройстве');
  assert.equal(starts.length,6);assert.equal(maxFetches,2);
  assert.deepEqual(progress.at(-1),[23779889,23779889]);
  assert.equal(await translator.installed(),true);
  offline=true;
  workers.at(-1).dispatchEvent(new Event('error')); // fatal while idle
  assert.equal(await translator.translate('next paragraph'),'На устройстве');
  assert.equal(starts.length,6);
  assert.equal(workers.length,2);
  assert.equal(workers[0].terminated,true);
  assert.equal(await translator.translate('first paragraph'),'На устройстве');
  assert.equal(calls.filter(([,name])=>name==='translate').length,2);
  translator.stop();
  const key=starts.at(-1);
  cached.set(key,new Uint8Array(cached.get(key).byteLength)); // length alone must not be accepted
  await assert.rejects(translator.translate('another paragraph'),/not-installed/);
  assert.equal(await translator.installed(),false);
  assert.equal(starts.length,6);
  offline=false;
  assert.equal(await translator.translate('another paragraph',{allowNetwork:true}),'На устройстве');
  assert.equal(starts.length,7);
  assert.equal(starts.at(-1),key);

  const hindi={source:'en-US',target:'hi-IN'};
  assert.equal(await translator.installed(hindi),false);
  assert.equal(translator.peek('first paragraph',hindi),undefined);
  assert.equal(await translator.translate('first paragraph',{...hindi,allowNetwork:true,onProgress:(...p)=>progress.push(p)}),'उपकरण पर');
  assert.equal(await translator.installed(hindi),true);
  assert.equal(await translator.installed(),true);
  assert.deepEqual([...cacheKeys].sort(),['folio-bergamot-en-hi-1.0-packed','folio-bergamot-en-ru-2.1-packed']);
  assert.equal(starts.length,11);assert.equal(starts.filter(u=>u.includes('/model-enhi/')).length,4);
  assert.deepEqual(progress.at(-1),[14803564,14803564]);
  assert.equal(workers.filter(w=>!w.terminated).length,1);
  assert.equal(translator.peek('first paragraph'),'На устройстве');
  assert.equal(translator.peek('first paragraph',hindi),'उपकरण पर');
  offline=true;
  assert.equal(await translator.translate('a new Russian paragraph'),'На устройстве');
  assert.equal(starts.length,11);
  assert.equal(workers.filter(w=>!w.terminated).length,1);
  await assert.rejects(translator.translate('Test',{source:'hi',target:'en',allowNetwork:true}),/unsupported/);
  assert.equal(starts.length,11);

  await translator.translate('chapter paragraph',{scope:'book-a'});
  const blackHole=()=>({getItem(){throw new Error('cannot read')},setItem(){throw new DOMException('full','QuotaExceededError')}});
  const noDisk=createLocalTranslator({storage:blackHole});
  t.after(()=>noDisk.stop());
  assert.equal(await noDisk.translate('new fallback paragraph'),'На устройстве');
  assert.equal(noDisk.peek('new fallback paragraph'),'На устройстве');
  assert.equal(createLocalTranslator({storage:blackHole}).peek('new fallback paragraph'),undefined);
  function holdNext(){
    let started,release;
    const began=new Promise(resolve=>started=resolve);
    const wait=new Promise(resolve=>release=resolve);
    nextTranslationGate={started,wait};return {began,release};
  }
  const remover=createLocalTranslator(diskOpts);
  const deletion=holdNext(),stale=translator.translate('delete me in flight',{scope:'deleted-book'});
  const rejected=assert.rejects(stale,{name:'AbortError'});
  await deletion.began;await remover.forgetScope('deleted-book');
  deletion.release();await rejected;
  assert.equal(remover.peek('delete me in flight',{scope:'deleted-book'}),undefined);
  assert.doesNotMatch([...disk.values()].join(),/delete me in flight/);
  await assert.rejects(translator.translate('new work for deleted book',{scope:'deleted-book'}),{name:'AbortError'});
  const returned=holdNext(),preRestore=translator.translate('pre-delete bytes',{scope:'readded-book'});
  const refused=assert.rejects(preRestore,{name:'AbortError'});
  await returned.began;await remover.forgetScope('readded-book');await remover.restoreScope('readded-book');
  returned.release();await refused;
  assert.doesNotMatch([...disk.values()].join(),/pre-delete bytes/);
  assert.equal(await translator.translate('fresh catalog bytes',{scope:'readded-book'}),'На устройстве');
  const clear=holdNext(),pending=translator.translate('keep cleared',{scope:'clear-book'});
  const rejectedClear=assert.rejects(pending,{name:'AbortError'});
  await clear.began;
  const oldDisk=new Map(disk);disk.clear();
  clear.release();await rejectedClear;
  assert.equal(disk.size,0);
  assert.equal(translator.peek('first paragraph'),undefined);
  // Existing below exercises normal cold cache reuse, independently of the clear.
  for(const [k,v] of oldDisk)disk.set(k,v);
  const live=new Map(disk);
  const clearBetweenValidationAndWrite=createLocalTranslator({...diskOpts,storage:()=>({...storage(),setItem(key,value){
    if(key==='folio-local-paragraphs-v2')disk.clear();
    disk.set(key,value);
  }})});
  t.after(()=>clearBetweenValidationAndWrite.stop());
  await assert.rejects(clearBetweenValidationAndWrite.translate('cleared in commit',{scope:'race'}),{name:'AbortError'});
  assert.equal(disk.size,0);
  for(const [k,v] of live)disk.set(k,v);
  function holdLock(){
    let started,release;
    const began=new Promise(resolve=>started=resolve);
    const wait=new Promise(resolve=>release=resolve);
    lockGate={started,wait};return {began,release};
  }
  const beforeCalls=calls.length;
  const beforeLock=holdLock(),queued=translator.translate('must not re-create cleared storage',{scope:'pre-lock'});
  const canceled=assert.rejects(queued,{name:'AbortError'});
  await beforeLock.began;disk.clear();beforeLock.release();await canceled;
  assert.equal(disk.size,0);assert.equal(calls.length,beforeCalls);
  for(const [k,v] of live)disk.set(k,v);
  const changedLock=holdLock(),changed=translator.translate('old text must not enter new generation',{scope:'pre-lock'});
  const changedCanceled=assert.rejects(changed,{name:'AbortError'});
  await changedLock.began;disk.clear();disk.set('folio-local-paragraphs-generation-v2','external-new-generation');
  changedLock.release();await changedCanceled;
  assert.equal(calls.length,beforeCalls);
  assert.deepEqual([...disk.values()],['external-new-generation']);
  disk.clear();
  const signalled=holdLock(),atStartup=translator.translate('new empty but explicitly cleared',{scope:'pre-lock'});
  const emptyCanceled=assert.rejects(atStartup,{name:'AbortError'});
  await signalled.began;translator.invalidateCache();signalled.release();await emptyCanceled;
  assert.equal(disk.size,0);
  const a=createLocalTranslator(diskOpts),b=createLocalTranslator(diskOpts);
  t.after(()=>{a.stop();b.stop()});
  const startup=holdLock(),first=a.translate('first empty result',{scope:'cold-a'});
  await startup.began;const second=b.translate('second empty result',{scope:'cold-b'});startup.release();
  assert.deepEqual(await Promise.all([first,second]),['На устройстве','На устройстве']);
  assert.equal(a.peek('second empty result',{scope:'cold-b'}),'На устройстве');
  assert.equal(b.peek('first empty result',{scope:'cold-a'}),'На устройстве');
  disk.clear();for(const [k,v] of live)disk.set(k,v);
  const numWorkers=workers.length,numCalls=calls.length;
  cached.clear(); // Model was evicted; text results should survive independently.
  const reopened=createLocalTranslator(diskOpts);
  t.after(()=>reopened.stop());
  assert.equal(reopened.peek('first paragraph',{source:'en-GB',target:'ru-RU'}),'На устройстве');
  assert.equal(reopened.peek('first paragraph',hindi),'उपकरण पर');
  assert.equal(await reopened.translate('chapter paragraph',{scope:'book-a'}),'На устройстве');
  assert.equal(reopened.peek('chapter paragraph',{scope:'book-b'}),undefined);
  assert.equal(reopened.peek('chapter paragraph ',{scope:'book-a'}),undefined);
  assert.equal(reopened.peek('chapter paragraph',{scope:'book-a',target:'hi'}),undefined);
  assert.equal(workers.length,numWorkers);
  assert.equal(calls.length,numCalls);
  assert.equal(starts.length,11);
  await reopened.forgetScope('book-a');
  assert.equal(createLocalTranslator(diskOpts).peek('chapter paragraph',{scope:'book-a'}),undefined);
  assert.equal(createLocalTranslator(diskOpts).peek('first paragraph'),'На устройстве');
});
