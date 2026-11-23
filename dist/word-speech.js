// Local-only word pronunciation. Native API calls never use a generic default:
// the Web Speech specification permits remote default voices.
function locale(tag){
  try{const id=new Intl.Locale(String(tag||'').replaceAll('_','-'));return id.language==='und'||!id.language?null:id}
  catch{return null}
}
export function speechLanguage(bookLanguage, fallback){
  return (locale(bookLanguage)||locale(fallback))?.baseName||'';
}
export function localVoice(voices,language,avoid=new Set(),preferred=''){
  const want=locale(language);if(!want)return null;
  const detectedScript=want.maximize().script;
  const rank=({voice,lang})=>Number(!!preferred&&(voice.voiceURI||voice.name)===preferred)*1000+Number(lang.baseName===want.baseName)*100+
    Number(!!want.region&&lang.region===want.region)*10+Number(voice.default===true);
  return (Array.isArray(voices)?voices:[]).map(voice=>({voice,lang:locale(voice?.lang)}))
    .filter(({voice,lang})=>voice?.localService===true&&lang?.language===want.language&&
      (!detectedScript||lang.maximize().script===detectedScript)&&!avoid.has(voice.voiceURI||voice.name))
    .sort((a,b)=>rank(b)-rank(a))[0]?.voice||null;
}
const preferences=new WeakMap();
export const speechRates=[0.75,0.9,1,1.1,1.25,1.5,2];
function prefKey(language){const l=locale(language);return l?l.language+'-'+l.maximize().script:'und'}
export function voicePreference(host,language,update){
  const key='folio.voice.1.'+prefKey(language);
  let store=preferences.get(host);if(!store){store=new Map();preferences.set(host,store)}
  let item=store.get(key);if(!item){try{item=JSON.parse(host.localStorage.getItem(key))}catch{}}
  const merged={...item,...update};
  const pref={voice:typeof merged.voice==='string'?merged.voice:'',rate:speechRates.includes(merged.rate)?merged.rate:1};
  if(update){store.set(key,pref);try{host.localStorage.setItem(key,JSON.stringify(pref))}catch{}}
  return pref;
}
export function appleSpeechPlatform(nav={}){
  const ua=String(nav.userAgent||''),platform=String(nav.platform||'');
  const mobile=/iPhone|iPad|iPod/i.test(ua+' '+platform)||(platform==='MacIntel'&&Number(nav.maxTouchPoints)>1);
  const safari=/AppleWebKit\//.test(ua)&&/Version\/[^ ]+.*Safari\//.test(ua)
    &&!/(?:CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Firefox|Edg|DuckDuckGo|YaBrowser)\//i.test(ua)
    &&nav.vendor==='Apple Computer, Inc.';
  return {mobile,systemSafari:safari&&(mobile||/^Mac/.test(platform))};
}

