import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalTranslator} from '../dist/local-translation.js';
import {modelStatusLabel,modelDownloadLabel} from '../dist/translation-storage.js';

test('cache meter only observes pinned entries for each pair, never opening or reading caches',async t=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'caches');
  t.after(()=>previous?Object.defineProperty(globalThis,'caches',previous):delete globalThis.caches);
  const names=[],present=new Set();let deny=false;
  Object.defineProperty(globalThis,'caches',{configurable:true,value:{
    open:()=>assert.fail('Status opened a cache'),
    match:async (url,{cacheName})=>{
      if(deny)throw new Error('private browsing');
      names.push([url,cacheName]);
      return present.has(cacheName+url)?{arrayBuffer:()=>assert.fail('Status read shard bytes')}:undefined;
    }}});
  const measure=createLocalTranslator().modelStorage;
  assert.deepEqual(await measure(),{state:'missing',cachedBytes:0,totalBytes:23779889});
  const ru=names.splice(0);
  assert.equal(ru.length,6);
  present.add(ru[0][1]+ru[0][0]);
  assert.deepEqual(await measure(),{state:'partial',cachedBytes:6955578,totalBytes:23779889});
  assert.deepEqual(await measure({target:'hi-IN'}),{state:'missing',cachedBytes:0,totalBytes:14803564});
  assert.equal(names.at(-1)[1],'folio-bergamot-en-hi-1.0-packed');
  for(const [url,cache] of ru)present.add(cache+url);
  assert.deepEqual(await measure(),{state:'cached',cachedBytes:23779889,totalBytes:23779889});
  assert.equal(await measure({target:'es'}),null);
  deny=true;
  assert.deepEqual(await measure(),{state:'unavailable',cachedBytes:0,totalBytes:23779889});
});

test('paused downloads show remaining bytes without treating a partial model as usable',()=>{
  const partial={state:'partial',cachedBytes:2*1024**2,totalBytes:10*1024**2};
  assert.equal(modelStatusLabel(partial),'2 МБ из 10 МБ');
  assert.equal(modelDownloadLabel(partial),'Докачать · 8 МБ');
  assert.equal(modelDownloadLabel({...partial,state:'cached'}),'Перевести на устройстве');
  assert.equal(modelStatusLabel({...partial,state:'unavailable'}),'Не удалось проверить');
});
