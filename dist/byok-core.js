// Session-only inference. All destinations, operations, and request sizes are fixed here;
// book text, model labels, and API errors never determine an endpoint.
const PROVIDER_API=Object.freeze({
  openrouter:'https://openrouter.ai/api/v1',
  gemini:'https://generativelanguage.googleapis.com/v1beta',
  groq:'https://api.groq.com/openai/v1',
});
export const BYOK_PROVIDERS=Object.freeze([{
  id:'openrouter',label:'OpenRouter',hostname:'openrouter.ai',
  keyUrl:'https://openrouter.ai/settings/keys',privacyUrl:'https://openrouter.ai/privacy',
},{
  id:'gemini',label:'Google Gemini',hostname:'generativelanguage.googleapis.com',
  keyUrl:'https://aistudio.google.com/api-keys',privacyUrl:'https://ai.google.dev/gemini-api/terms',
  planNote:'У некоторых моделей есть бесплатная квота. На бесплатном тарифе Google может использовать запросы для улучшения продуктов.',
},{
  id:'groq',label:'Groq',hostname:'api.groq.com',
  keyUrl:'https://console.groq.com/keys',privacyUrl:'https://groq.com/privacy-policy/',
  planNote:'У Groq есть бесплатный тариф с лимитами. Это не Grok от xAI.',
}].map(x=>Object.freeze(x)));
export const BYOK_LIMITS=Object.freeze({
  keyChars:512,promptChars:1800,instructionChars:600,outputTokens:256,outputChars:1600,
  catalogBytes:2*1024*1024,completionBytes:64*1024,catalogItems:1200,
  validationMs:12000,generationMs:22000,maxRetrySeconds:3600,
});
const copy=Object.freeze({
  provider:'Этот провайдер пока не поддерживается.',
  key:'Введите ключ выбранного провайдера без пробелов.',
  auth:'Провайдер не принял ключ. Проверьте ключ и подключите заново.',
  forbidden:'Провайдер не разрешил доступ с этим ключом или к этой модели.',
  quota:'Проверьте баланс и лимит расходов у провайдера.',
  rate_limit:'Провайдер ограничил частоту запросов. Попробуйте позже.',
  backend:'Провайдер временно недоступен. Попробуйте позже.',
  network:'Не удалось связаться с провайдером. Проверьте сеть и доступ из браузера.',
  timeout:'Провайдер не успел ответить. Попробуйте позже.',
  canceled:'Запрос отменён.',
  protocol:'Провайдер вернул неожиданный ответ. Попробуйте другую модель.',
  no_models:'Для этого ключа не найдено подходящих текстовых моделей.',
  model:'Выберите доступную текстовую модель в настройках.',
  offline:'Подключение к интернету недоступно.',
  busy:'Дождитесь завершения запроса или отмените его.',
  input:'Не удалось подготовить короткую подсказку из этого фрагмента.',
  empty:'Модель не вернула подсказку. Попробуйте другую модель.',
  truncated:'Модель не успела закончить подсказку. Попробуйте другую модель.',
});
export class ByokError extends Error {
  constructor(code,{status,retryAfter}={}){
    super(Object.hasOwn(copy,code)?copy[code]:copy.protocol);
    this.name='ByokError';
    this.code=Object.hasOwn(copy,code)?code:'protocol';
    this.userMessage=this.message;
    if(Number.isInteger(status))this.status=status;
    if(Number.isInteger(retryAfter))this.retryAfter=retryAfter;
  }
}
const err=(code,info)=>new ByokError(code,info);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const modelPattern=/^[a-z\d][a-z\d._-]{0,63}\/[a-z\d][a-z\d._-]{0,111}(?::free)?$/i;
const controls=/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const noModels=Object.freeze([]);
const compare=(a,b)=>Number(b.free)-Number(a.free)||a.label.localeCompare(b.label)||a.id.localeCompare(b.id);