const START_LIMIT=3500,END_LIMIT=8500;
export function nativeEnglish(language){
  const lang=locale(language);
  if(lang?.language!=='en'||lang.maximize().script!=='Latn')return '';
  // Normal browser offers any appropriate English accent. In the Apple-only
  // unlisted fallback ask AVFoundation for a concrete compact English locale.
  return ['US','GB','AU','CA','IE','IN','ZA'].includes(lang.region)?'en-'+lang.region:'en-US';
}
export function createWordSpeech({host=window,publish=()=>{}}={}){
  let synth,Utterance;
  try{synth=host.speechSynthesis;Utterance=host.SpeechSynthesisUtterance}catch{}
  const apple=appleSpeechPlatform(host.navigator);
  const supported=!!synth&&typeof synth.getVoices==='function'&&typeof synth.speak==='function'&&typeof Utterance==='function';
  let active=null,timer=0,lang='',failed=new Set(),status='idle',attemptedDefault=false,listed=false;
  const clearTimer=()=>{if(timer){host.clearTimeout(timer);timer=0}};
  function emit(next){status=next;publish({status:next,language:lang,apple:apple.mobile})}
  function voices(){try{return supported?(synth.getVoices()||[]):[]}catch{return []}}
  function cancel(){
    const old=active;active=null;clearTimer();if(old){try{synth.cancel()}catch{}}
  }
  function reset(language=''){cancel();lang=language;failed=new Set();attemptedDefault=false;emit('idle')}
  function changed(){
    listed=true;
    if((status==='waiting'||status==='missing'||status==='unavailable')&&localVoice(voices(),lang,failed))emit('ready');
  }
  synth?.addEventListener?.('voiceschanged',changed);
  // Prime an initially asynchronous list without submitting any text. Re-read
  // on every activation; this also covers WebViews without voiceschanged.
  voices();
  function speak({text,language,event}){
    if(event?.isTrusted!==true||host.document?.hidden)return false;
    if(lang!==language)reset(language);
    if(!supported){emit('unsupported');return false}
    if(!lang){emit('unknown');return false}
    if(typeof text!=='string'||!text.trim()||text.length>256)return false;
    cancel();
    const list=voices();
    const pref=voicePreference(host,lang);
    let voice=localVoice(list,lang,failed,pref.voice),fallbackLang='';
    // Cocoa WebKit's native path is local even without an explicit voice.
    // Restrict the unlisted path to built-in English and genuine Apple Safari.
    if(!voice&&apple.systemSafari&&!attemptedDefault)fallbackLang=nativeEnglish(lang);
    if(!voice&&!fallbackLang){
      if(failed.size){failed.clear();attemptedDefault=false;voice=localVoice(list,lang,failed,pref.voice)}
      if(!voice){attemptedDefault=false;emit(list.length||listed?'missing':'waiting');return false}
    }
    let utterance;
    try{
      utterance=new Utterance(text);
      utterance.lang=voice?.lang||fallbackLang;utterance.rate=pref.rate;
      if(voice)utterance.voice=voice;
      // Never assign null: affected Safari versions fail before sound starts.
    }catch{emit('unavailable');return false}
    if(fallbackLang)attemptedDefault=true;
    const key=voice?.voiceURI||voice?.name,run={utterance,started:false};active=run;
    function fail(reason){
      if(active!==run)return;
      if(key&&reason!=='blocked'&&reason!=='interrupted')failed.add(key);
      cancel();emit(reason);
    }
    utterance.onstart=()=>{
      if(active!==run||run.started)return;
      run.started=true;clearTimer();emit('speaking');
      timer=host.setTimeout(()=>fail('unavailable'),END_LIMIT);
    };
    // Some native engines omit start but do send boundary when audio begins.
    utterance.onboundary=utterance.onstart;
    utterance.onend=()=>{
      if(active!==run)return;
      if(!run.started){fail('unavailable');return}
      active=null;clearTimer();failed.clear();attemptedDefault=false;emit('idle');
    };
    utterance.onerror=e=>{
      if(e?.error==='canceled'||e?.error==='interrupted'){fail('interrupted');return}
      if(e?.error==='not-allowed'){fail('blocked');return}
      fail(['voice-unavailable','language-unavailable'].includes(e?.error)?'missing':'unavailable');
    };
    timer=host.setTimeout(()=>fail('unavailable'),START_LIMIT);emit('starting');
    try{
      if(synth.paused)synth.resume?.();
      // The native call stays on the original trusted click, especially on iOS.
      synth.speak(utterance);return true;
    }catch{fail('unavailable');return false}
  }
  return {reset,speak,warm:voices};
}

const formatter=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(['ru'],{type:'language',fallback:'code'}):null;
export function wordSpeechMessage(status,language){
  const name=locale(language)?.language;
  const label=name?(formatter?.of(name)||name.toUpperCase()):'';
  switch(status){
    case 'unsupported':return 'Этот браузер не поддерживает озвучивание слов.';
    case 'unknown':return 'Не удалось определить язык слова для озвучивания.';
    case 'waiting':return 'Браузер ещё не показал локальные голоса. Подождите и нажмите ещё раз.';
    case 'ready':return 'Локальный голос готов. Нажмите значок звука ещё раз.';
    case 'missing':return label?'Нет доступного локального голоса: '+label+'.':'Нет доступного локального голоса.';
    case 'unavailable':return 'Не удалось запустить голос. Проверьте громкость и нажмите ещё раз.';
    case 'blocked':return 'Браузер не разрешил воспроизведение. Нажмите значок звука ещё раз.';
    case 'interrupted':return 'Озвучивание прервано. Нажмите значок звука ещё раз.';
    default:return '';
  }
}
