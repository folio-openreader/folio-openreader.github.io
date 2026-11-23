import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assets} from '../dist/neural-assets.js';
import {canInstall,downloadBytes,isEnglish,narrator,uri,isInstalled,installPack,removePack} from '../dist/neural-voices.js';
import {createWordSpeech,voicePreference} from '../dist/word-speech.js';
import {createBookSpeech} from '../dist/book-speech.js';

function fixture(fail=''){
 const stores=new Map(),fetched=[];let halted=false,cache;
 const h=Object.assign(new EventTarget(),{isSecureContext:true,caches:{
   has:async k=>stores.has(k),open:async k=>{
     if(!stores.has(k)){
       const map=new Map();cache={match:async u=>map.get(u),put:async(u,r)=>{if(fail==='quota')throw new DOMException('Full','QuotaExceededError');map.set(u,r)},keys:async()=>[...map.keys()].map(url=>({url})),delete:async u=>map.delete(u)};
       stores.set(k,cache)
     }return stores.get(k)
   },delete:async k=>stores.delete(k)},
   crypto:globalThis.crypto,Worker:class{},WebAssembly,AudioContext:class{},URL,document:{hidden:false},navigator:{},
   fetch:async(u,opts)=>{
     assert.equal(opts.credentials,'omit');assert.equal(opts.referrerPolicy,'no-referrer');assert.equal(opts.redirect,'error');
     if(halted)throw Error('Network was disabled');
     const name=new URL(u).pathname.split('/').at(-1);fetched.push(name);
     if(fail==='corrupt'&&fetched.length===2)return new Response(new Uint8Array(32));
     if(fail==='offline'&&fetched.length===2)throw TypeError('Network unavailable');
     return new Response(await readFile(new URL('../dist/voices/en-v1/'+name,import.meta.url)));
   }});
 return {h,stores,fetched,offline:()=>halted=true,cache:()=>cache};
}
test('no automatic fetch; optional English-only pack and exact static payload',async()=>{
 const {h,stores,fetched}=fixture();assert.equal(canInstall(h),true);assert.equal(canInstall({...h,isSecureContext:false}),false);assert.equal(canInstall({...h,WebAssembly:{validate:()=>false}}),false);
 assert.equal(await isInstalled(h),false);assert.equal(stores.size,0);assert.equal(fetched.length,0);
 assert.equal(narrator('en-GB',uri('Jasper')),'Jasper');assert.equal(narrator('ru',uri('Bella')),'');assert.equal(narrator('en',uri('bogus')),'');
 assert.equal(isEnglish('en-Cyrl'),false);assert.equal(downloadBytes,42024777);
 assert.ok(assets.every(a=>/^[\w.-]+$/.test(a.file)&&/^[\da-f]{64}$/.test(a.sha256)));
});
test('explicit install is deduplicated, integrity checked, local-only on restart, removable',async()=>{
 const f=fixture(),{h}=f,steps=[],a=installPack(h,n=>steps.push(n));
 assert.equal(a,installPack(h));await a;
 assert.equal(await isInstalled(h),true);assert.equal(f.fetched.length,7);assert.equal(steps.at(-1),downloadBytes);
 assert.ok(steps.every((x,i)=>!i||x>=steps[i-1]));f.offline();await installPack(h);
 assert.equal(f.fetched.length,7);assert.equal(await isInstalled(h),true);await removePack(h);assert.equal(await isInstalled(h),false);assert.equal(f.stores.size,0);
});
test('incomplete, corrupt, quota-failed, or canceled installs never become installed or retain partials',async()=>{
 for(const failure of ['corrupt','quota','offline','abort']){
   const f=fixture(failure),c=new AbortController();await assert.rejects(installPack(f.h,n=>{if(n&&failure==='abort')c.abort()},c.signal));assert.equal(await isInstalled(f.h),false);assert.equal(f.stores.size,0,failure);
 }
});
test('word and book preserve native alternate language and unsupported outcomes without installing a pack',()=>{
 const f=fixture(),said=[],states=[],v={localService:true,voiceURI:'ru-host',lang:'ru-RU'};
 Object.assign(f.h,{speechSynthesis:{getVoices:()=>[v],speak:u=>said.push(u)},SpeechSynthesisUtterance:class{constructor(s){this.text=s}},setTimeout(){},clearTimeout(){}});
 voicePreference(f.h,'en',{voice:uri('Jasper')});voicePreference(f.h,'ru',{voice:uri('Jasper')});
 const word=createWordSpeech({host:f.h,publish:x=>states.push(x.status)}),book=createBookSpeech({host:f.h});const event={isTrusted:true};
 word.speak({event,text:'Привет',language:'ru'});book.toggle({event,source:{chapters:[{paragraphs:[{text:'Привет.'}]}]},chapter:0,paragraph:0,language:'ru'});
 assert.deepEqual(said.map(u=>u.voice),[v,v]);assert.equal(f.fetched.length,0);
 const fail=createWordSpeech({host:{navigator:{},document:{hidden:false},setTimeout(){},clearTimeout(){}},publish:s=>states.push(s.status)});assert.equal(fail.speak({event,text:'Hello',language:'en'}),false);assert.equal(states.at(-1),'unsupported');
});
