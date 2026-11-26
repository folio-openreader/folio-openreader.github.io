import {canInstall,narrators,narrator,uri,downloadBytes,isEnglish,isInstalled,setVoicePackAvailability,installPack,removePack} from './neural-voices.js';
import {createWordSpeech,localVoice,speechRates,voicePreference,wordSpeechMessage} from './word-speech.js';
const samples={en:'Just one more page.',ru:'Прочитаем ещё одну страницу.',de:'Nur noch eine Seite.',es:'Una página más.',fr:'Encore une page.',kk:'Тағы бір бет оқиық.',hi:'एक और पृष्ठ पढ़ें।',ja:'もう一ページ読みましょう。',ko:'한 페이지 더 읽어 봐요.'};
const names=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(['ru'],{type:'language'}):null;
function label(tag){try{return names?.of(tag)||tag}catch{return tag}}
// A short local excerpt lets readers audition more languages without inventing
// a mismatched sample or handing their book text to a remote system voice.
export function bookVoiceSample(text){
  const start=String(text||'').slice(0,150).trimStart().replace(/\s+/gu,' ');
  const clip=start.slice(0,72).replace(/[\uD800-\uDBFF]$/u,'');
  const sentence=clip.match(/^.{15,70}?[.!?。！？](?=\s|$)/u)?.[0];
  let sample=(sentence||clip).trimEnd();
  if(!sentence&&clip===sample&&start.length>72&&!/\s/u.test(start[72])){
    const space=sample.lastIndexOf(' ');if(space>=24)sample=sample.slice(0,space);
  }
  return /\p{L}/u.test(sample)?sample:'';
}
export function installVoiceControls({language,bookSample,beforeSample}){
  const panels=[],host=window;
  let activeStatus=null,installed=false,busy=false,aborter=null,percent=0,packNote='';
  const refresh=()=>panels.forEach(f=>f());
  const size=(downloadBytes/1e6).toFixed(1).replace('.',',')+' МБ';
  let probe=0;
  function setInstalled(available){installed=available;setVoicePackAvailability(host,available)}
  async function check(){
    if(busy)return;
    const request=++probe;
    let available;try{available=await isInstalled(host)}catch{available=false}
    if(request!==probe||busy)return;
    setInstalled(available);refresh();
  }

  const preview=createWordSpeech({host,publish:({status,language})=>{if(activeStatus)activeStatus.textContent=wordSpeechMessage(status,language)||({speaking:'Воспроизведение…',starting:'Запускаем голос…'}[status]||'')}});
  const stop=()=>{preview.reset();activeStatus=null};
  for(const box of document.querySelectorAll('[data-voice-controls]')){
    const select=(label)=>{const l=document.createElement('label'),s=document.createElement('select');l.append(label,s);box.append(l);return s};
    const lang=select('Язык озвучивания'),voice=select('Голос'),rate=select('Скорость');
    const btn=document.createElement('button');btn.type='button';btn.className='quiet';btn.textContent='Послушать пример';
    const status=document.createElement('p');status.setAttribute('role','status');box.append(btn,status);
    for(const r of speechRates)rate.add(new Option(r.toLocaleString('ru')+'×',r));
    const section=document.createElement('div');section.className='voice-download';
    const about=document.createElement('p');about.textContent='Четыре английских голоса для книг и слов. После загрузки работают без интернета.';
    const action=document.createElement('button');action.type='button';action.className='quiet';
    const note=document.createElement('p');note.setAttribute('role','status');
    section.append(about,action,note);box.append(section);
    action.onclick=async()=>{
      if(busy){aborter?.abort();return}
      stop();beforeSample();busy=true;probe++;percent=0;packNote='';aborter=new AbortController();refresh();
      try{
        if(installed){await removePack(host);voicePreference(host,'en',{voice:''});setInstalled(false);packNote='Пакет удалён.'}
        else{await installPack(host,n=>{const p=Math.floor(n/downloadBytes*100);if(p!==percent){percent=p;refresh()}},aborter.signal);
          setInstalled(true);
          if(!narrator('en',voicePreference(host,'en').voice))voicePreference(host,'en',{voice:uri('Bella')});
          packNote='Готово. Выберите голос и послушайте пример.'}
      }catch(e){packNote=e?.name==='AbortError'?'Загрузка отменена.':e?.name==='QuotaExceededError'?'Недостаточно места. Освободите память и повторите.':'Не удалось сохранить пакет. Голоса устройства по-прежнему доступны.'}
      finally{busy=false;aborter=null;refresh()}
    };
    let context=null,sample='';
    function sync(){
      const selectedLanguage=language(box)||'en';
      let list=[];try{list=host.speechSynthesis?.getVoices()||[]}catch{}
      let desired=context===selectedLanguage&&lang.value?lang.value:selectedLanguage;context=selectedLanguage;
      const tags=new Set([...Object.keys(samples),selectedLanguage]);lang.replaceChildren(...[...tags].map(k=>new Option(label(k),k)));
      lang.value=desired;
      const pref=voicePreference(host,desired),matches=list.filter(v=>localVoice([v],desired));
      const english=isEnglish(desired),hasPack=english&&installed,chosen=narrator(desired,pref.voice),preferred=hasPack&&chosen;
      section.hidden=!english||!canInstall(host);
      action.textContent=busy?'Отменить загрузку · '+percent+'%':installed?'Удалить английские голоса':'Скачать английские голоса · '+size;
      note.textContent=packNote||(!busy&&!hasPack&&chosen?'Голос '+chosen+' сейчас недоступен. Настройка сохранена; пока Folio попробует голос устройства.':'');
      voice.replaceChildren(new Option('Автоматически · устройство',''),...(hasPack?narrators.map(n=>new Option(n+' · Folio',uri(n))):[]),...matches.map(v=>new Option(v.name+' · '+v.lang,v.voiceURI||v.name)));
      voice.value=preferred?pref.voice:matches.some(v=>(v.voiceURI||v.name)===pref.voice)?pref.voice:'';
      voice.disabled=!(hasPack||matches.length);rate.value=String(pref.rate);
      if(activeStatus!==status)status.textContent=!matches.length&&!preferred?'Браузер не показал установленный голос для этого языка.':'';
      const base=desired.split('-')[0],fixed=Object.hasOwn(samples,base)?samples[base]:'';
      const excerpt=!fixed&&desired===selectedLanguage&&matches.length?bookVoiceSample(bookSample?.(box)):'';
      sample=fixed||excerpt;
      btn.textContent=excerpt?'Послушать отрывок':'Послушать пример';
      btn.disabled=!sample||(!preferred&&!host.speechSynthesis);
    }
    panels.push(sync);
    lang.onchange=()=>{stop();sync()};
    voice.onchange=()=>{stop();beforeSample();voicePreference(host,lang.value,{voice:voice.value});panels.forEach(f=>f())};
    rate.onchange=()=>{stop();beforeSample();voicePreference(host,lang.value,{rate:Number(rate.value)});panels.forEach(f=>f())};
    btn.onclick=event=>{stop();beforeSample();activeStatus=status;preview.speak({event,language:lang.value,text:sample})};
    const dialog=box.closest('dialog');
    if(dialog){new MutationObserver(()=>{if(dialog.open)sync();else stop()}).observe(dialog,{attributes:true,attributeFilter:['open']})}
    sync();
  }
  void check();host.addEventListener('focus',check);host.addEventListener('folio:voice-pack',check);
  host.speechSynthesis?.addEventListener?.('voiceschanged',()=>panels.forEach(f=>f()));
  host.addEventListener('hashchange',()=>{stop();panels.forEach(f=>f())});
  host.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
}