function keyText(provider,key){
  const value=typeof key==='string'?key.trim():'';
  // Ordinary inference keys. Do not accept placeholder tokens or arbitrary authorization syntax.
  const patterns={openrouter:/^sk-or-v1-[a-z0-9_-]{16,}$/i,gemini:/^(?!(?:gsk_|sk-|xai[-_]))[a-z0-9_-]{20,}$/i,groq:/^gsk_[a-z0-9_-]{16,}$/i};
  if(value.length>BYOK_LIMITS.keyChars||!patterns[provider].test(value))throw err('key');
  return value;
}
function catalog(json,secret){
  if(!Array.isArray(json?.data))throw err('protocol');
  const unique=new Map();
  for(const row of json.data.slice(0,BYOK_LIMITS.catalogItems)){
    if(!object(row)||typeof row.id!=='string'||!modelPattern.test(row.id)||row.id.includes(secret)||/^openrouter\//i.test(row.id)||unique.has(row.id))continue;
    const {input_modalities:input,output_modalities:output}=row.architecture||{};
    if(!Array.isArray(input)||!input.includes('text')||!Array.isArray(output)||!output.includes('text'))continue;
    if(Array.isArray(row.endpoints)&&!row.endpoints.some(x=>x==='/api/v1/chat/completions'||x==='/chat/completions'))continue;
    const params=row.supported_parameters;
    if(!Array.isArray(params)||!params.includes('max_tokens')&&!params.includes('max_completion_tokens'))continue;
    const rawLabel=typeof row.name==='string'?row.name:'';
    const label=!rawLabel.includes(secret)?rawLabel.replace(controls,'').trim().slice(0,120):'';
    const zero=x=>x===0||(typeof x==='string'&&/^0+(?:\.0+)?(?:e[+-]?\d+)?$/i.test(x));
    const free=zero(row.pricing?.prompt)&&zero(row.pricing?.completion)&&(row.pricing?.request==null||zero(row.pricing.request));
    unique.set(row.id,{option:Object.freeze({id:row.id,label:label||row.id,free}),tokenParameter:params.includes('max_tokens')?'max_tokens':'max_completion_tokens'});
  }
  const models=Object.freeze([...unique.values()].map(x=>x.option).sort(compare));
  if(!models.length)throw err('no_models');
  return {models,unique};
}
function directCatalog(provider,json,secret){
  const rows=provider==='gemini'?json?.models:json?.data;
  if(!Array.isArray(rows))throw err('protocol');
  const unique=new Map();
  for(const row of rows.slice(0,BYOK_LIMITS.catalogItems)){
    if(!object(row))continue;
    let id;
    if(provider==='gemini'){
      const name=typeof row.name==='string'?row.name.match(/^models\/(gemini-[a-z0-9._-]{1,100})$/i):null;
      if(!name||!Array.isArray(row.supportedGenerationMethods)||!row.supportedGenerationMethods.includes('generateContent')||
          /(?:image|tts|audio|robotics|computer-use|embedding|deep-research|live)/i.test(name[1]))continue;
      id=name[1];
    }else{
      id=row.id;
      if(typeof id!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,111})?$/i.test(id)||row.active===false||
         !/(?:llama|qwen|gpt-oss|mistral|kimi|gemma|deepseek)/i.test(id)||
         /(?:whisper|safeguard|guard|tts|orpheus|embedding|audio|vision|compound)/i.test(id))continue;
    }
    if(id.includes(secret)||unique.has(id))continue;
    const raw=typeof row.displayName==='string'&&!row.displayName.includes(secret)?row.displayName:'';
    const label=raw.replace(controls,'').trim().slice(0,120)||id;
    unique.set(id,{option:Object.freeze({id,label,free:false}),tokenParameter:'max_completion_tokens'});
  }
  const models=Object.freeze([...unique.values()].map(x=>x.option).sort(compare));
  if(!models.length)throw err('no_models');
  return {models,unique};
}
function waitSeconds(value){
  if(typeof value!=='string'||!value||value.length>80)return undefined;
  if(!/^\d+$/.test(value)&&!/(?:GMT|UTC)$/i.test(value))return undefined;
  const seconds=/^\d+$/.test(value)?Number(value):Math.ceil((Date.parse(value)-Date.now())/1000);
  return Number.isFinite(seconds)?Math.min(BYOK_LIMITS.maxRetrySeconds,Math.max(1,seconds)):undefined;
}
function responseError(status,headers){
  const retryAfter=waitSeconds(headers?.get('retry-after'));
  const code=({401:'auth',402:'quota',403:'forbidden',404:'model',408:'timeout',429:'rate_limit'})[status]||
    (status>=500?'backend':'protocol');
  return err(code,{status,retryAfter});
}
function cancelBody(body){
  try{void body?.cancel()?.catch(()=>{})}catch{}
}
async function boundedJson(response,max){
  const size=response.headers?.get('content-length');
  if(size&&Number(size)>max){cancelBody(response.body);throw err('protocol')}
  const contentType=response.headers?.get('content-type')||'';
  if(!/^application\/(?:json|[^;\s]+\+json)(?:\s*;|$)/i.test(contentType)||!response.body?.getReader){
    cancelBody(response.body);throw err('protocol');
  }
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
  let n=0,text='';
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      n+=value.byteLength;
      if(n>max){cancelBody(reader);throw err('protocol')}
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  }catch(e){cancelBody(reader);throw err('protocol')}
  finally{reader.releaseLock()}
}
async function request(fetcher,provider,path,key,body,signal){
  const url=PROVIDER_API[provider]+path;
  // No Referer path, app attribution, cookies, service endpoint overrides, or redirects.
  const headers={Accept:'application/json',...(provider==='gemini'?{'x-goog-api-key':key}:{Authorization:'Bearer '+key})};
  if(body!==null)headers['Content-Type']='application/json';
  let res;
  try{
    res=await fetcher(url,{method:body===null?'GET':'POST',headers,body,mode:'cors',credentials:'omit',
      redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal});
  }catch{throw err(globalThis.navigator?.onLine===false?'offline':'network')}
  if(res.redirected||(res.url&&res.url!==url)){cancelBody(res.body);throw err('protocol')}
  if(!res.ok){
    // Gemini can report an invalid user key as 400 rather than 401.
    if(provider==='gemini'&&res.status===400){
      const detail=await boundedJson(res,body===null?BYOK_LIMITS.catalogBytes:BYOK_LIMITS.completionBytes);
      if(detail?.error?.details?.some?.(x=>x?.reason==='API_KEY_INVALID'||x?.reason==='API_KEY_SERVICE_BLOCKED'))throw err('auth',{status:400});
      throw err('protocol',{status:400});
    }
    cancelBody(res.body);throw responseError(res.status,res.headers);
  }
  const json=await boundedJson(res,body===null?BYOK_LIMITS.catalogBytes:BYOK_LIMITS.completionBytes);
  if(!object(json))throw err('protocol');
  if(json.error)throw responseError(Number.isInteger(json.error.code)?json.error.code:0,res.headers);
  return json;
}
async function runJob(controller,external,timeout,work){
  const own=controller.signal;
  if(external?.aborted||own.aborted)throw err('canceled');
  const forward=()=>controller.abort('cancel');
  external?.addEventListener('abort',forward,{once:true});
  let stopped;
  const abortion=new Promise((_,reject)=>{
    stopped=()=>reject(err(own.reason==='timeout'?'timeout':'canceled'));
    own.addEventListener('abort',stopped,{once:true});
  });
  const timer=setTimeout(()=>controller.abort('timeout'),timeout);
  try{
    const result=await Promise.race([abortion,work(own)]);
    if(own.aborted)throw err(own.reason==='timeout'?'timeout':'canceled');
    return result;
  }finally{
    clearTimeout(timer);external?.removeEventListener('abort',forward);own.removeEventListener('abort',stopped);
  }
}
function readable(json,secret){
  if(!Array.isArray(json.choices)||!object(json.choices[0]))throw err('protocol');
  const choice=json.choices[0];
  if(choice.error)throw responseError(Number.isInteger(choice.error.code)?choice.error.code:0);
  if(choice.finish_reason==='length')throw err('truncated');
  if(choice.finish_reason!=='stop')throw err('empty');
  const text=typeof choice.message?.content==='string'?choice.message.content.trim():'';
  if(!text)throw err('empty');
  if(text.includes(secret))throw err('protocol');
  if(text.length>BYOK_LIMITS.outputChars)throw err('truncated');
  return text;
}

