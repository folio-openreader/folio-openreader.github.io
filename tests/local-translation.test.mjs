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
  let pendingFetches=0,maxFetches=0,offline=false,releaseInit;
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
        if(name==='translate')assert.deepEqual(args[0].models,[this.pair]);
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
  const translator=createLocalTranslator();
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
});
