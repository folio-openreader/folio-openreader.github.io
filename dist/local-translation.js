// Folio's offline paragraph translator. Only the fixed model files are downloaded.
const ruFiles=[
  {part:'model',path:'model.0.bin.fpack',size:6955578,unpacked:10485760,sha:'34782d135b4ecaa8351bc9564913ef8e1801dbdbd283c29e043fe8424d158527'},
  {part:'model',path:'model.1.bin.fpack',size:7254739,unpacked:10485760,sha:'19a476639c51828f3ee2870d1376dd3c854a1c9d1e37f918c3da9e92b4ee880c'},
  {part:'model',path:'model.2.bin.fpack',size:7685294,unpacked:10485760,sha:'01e51cf78aa02b8cc59c0f54a28bd447b7463b930e6b9a24002b77a475546126'},
  {part:'model',path:'model.3.bin.fpack',size:88733,unpacked:104507,sha:'0ee8cfb8d18965c9c12a47083203acdd62f503de3362da1b71afdcbc41a521f2'},
  {part:'shortlist',path:'lex.50.50.enru.s2t.bin.fpack',size:1376934,unpacked:2774540,sha:'85efe42a8045682500ad5f39bb8d8ce80d83413252213fe7afb2460da0c990db'},
  {part:'vocab',path:'vocab.enru.spm.fpack',size:418611,unpacked:904455,sha:'af1d09023708ac94a7ad89d39b281c4045d4bc8719c9043c70ad5bd0bb6c4e54'}
];
const hiFiles=[
  {part:'model',path:'model.0.bin.fpack',size:7597863,unpacked:10485760,sha:'014e0acdd675d678d3905ae976a30a975ab4dc53198463bdfdb982528552cc24'},
  {part:'model',path:'model.1.bin.fpack',size:5135162,unpacked:6655291,sha:'81c97dde2db3b74645412e3858000e7d18ec2bdb1609b9fe254f27a86cb5c9a1'},
  {part:'shortlist',path:'lex.50.50.enhi.s2t.bin.fpack',size:1643305,unpacked:3504820,sha:'799665873f0b88b6c911ffa76595bea173a01dbb55e042ad1934cf01c52e5459'},
  {part:'vocab',path:'vocab.enhi.spm.fpack',size:427234,unpacked:925360,sha:'20dbd775c08768147361d05808aca791061895c39614c2adc2c40ed078f882c1'}
];

function makePack(source,target,version,files){
  const modelBytes=files.filter(f=>f.part==='model').reduce((n,f)=>n+f.unpacked,0);
  const downloadBytes=files.reduce((n,f)=>n+f.size,0);
  const modelHost=new URL('./vendor/bergamot/model-'+source+target+'/',import.meta.url);
  return Object.freeze({
    pair:Object.freeze({from:source,to:target}),
    info:Object.freeze({source,target,downloadBytes}),
    id:source+'-'+target,
    cacheName:'folio-bergamot-'+source+'-'+target+'-'+version+'-packed',
    modelBytes,modelHost,files:Object.freeze(files.map(file=>Object.freeze(file))),
  });
}
const packs=Object.freeze({
  'en-ru':makePack('en','ru','2.1',ruFiles),
  'en-hi':makePack('en','hi','1.0',hiFiles),
});
const primaryLang=value=>typeof value==='string'?value.toLowerCase().split('-')[0]:'';
const modelPack=(source,target)=>packs[primaryLang(source)+'-'+primaryLang(target)]||null;
const MAX_PARAGRAPH=24000, CHUNK=1200, MAX_RESULTS=120, MAX_CACHE_CHARS=260000;
const MODEL_READ_AHEAD=2;
const abort=()=>new DOMException('Translation cancelled','AbortError');

