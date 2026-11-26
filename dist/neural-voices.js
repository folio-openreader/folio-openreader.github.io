import {assets} from './neural-assets.js';
const root=new URL('./voices/en-v1/',import.meta.url),marker=new URL('installed',root).href;
const pack='folio-voices-en-pcm1:'+root.pathname;
export const downloadBytes=assets.reduce((sum,a)=>sum+a.bytes,0);
export const narrators=['Bella','Jasper','Luna','Bruno'];
export const uri=name=>'folio:en-v1:'+name.toLowerCase();
export function isEnglish(language){
  try{const l=new Intl.Locale(String(language||'').replaceAll('_','-'));return l.language==='en'&&l.maximize().script==='Latn'}catch{return false}
}
export const narrator=(language,id)=>isEnglish(language)&&narrators.find(n=>uri(n)===id)||'';
// Storage probes are advisory. An unavailable local pack must not overwrite
// the chosen voice or require an async wait before native speech on a tap.
const packAvailability=new WeakMap();
export function setVoicePackAvailability(host,available){packAvailability.set(host,available)}
export const availableNarrator=(host,language,id)=>packAvailability.get(host)===false?'':narrator(language,id);
// Tiny no-import module: (func (result v128) i32.const 0 i8x16.splat).
const simdProbe=Uint8Array.of(0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,8,1,6,0,65,0,253,15,11);
const features=new WeakMap();
function hasSimd(wasm){if(!wasm?.validate)return false;if(!features.has(wasm))features.set(wasm,wasm.validate(simdProbe));return features.get(wasm)}
export function canInstall(h){
  try{return !!(h.isSecureContext&&h.caches&&h.crypto?.subtle&&h.Worker&&hasSimd(h.WebAssembly)&&(h.AudioContext||h.webkitAudioContext)&&h.URL?.createObjectURL)}catch{return false}
}
const files=assets.map(a=>({...a,url:new URL(a.file,root).href}));
let task=null;
function notify(h){h.dispatchEvent(new Event('folio:voice-pack'))}
function locked(h,fn){return h.navigator?.locks?.request?h.navigator.locks.request(pack,fn):fn()}
function checkAbort(signal){if(signal?.aborted)throw new DOMException('Download canceled','AbortError')}
export async function isInstalled(h){
  if(!canInstall(h)||!(await h.caches.has(pack)))return false;
  const cache=await h.caches.open(pack),keys=new Set((await cache.keys()).map(k=>k.url));
  return keys.has(marker)&&files.every(a=>keys.has(a.url));
}
export async function removePack(h){
  if(task)throw Error('busy');
  stopNeural();dropWorker();await locked(h,()=>h.caches.delete(pack));notify(h);
}
export function installPack(h,onProgress=()=>{},signal){
  if(task)return task;
  task=locked(h,async()=>{
    if(!canInstall(h))throw Error('unsupported');
    const cache=await h.caches.open(pack);let done=0;
    try{for(const a of files){
      checkAbort(signal);
      if(await cache.match(a.url)){done+=a.bytes;onProgress(done);continue}
      const r=await h.fetch(a.url,{signal,credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-store'});
      if(!r.ok)throw Error('download');
      const bytes=new Uint8Array(a.bytes);let pos=0;
      if(r.body?.getReader){
        const reader=r.body.getReader();
        try{for(;;){const p=await reader.read();if(p.done)break;if(pos+p.value.length>a.bytes)throw Error('integrity');bytes.set(p.value,pos);pos+=p.value.length;onProgress(done+pos)}}
        finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
      }else{const body=new Uint8Array(await r.arrayBuffer());if(body.length!==bytes.length)throw Error('integrity');bytes.set(body);pos=body.length}
      const sha=[...new Uint8Array(await h.crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(pos!==a.bytes||sha!==a.sha256)throw Error('integrity');
      await cache.put(a.url,new Response(bytes));done+=a.bytes;onProgress(done)
    }
    checkAbort(signal);await cache.put(marker,new Response('1'));notify(h);
    }catch(e){if(!(await cache.match(marker)))await h.caches.delete(pack);throw e}
  }).finally(()=>{task=null});
  return task;
}

// A classic, in-memory worker needs no service worker, web server or external
// script once Folio is open. Only verified Cache Storage bytes enter the SDK.
function workerMain(cacheName,files){
  let engine,load;
  const urls=[],asURL=(bytes,type)=>{const u=URL.createObjectURL(new Blob([bytes],{type}));urls.push(u);return u};
  const fetchLocal=self.fetch.bind(self);
  self.fetch=(input,init)=>{if(!urls.includes(typeof input==='string'?input:input?.url||input?.href))return Promise.reject(Error('Network disabled'));return fetchLocal(input,init)};
  async function init(){
    const cache=await caches.open(cacheName);
    const read=async name=>{const r=await cache.match(files[name]);if(!r)throw Error('missing');return r};
    const script=asURL(await (await read('kitten.js')).blob(),'text/javascript');
    importScripts(script);
    const model=await (await read('kitten_tts_nano_v0_8.onnx')).arrayBuffer(),voices=await (await read('voices.npz')).arrayBuffer();
    const wasm=asURL(await (await read('ort-wasm-simd-threaded.wasm')).blob(),'application/wasm');
    const mjs=asURL(await (await read('ort-wasm-simd-threaded.mjs')).blob(),'text/javascript');
    const phonemizer=new self.KittenTTSWeb.CEPhonemizer({rulesText:await (await read('en_rules')).text(),listText:await (await read('en_list')).text()});
    engine=await self.KittenTTSWeb.KittenTTS.create({model:'nano-int8',modelFiles:{onnxData:new Uint8Array(model),voicesData:new Uint8Array(voices)},phonemizer,
      ortWasmPath:{mjs,wasm},ortNumThreads:1,analytics:false,fetch:()=>Promise.reject(Error('Network disabled')),downloadRetries:1});
    for(const u of urls)URL.revokeObjectURL(u);
  }
  let sequence=Promise.resolve();
  self.onmessage=({data:d})=>{sequence=sequence.then(async()=>{
    try{if(!engine)await(load??=init());if(typeof d.text!=='string'||!d.text.length||d.text.length>256)throw Error('length');
      const r=await engine.generate(d.text,{voice:d.voice.toLowerCase(),speed:d.rate});
      const pcm=r.samples;if(!pcm.length||pcm.length>24000*120)throw Error('audio');
      self.postMessage({id:d.id,pcm,rate:r.sampleRate},[pcm.buffer]);
    }catch(e){self.postMessage({id:d.id,error:e?.message==='missing'?'missing':'unavailable'})}
  })};
}
let ctx=null,interrupt=null,worker=null,pending=new Map(),run=0,source=null,playhead=null,pre=null,serial=0,idle=0;
function dropWorker(){
  clearTimeout(idle);worker?.terminate();worker=null;
  for(const p of pending.values())p.reject(Error('interrupted'));pending.clear();pre=null;
  if(!source&&ctx){const old=ctx;ctx=null;old.close().catch(()=>{})}
}
export function stopNeural(){
  run++;interrupt=null;playhead=null;
  if(source){source.onended=null;try{source.stop();source.disconnect()}catch{}source=null}
  if(pending.size)dropWorker();else {clearTimeout(idle);if(worker||ctx)idle=setTimeout(dropWorker,20000)}
  pre=null;
}
const LOOKAHEAD_HOLD_MS=20000,LOOKAHEAD_HOLD_BYTES=2*1024*1024;
// Keep the current segment at its audio offset. The same narration may also
// reuse one small, already-generated next segment. Never keep inference
// running to finish an unfinished prefetch while the reader is paused.
export function pauseNeural(){
  let resume=null;
  if(ctx&&source&&playhead){
    const at=playhead.offset+Math.max(0,ctx.currentTime-playhead.startedAt);
    resume={key:playhead.key,buffer:source.buffer,offset:Math.min(at,source.buffer.duration)};
    const result=pre?.ready;
    if(result?.pcm?.byteLength>0&&result.pcm.byteLength<=LOOKAHEAD_HOLD_BYTES){
      const ahead=resume.ahead={key:pre.key,result,expires:performance.now()+LOOKAHEAD_HOLD_MS};
      setTimeout(()=>{ahead.result=null;},LOOKAHEAD_HOLD_MS);
    }
  }
  stopNeural();return resume;
}
function generate(h,params){
  if(!worker){
    const js='('+workerMain.toString()+')('+JSON.stringify(pack)+','+JSON.stringify(Object.fromEntries(files.map(a=>[a.file,a.url])))+')';
    const u=h.URL.createObjectURL(new Blob([js],{type:'text/javascript'}));
    try{worker=new h.Worker(u)}finally{h.URL.revokeObjectURL(u)}
    worker.onmessage=({data:d})=>{const p=pending.get(d.id);if(!p)return;pending.delete(d.id);if(d.error)p.reject(Error(d.error));else p.resolve(d)};
    worker.onerror=()=>dropWorker()
  }
  return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({...params,id})})
}
const key=x=>JSON.stringify([x.text,x.voice,x.rate]);
function prefetch(h,spec,ahead){
  const id=key(spec),ready=ahead?.key===id&&ahead.expires>performance.now()?ahead.result:null;
  if(ahead)ahead.result=null;
  const candidate=pre={key:id,ready,buffer:ready?Promise.resolve(ready):generate(h,spec)};
  candidate.buffer.then(out=>{if(pre===candidate)candidate.ready=out;},()=>{});
}
export function playNeural(h,{text,voice,rate,next,resume,onstart,onend,onerror}){
  if(interrupt){const old=interrupt;stopNeural();old('interrupted')}
  const ticket=++run;interrupt=onerror;clearTimeout(idle);
  // Resume synchronously in the trusted click; decoding/synthesis happens later.
  try{const C=h.AudioContext||h.webkitAudioContext;ctx??=new C();const resumed=ctx.state==='running'?Promise.resolve():ctx.resume();
    const current={text,voice,rate},currentKey=key(current),saved=resume?.key===currentKey?resume:null;
    const buffer=saved?Promise.resolve():pre?.key===currentKey?pre.buffer:generate(h,current);pre=null;
    Promise.all([resumed,buffer]).then(([,d])=>{
      if(ticket!==run||h.document.hidden)return;
      if(ctx.state!=='running')throw Error('blocked');
      let b=saved?.buffer;
      if(!b){b=ctx.createBuffer(1,d.pcm.length,d.rate);b.copyToChannel(d.pcm,0)}
      const offset=saved?.offset||0;
      const finish=()=>{if(ticket!==run)return;source?.disconnect();source=null;playhead=null;interrupt=null;idle=setTimeout(dropWorker,20000);onend()};
      if(offset>=b.duration){finish();return}
      source=ctx.createBufferSource();source.buffer=b;source.connect(ctx.destination);
      source.onended=finish;
      const startedAt=ctx.currentTime;
      source.start(startedAt,offset);playhead={key:currentKey,startedAt,offset};onstart();
      if(next&&ticket===run)prefetch(h,{text:next,voice,rate},saved?.ahead);
    }).catch(e=>{if(ticket===run){stopNeural();onerror(e.message==='missing'?'missing':e.name==='NotAllowedError'||e.message==='blocked'?'blocked':'unavailable')}});
    return true;
  }catch{stopNeural();onerror('unavailable');return false}
}