function readableGemini(json,secret){
  const answer=json?.candidates?.[0];
  if(!object(answer))throw err('empty');
  if(answer.finishReason==='MAX_TOKENS')throw err('truncated');
  if(answer.finishReason!=='STOP'||!Array.isArray(answer.content?.parts))throw err('empty');
  const text=answer.content.parts.filter(x=>typeof x?.text==='string'&&!x.thought).map(x=>x.text).join('').trim();
  if(!text)throw err('empty');
  if(text.includes(secret))throw err('protocol');
  if(text.length>BYOK_LIMITS.outputChars)throw err('truncated');
  return text;
}

export function createByokSession({fetcher=globalThis.fetch,timeoutMs}={}){
  let active=null,linking=null,generating=null,cooldown=0;
  const deadline=fallback=>Number.isInteger(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,fallback):fallback;
  const snapshot=()=>Object.freeze({provider:active?.provider||'',models:active?.models||noModels,model:active?.model||''});
  function interrupt(){
    const specific=generating;generating=null;specific?.abort('cancel');
  }
  function clear(){
    const pending=linking;linking=null;pending?.abort('cancel');interrupt();active=null;cooldown=0;
    return snapshot();
  }
  function select(model){
    if(!active||!active.unique.has(model))throw err('model');
    if(active.model!==model){interrupt();active.model=model}
    return snapshot();
  }
  async function connect({provider,key,signal}={}){
    if(!Object.hasOwn(PROVIDER_API,provider))throw err('provider');
    const secret=keyText(provider,key);
    if(signal?.aborted)throw err('canceled');
    const same=active?.provider===provider&&active?.key===secret;
    const previousModel=same?active.model:'';
    if(!same)clear();
    else{linking?.abort('cancel');interrupt()}
    const job=linking=new AbortController();
    try{
      // Unlike the public /models directory, this account-filtered route requires a valid
      // bearer key; a single metadata fetch is enough and shares no reading content.
      const data=await runJob(job,signal,deadline(BYOK_LIMITS.validationMs),async s=>
        {
        const value=await request(fetcher,provider,provider==='openrouter'?'/models/user':provider==='gemini'?'/models?pageSize=100':'/models',secret,null,s);
        return provider==='openrouter'?catalog(value,secret):directCatalog(provider,value,secret);
      });
      if(linking!==job)throw err('canceled');
      active={provider,key:secret,...data,model:data.unique.has(previousModel)?previousModel:''};
      return snapshot();
    }catch(e){
      if(linking===job&&['auth','forbidden'].includes(e?.code)){active=null;cooldown=0}
      throw e;
    }finally{if(linking===job)linking=null}
  }
  async function generate({instructions,prompt,maxTokens=180,signal}={}){
    if(!active?.model)throw err('model');
    if(linking||generating)throw err('busy');
    if(signal?.aborted)throw err('canceled');
    const connected=active,secret=connected.key,model=connected.model;
    if(Date.now()<cooldown)throw err('rate_limit',{status:429,retryAfter:Math.ceil((cooldown-Date.now())/1000)});
    if(typeof instructions!=='string'||!instructions.trim()||instructions.length>BYOK_LIMITS.instructionChars||
       typeof prompt!=='string'||!prompt.trim()||JSON.stringify(prompt).length>BYOK_LIMITS.promptChars||
       !Number.isInteger(maxTokens)||maxTokens<1||maxTokens>BYOK_LIMITS.outputTokens)throw err('input');
    const option=connected.unique.get(model);
    const provider=connected.provider;
    const body=JSON.stringify(provider==='gemini'?{
      systemInstruction:{parts:[{text:instructions}]},
      contents:[{role:'user',parts:[{text:prompt}]}],
      generationConfig:{maxOutputTokens:maxTokens,
        ...(/^gemini-2\.5-flash(?:-|$)/i.test(model)?{thinkingConfig:{thinkingBudget:0}}:{}),
      },
    }:{
      model,stream:false,[option.tokenParameter]:maxTokens,
      messages:[{role:'system',content:instructions},{role:'user',content:prompt}],
      ...(provider==='openrouter'?{provider:{require_parameters:true,allow_fallbacks:false,data_collection:'deny'}}:{}),
    });
    const job=generating=new AbortController();
    try{
      const answer=await runJob(job,signal,deadline(BYOK_LIMITS.generationMs),async s=>
        (provider==='gemini'?readableGemini:readable)(await request(fetcher,provider,
          provider==='gemini'?'/models/'+model+':generateContent':'/chat/completions',secret,body,s),secret));
      if(generating!==job||active!==connected||active.model!==model)throw err('canceled');
      return answer;
    }catch(e){
      if(generating===job){
        if(e?.code==='auth'){active=null;cooldown=0}
        if(e?.code==='rate_limit')cooldown=Date.now()+(e.retryAfter||3)*1000;
      }
      throw e;
    }finally{if(generating===job)generating=null}
  }
  return Object.freeze({snapshot,connect,select,clear,generate});
}