export function translationPack(source,target='ru'){
  return modelPack(source,target)?.info||null;
}
export function supportsTranslation(source,target='ru'){
  return !!modelPack(source,target);
}
export function splitTranslationText(text,limit=CHUNK){
  if(typeof text!=='string'||!text.trim())throw new Error('empty');
  if(!Number.isInteger(limit)||limit<2)throw new RangeError('limit');
  if(text.length>MAX_PARAGRAPH)throw new Error('length');
  let rest=text.trim(),parts=[];
  while(rest.length>limit){
    const head=rest.slice(0,limit);
    const sentence=[...head.matchAll(/[.!?…][”’"»)]*\s+/gu)].at(-1);
    const space=[...head.matchAll(/\s+/gu)].at(-1);
    let cut=sentence?.index>limit/3?sentence.index+sentence[0].length:space?.index>0?space.index:limit;
    if(/[\uD800-\uDBFF]$/.test(rest.slice(0,cut))&&/^[\uDC00-\uDFFF]/.test(rest.slice(cut)))cut--;
    parts.push(rest.slice(0,cut).trim());rest=rest.slice(cut).trimStart();
  }
  if(rest)parts.push(rest);return parts;
}

function rpc(worker){
  let id=0,closed=null;const pending=new Map();
  function close(error=abort()){
    if(closed)return;closed=error;
    worker.terminate();
    for(const {reject,timer} of pending.values()){clearTimeout(timer);reject(error)}
    pending.clear();
  }
  worker.addEventListener('message',({data})=>{
    const job=pending.get(data?.id);if(!job)return;
    pending.delete(data.id);clearTimeout(job.timer);
    if(data.error)job.reject(new Error(data.error.message||'engine'));else job.resolve(data.result);
  });
  worker.addEventListener('error',()=>close(new Error('engine')));
  worker.addEventListener('messageerror',()=>close(new Error('engine')));
  function call(name,args,transfer=[]){
    if(closed)return Promise.reject(closed);
    return new Promise((resolve,reject)=>{
      const key=++id,timer=setTimeout(()=>close(new Error('engine-timeout')),90000);
      pending.set(key,{resolve,reject,timer});
      try{worker.postMessage({id:key,name,args},transfer)}catch(e){clearTimeout(timer);pending.delete(key);reject(e)}
    });
  }
  return {call,close,get closed(){return !!closed}};
}

async function openModelCache(pack){try{return await globalThis.caches?.open(pack.cacheName)}catch{return undefined}}
async function unpack(packed,expected){
  const raw=await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  if(raw.byteLength!==expected)throw new Error('invalid-model');
  return raw;
}
// These pinned paths are on Folio itself, not on the upstream model CDN.
export async function fetchModelShard(file,{source='en',target='ru',signal,fetcher=globalThis.fetch}={}){
  const pack=modelPack(source,target);
  if(!pack)throw new Error('unsupported');
  const host=pack.modelHost;
  const url=new URL(file.path,host);
  if(url.origin!==host.origin||url.href!==host.href+file.path)throw new Error('download-path');
  let response;
  try{
    response=await fetcher(url.href,{mode:'same-origin',credentials:'same-origin',redirect:'manual',referrerPolicy:'no-referrer',signal});
  }catch(e){if(signal?.aborted)throw e;throw new Error('download-network')}
  if(response.status===401||response.status===403||response.type==='opaqueredirect')throw new Error('download-auth');
  if(!response.ok)throw new Error('download-http');
  let bytes;
  try{bytes=await response.arrayBuffer()}catch(e){if(signal?.aborted)throw e;throw new Error('download-network')}
  if(bytes.byteLength!==file.size||!await validHash(bytes,file.sha))throw new Error('download-integrity');
  return bytes;
}
async function validHash(bytes,sha){
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('')===sha;
}
async function getPackedModelFile(pack,file,cache,allowNetwork,signal){
  if(signal.aborted)throw abort();
  const url=pack.modelHost.href+file.path;
  let hadEntry=false;
  try{
    const hit=await cache?.match(url);
    if(hit){
      hadEntry=true;
      const bytes=await hit.arrayBuffer();
      if(bytes.byteLength===file.size&&await validHash(bytes,file.sha))return {bytes,cached:true};
    }
  }catch{}
  if(signal.aborted)throw abort();
  if(hadEntry)try{await cache.delete(url)}catch{} // evict only the corrupt pinned asset
  if(!allowNetwork)throw new Error('not-installed');
  if(signal.aborted)throw abort();
  return {bytes:await fetchModelShard(file,{source:pack.info.source,target:pack.info.target,signal}),cached:false};
}
async function loadModelBuffers(pack,cache,allowNetwork,signal,onProgress){
  const {files,modelBytes,modelHost,info}=pack;
  const parts={model:new ArrayBuffer(modelBytes)},outstanding=new Map();
  const model=new Uint8Array(parts.model);
  let written=0,done=0,next=0;
  const total=info.downloadBytes;
  const check=()=>{if(signal.aborted)throw abort()};
  const enqueue=()=>{
    const index=next++,file=files[index];
    // Posted promises resolve even on failure; every error is handled in model order.
    outstanding.set(index,getPackedModelFile(pack,file,cache,allowNetwork,signal).then(value=>({value}),error=>({error})));
  };
  check();
  onProgress(0,total);
  while(next<Math.min(MODEL_READ_AHEAD,files.length))enqueue();
  for(let index=0;index<files.length;index++){
    const file=files[index],outcome=await outstanding.get(index);
    outstanding.delete(index);check();
    if(outcome.error)throw outcome.error;
    // Keep at most two compressed shards in flight and only one inflated
    // scratch buffer in addition to the fixed final model allocation.
    const {bytes,cached}=outcome.value,raw=await unpack(bytes,file.unpacked);check();
    if(file.part==='model'){model.set(new Uint8Array(raw),written);written+=file.unpacked}
    else parts[file.part]=raw;
    done+=file.size;onProgress(done,total);check();
    if(!cached)try{await cache?.put(modelHost.href+file.path,new Response(bytes))}catch{}
    check();
    if(next<files.length)enqueue();
  }
  return parts;
}

export function createLocalTranslator(){
  let client=null,preparing=null,boundPack=null,download=null,epoch=0,idleTimer=0,active=0,cacheChars=0;
  const results=new Map(),inFlight=new Map();
  const capabilities=()=>typeof Worker==='function'&&typeof WebAssembly==='object'&&typeof DecompressionStream==='function'&&!!globalThis.crypto?.subtle;
  const stop=()=>{
    ++epoch;clearTimeout(idleTimer);download?.abort();download=null;
    client?.close();client=null;preparing=null;boundPack=null;inFlight.clear();
  };
  const idle=()=>{clearTimeout(idleTimer);if(client&&!active&&!preparing)idleTimer=setTimeout(stop,90000)};
  async function modelStorage({source='en',target='ru'}={}){
    const pack=modelPack(source,target);
    if(!pack)return null;
    const {downloadBytes:totalBytes}=pack.info;
    const unavailable={state:'unavailable',cachedBytes:0,totalBytes};
    if(typeof globalThis.caches?.match!=='function')return unavailable;
    try{
      // A status check must not create an empty cache or read model bodies.
      // The loader verifies every shard's length and hash before using it.
      const found=await Promise.all(pack.files.map(file=>globalThis.caches.match(pack.modelHost.href+file.path,{cacheName:pack.cacheName})));
      const cachedBytes=pack.files.reduce((total,file,i)=>total+(found[i]?file.size:0),0);
      return {state:cachedBytes===totalBytes?'cached':cachedBytes?'partial':'missing',cachedBytes,totalBytes};
    }catch{return unavailable}
  }
  async function installed(pair){
    return (await modelStorage(pair))?.state==='cached';
  }
  function prepare(pack,{allowNetwork=false,onProgress=()=>{}}={}){
    if(client&&!client.closed&&!preparing)return Promise.resolve(client);
    if(preparing){
      // An explicit tap may arrive while an offline-only lookup discovers
      // a missing shard. Retry once with that caller's opt-in.
      const pending=preparing,seq=epoch;
      return allowNetwork?pending.catch(error=>{
        if(seq===epoch&&error.message==='not-installed')return prepare(pack,{allowNetwork,onProgress});
        throw error;
      }):pending;
    }
    if(!capabilities())return Promise.reject(new Error('unsupported'));
    const seq=epoch,controller=download=new AbortController();
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort()},160000);
    const task=(async()=>{
      let worker;
      try{worker=new Worker(new URL('./vendor/bergamot/translator-worker.js',import.meta.url))}
      catch(e){throw new Error('engine-init',{cause:e})}
      const instance=client=rpc(worker);
      const initialize=instance.call('initialize',[{cacheSize:0,useNativeIntGemm:false}]).catch(e=>{
        if(e.name==='AbortError')throw e;
        throw new Error('engine-init');
      });
      // Fetching and verifying shards need not wait for WASM compilation.
      const load=openModelCache(pack).then(cache=>loadModelBuffers(pack,cache,allowNetwork,controller.signal,onProgress));
      const [,parts]=await Promise.all([initialize,load]);
      if(seq!==epoch||controller.signal.aborted)throw abort();
      await instance.call('loadTranslationModel',[pack.pair,{model:parts.model,shortlist:parts.shortlist,vocabs:[parts.vocab]}],Object.values(parts));
      if(seq!==epoch)throw abort();
      return instance;
    })().catch(error=>{
      controller.abort();
      if(seq===epoch){client?.close();client=null}
      if(timedOut&&error.name==='AbortError')throw new Error('download-timeout');
      throw error;
    }).finally(()=>{
      clearTimeout(timer);
      if(preparing===task){preparing=null;download=null;idle()}
    });
    preparing=task;return task;
  }

  const resultKey=(pack,text)=>pack.id+'\u0000'+text;
  function cachedValue(key){
    if(!results.has(key))return undefined;
    const value=results.get(key);
    results.delete(key);results.set(key,value);
    return value;
  }
  function peek(text,{source='en',target='ru'}={}){
    const pack=modelPack(source,target);
    return pack?cachedValue(resultKey(pack,text)):undefined;
  }
  function remember(key,target){
    const cost=key.length+target.length;
    if(cost>MAX_CACHE_CHARS)return;
    if(results.has(key)){cacheChars-=key.length+results.get(key).length;results.delete(key)}
    results.set(key,target);cacheChars+=cost;
    while(results.size>MAX_RESULTS||cacheChars>MAX_CACHE_CHARS){
      const [oldKey,val]=results.entries().next().value;results.delete(oldKey);cacheChars-=oldKey.length+val.length;
    }
  }
  function translate(text,{source='en',target='ru',allowNetwork=false,onProgress,signal}={}){
    if(signal?.aborted)return Promise.reject(abort());
    const pack=modelPack(source,target);
    if(!pack)return Promise.reject(new Error('unsupported'));
    const result=resultKey(pack,text);
    if(results.has(result))return Promise.resolve(cachedValue(result));
    let parts;try{parts=splitTranslationText(text)}catch(error){return Promise.reject(error)}
    // An explicit switch replaces the previous runtime so two models never stay resident.
    if(boundPack&&boundPack!==pack)stop();
    boundPack=pack;
    // A caller's AbortSignal must not cancel another caller's same-text job.
    const key=signal?null:(allowNetwork?'explicit:':'offline:')+result;
    if(key&&inFlight.has(key))return inFlight.get(key);
    active++;clearTimeout(idleTimer);
    const seq=epoch;let instance;
    const task=(async()=>{
      instance=await prepare(pack,{allowNetwork,onProgress});const output=[];
      for(const chunk of parts){
        if(signal?.aborted||seq!==epoch)throw abort();
        const [translation]=await instance.call('translate',[{models:[pack.pair],texts:[{text:chunk,html:false,qualityScores:false}]}]);
        if(typeof translation?.target?.text!=='string'||!translation.target.text.trim())throw new Error('engine-empty');
        output.push(translation.target.text.trim());
      }
      if(signal?.aborted||seq!==epoch)throw abort();
      const value=output.join(' ');remember(result,value);return value;
    })().catch(error=>{
      if(error.name!=='AbortError'&&seq===epoch&&instance&&client===instance){client.close();client=null}
      throw error;
    }).finally(()=>{if(key&&inFlight.get(key)===task)inFlight.delete(key);active--;idle()});
    if(key)inFlight.set(key,task);return task;
  }

  return {capabilities,installed,modelStorage,translate,peek,stop};
}
