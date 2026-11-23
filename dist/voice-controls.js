import {createWordSpeech,localVoice,speechRates,voicePreference,wordSpeechMessage} from './word-speech.js';
const samples={en:'Just one more page.',ru:'Прочитаем ещё одну страницу.',de:'Nur noch eine Seite.',es:'Una página más.',fr:'Encore une page.',kk:'Тағы бір бет оқиық.',hi:'एक और पृष्ठ पढ़ें।',ja:'もう一ページ読みましょう。',ko:'한 페이지 더 읽어 봐요.'};
const names=typeof Intl.DisplayNames==='function'?new Intl.DisplayNames(['ru'],{type:'language'}):null;
function label(tag){try{return names?.of(tag)||tag}catch{return tag}}
export function installVoiceControls({language,beforeSample}){
  const panels=[],host=window;
  let activeStatus=null;
  const preview=createWordSpeech({host,publish:({status,language})=>{if(activeStatus)activeStatus.textContent=wordSpeechMessage(status,language)||({speaking:'Воспроизведение…',starting:'Запускаем голос…'}[status]||'')}});
  const stop=()=>{preview.reset();activeStatus=null};
  for(const box of document.querySelectorAll('[data-voice-controls]')){
    const select=(label)=>{const l=document.createElement('label'),s=document.createElement('select');l.append(label,s);box.append(l);return s};
    const lang=select('Язык озвучивания'),voice=select('Голос устройства'),rate=select('Скорость');
    const btn=document.createElement('button');btn.type='button';btn.className='quiet';btn.textContent='Послушать пример';
    const status=document.createElement('p');status.setAttribute('role','status');box.append(btn,status);
    for(const r of speechRates)rate.add(new Option(r.toLocaleString('ru')+'×',r));
    let context=null;
    function sync(){
      const selectedLanguage=language(box)||'en';
      let list=[];try{list=host.speechSynthesis?.getVoices()||[]}catch{}
      let desired=context===selectedLanguage&&lang.value?lang.value:selectedLanguage;context=selectedLanguage;
      const tags=new Set([...Object.keys(samples),selectedLanguage]);lang.replaceChildren(...[...tags].map(k=>new Option(label(k),k)));
      lang.value=desired;
      const pref=voicePreference(host,desired),matches=list.filter(v=>localVoice([v],desired));
      voice.replaceChildren(new Option('Автоматически',''),...matches.map(v=>new Option(v.name+' · '+v.lang,v.voiceURI||v.name)));
      voice.value=matches.some(v=>(v.voiceURI||v.name)===pref.voice)?pref.voice:'';
      voice.disabled=!matches.length;rate.value=String(pref.rate);
      status.textContent=!matches.length?'Браузер не показал установленный голос для этого языка.':'';
      btn.disabled=!samples[desired.split('-')[0]]||!host.speechSynthesis;
    }
    panels.push(sync);
    lang.onchange=()=>{stop();sync()};
    voice.onchange=()=>{stop();voicePreference(host,lang.value,{voice:voice.value});panels.forEach(f=>f())};
    rate.onchange=()=>{stop();voicePreference(host,lang.value,{rate:Number(rate.value)});panels.forEach(f=>f())};
    btn.onclick=event=>{stop();beforeSample();activeStatus=status;preview.speak({event,language:lang.value,text:samples[lang.value.split('-')[0]]})};
    const dialog=box.closest('dialog');
    if(dialog){new MutationObserver(()=>{if(dialog.open)sync();else stop()}).observe(dialog,{attributes:true,attributeFilter:['open']})}
    sync();
  }
  host.speechSynthesis?.addEventListener?.('voiceschanged',()=>panels.forEach(f=>f()));
  host.addEventListener('hashchange',()=>{stop();panels.forEach(f=>f())});
  host.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
}
