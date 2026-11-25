import test from 'node:test';
import assert from 'node:assert/strict';
import {BYOK_PROVIDERS,createByokSession} from '../dist/byok-core.js';
import {installByokSettings} from '../dist/byok-settings.js';

const AUTH_KEY_FIXTURE='AQ.'+'fictional_example_not_a_key_'.repeat(2);
const STANDARD_FIXTURE='AIza'+'x'.repeat(35);
const OPENROUTER_FIXTURE='sk-or-v1-'+'fictional_strictly_not_a_secret';
const noop=()=>{};
const ok={models:[{name:'models/gemini-test',displayName:'Synthetic text model',supportedGenerationMethods:['generateContent']}]};
function setup(t,response){
  const calls=[],events=new Map();
  function el(tag){
    const handlers=new Map();
    return {tag,textContent:'',value:'',attributes:new Map(),children:[],hidden:false,disabled:false,
      setAttribute(k,v){this.attributes.set(k,v);},removeAttribute(k){this.attributes.delete(k);},
      toggleAttribute(k,v){if(v)this.setAttribute(k,'');else this.removeAttribute(k);},
      append(...x){this.children.push(...x);},replaceChildren(...x){this.children=x;},
      get options(){return this.children;},focus:noop,closest:()=>null,
      addEventListener(name,fn){handlers.set(name,fn);},
      fire(name,details={}){return handlers.get(name)?.({isTrusted:true,preventDefault:noop,...details});}
    };
  }
  function setGlobal(name,value){
    const saved=Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
    t.after(()=>{if(saved)Object.defineProperty(globalThis,name,saved);else delete globalThis[name];});
  }
  setGlobal('document',{createElement:el});
  setGlobal('window',{addEventListener:(event,fn)=>events.set(event,fn)});
  setGlobal('MutationObserver',class{observe(){}});
  const panel=el('div'),session=createByokSession({fetcher:async(url,config)=>{
    calls.push({url,config});return response();
  }});
  installByokSettings(panel,session,{providers:BYOK_PROVIDERS});
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const elements=()=>descendants(panel);
  const get=id=>elements().find(x=>x.id===id);
  const check=elements().find(x=>x.tag==='button'&&x.textContent==='Проверить ключ');
  function enter(provider,fixture){
    const chooser=get('byok-provider');chooser.value=provider;chooser.fire('change');
    const key=get('byok-api-key');key.value=fixture;key.fire('input');
    assert.equal(check.disabled,false);
    return key;
  }
  return {calls,session,get,enter,check,status:()=>get('byok-status').textContent,hide:()=>events.get('pagehide')()};
}
const response=(status,data)=>()=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test('the AI settings form accepts a Gemini authorization key and verifies it with a catalog GET only',async t=>{
  const f=setup(t,response(200,ok)),input=f.enter('gemini','  '+AUTH_KEY_FIXTURE+'  ');
  await f.check.fire('click');
  assert.equal(f.calls.length,1, 'the Gemini format must not be rejected locally');
  const {url,config}=f.calls[0];
  assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100');
  assert.deepEqual(config.headers,{Accept:'application/json','x-goog-api-key':AUTH_KEY_FIXTURE});
  assert.equal(config.method,'GET');assert.equal(config.credentials,'omit');
  assert.equal(config.body,null);assert.equal(config.referrerPolicy,'no-referrer');
  assert.equal(input.value,'');assert.doesNotMatch(f.status(),/AQ\./);
  assert.equal(f.session.snapshot().provider,'gemini');
  assert.equal(f.session.snapshot().model,'','verifying is not a generation request');
  assert.equal(f.get('byok-model').options[1].textContent,'Synthetic text model');
  assert.match(f.status(),/Ключ проверен/);
  f.hide();assert.equal(f.session.snapshot().provider,'');
});

for(const [name,provider,key,code,body,expected] of [
  ['provider outage','gemini',STANDARD_FIXTURE,503,{error:{message:'untrusted reply'}},/временн.*сбой/i],
  ['quota','openrouter',OPENROUTER_FIXTURE,402,{error:{message:'untrusted reply'}},/баланс/],
  ['restricted Gemini service','gemini',STANDARD_FIXTURE,400,{error:{details:[{reason:'API_KEY_SERVICE_BLOCKED'}]}},/разрешения/],
  ['invalid Gemini credential','gemini',STANDARD_FIXTURE,400,{error:{details:[{reason:'API_KEY_INVALID'}]}},/Провайдер не принял ключ/],
  ['no compatible models','gemini',STANDARD_FIXTURE,200,{models:[{name:'models/embedding-001'}]},/Ключ проверен.*совместим/],
]){
  test('AI settings distinguishes '+name+' from a malformed key',async t=>{
    const f=setup(t,response(code,body)),input=f.enter(provider,key);
    await f.check.fire('click');
    assert.equal(f.calls.length,1);assert.equal(input.value,'');
    assert.equal(f.session.snapshot().provider,'');assert.match(f.status(),expected);
    assert.equal(f.status().includes(key),false);assert.doesNotMatch(f.status(),/untrusted reply/);
  });
}

test('Gemini still rejects foreign keys and header control characters before requesting anything',async t=>{
  const f=setup(t,()=>{assert.fail('a malformed credential must not reach fetch');});
  for(const value of ['gsk_'+'x'.repeat(50),AUTH_KEY_FIXTURE+'\r\nheader:b', 'AQ.too-short']){
    const input=f.enter('gemini',value);await f.check.fire('click');
    assert.equal(input.value,'');assert.equal(f.calls.length,0);
    assert.match(f.status(),/формат|ключ выбранного провайдера/i);
  }
});
