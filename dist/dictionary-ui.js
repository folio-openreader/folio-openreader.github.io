import {fillLanguages,pairPacks,hasBuiltIn} from './language-pairs.js';
// Profile installer and in-reader recommendation. Progress belongs to one real task,
// even if the reader closes the sheet or switches tabs mid-download.
const $=s=>document.querySelector(s);
const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};
const nf=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
export const formatBytes=b=>b>=1048576?nf.format(b/1048576)+' МиБ':b>=1024?nf.format(b/1024)+' КиБ':b+' Б';
const pair=p=>p.language.toUpperCase()+' → '+p.target.toUpperCase();
const plural=n=>n%10===1&&n%100!==11?'источник':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'источника':'источников';
const sourceName=e=>(e.sources?.length?e.sources.map(s=>s.packId?.startsWith('local-')?s.title+(s.source?' · '+s.source:''):s.source||s.title):[e.source||e.packTitle]).filter(Boolean);
const titleOf=e=>[...new Set(sourceName(e))].join(' · ');
const wordMeaning=e=>e.translation?.trim()||e.definition?.trim()||'';
const safeSourceUrl=url=>{try{const x=new URL(url,location.href);return ['https:','http:'].includes(x.protocol)?x.href:''}catch{return ''}};
export function renderSenses(result,lang,target){
  const entries=(result?.entries||[]).filter(wordMeaning),control=$('#word-senses-toggle'),list=$('#word-senses');
  control.hidden=!entries.length;
  if(!entries.length){control.setAttribute('aria-expanded','false');list.hidden=true;list.replaceChildren();return}
  const top=entries[0],label=top.target===lang&&lang!==target?'Определение · '+lang.toUpperCase():(top.target||target).toUpperCase();
  control.textContent=(top.matchType==='inferred'?'≈ ':'')+label+' · '+(entries.length>1?'Значения ('+entries.length+')':'Источник');
  control.setAttribute('aria-label','Значения и источники: '+(titleOf(top)||label));
  list.replaceChildren(make('h3','Значения и источники'));
  const buckets=new Map();
  for(const e of entries){const k=e.target||target;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(e)}
  for(const [language,bucket] of buckets){
    const ol=make('ol'),section=make('section');
    if(buckets.size>1)section.append(make('h4',(language===lang?'Определения':'Переводы')+' · '+language.toUpperCase()+' · '+bucket.length));
    section.append(ol);list.append(section);
    const more=make('button','Ещё значения','quiet');let visible=0;
    function next(){
     for(const e of bucket.slice(visible,visible+6)){
    const row=make('li'),col=make('div');
    const meaning=make('div',wordMeaning(e));meaning.lang=e.target||target;col.append(meaning);
    if(e.definition?.trim()&&e.translation?.trim()&&e.definition.trim()!==e.translation.trim()){
      col.append(make('div',e.definition,'sense-label'));
    }
    if(e.example)col.append(make('div',e.example,'sense-example'));
    const inflected=e.matchType==='inferred'?'Возможная форма: '+e.headword:e.matchType==='alias'?'Форма: '+e.headword:'';
    col.append(make('div',[e.pos,(e.target||target).toUpperCase(),titleOf(e),inflected].filter(Boolean).join(' · '),'sense-label'));
    if(e.pronunciation&&e===top)col.append(make('div',e.pronunciation,'sense-label'));
    row.append(col);ol.append(row);
     }
     visible+=6;more.hidden=visible>=bucket.length;
    }
    next();if(!more.hidden){more.onclick=next;section.append(more)}
  }
}
export function dictionaryControls({load,getPrefs,changePrefs,onChange,onSources}){
  let installed=null,active=null,notice='',readerNotice='',error='',scan=0,word=null,bundleLanguage=getPrefs().readingLanguage||'en',bundleTarget=getPrefs().dictionaryTarget||'ru';
  const hintOffered=new Set();
  const byId=id=>installed?.find(p=>p.id===id),done=p=>!!byId(p.id)&&(!p.version||p.version===byId(p.id).version)&&(!p.manifestSha256||p.manifestSha256===byId(p.id).manifestSha256);
  const all=()=>api?.recommendedPacks||[];
  const bundle=(language,target)=>pairPacks(all(),language,target);
  let api=null;
  function hideHint(){word=null;$('#word-dict-hint').hidden=true;readerNotice='';syncTask()}
  function controlsWord(info){
    // This function is called only for the currently open word (the caller checks its sequence).
    if(!word||word.seq!==info.seq){word={...info,offered:false};readerNotice=''}else Object.assign(word,info);
    drawHint();
  }
  function drawHint(){
    const box=$('#word-dict-hint');box.hidden=true;
    if(!word||installed===null||!api||active||word.hasResult||error)return;
    const suitable=bundle(word.language,word.target);
    const relevant=suitable.filter(p=>!done(p));
    if(!relevant.length)return;
    const key='folio-dict-hint-v2:'+word.language+':'+word.target;let seen=hintOffered.has(key);try{seen=seen||localStorage.getItem(key)==='seen'}catch{}
    if(!word.offered&&seen)return;
    word.offered=true;
    // Mark only when there is a useful action for this word, never on a base hit or unsupported language.
    hintOffered.add(key);try{localStorage.setItem(key,'seen')}catch{}
    const pending=relevant;
    $('#word-install-note').textContent='Можно искать и в других словарях: '+[...new Set(relevant.map(pair))].join(', ')+'.';
    $('#word-install').textContent='Скачать набор · '+formatBytes(pending.reduce((s,p)=>s+(p.bytes||0),0));
    box.hidden=false;
  }
  function syncTask(){
    for(const [id,withinWord] of [['#dictionary-task',false],['#word-dict-task',true]]){
      const el=$(id);el.hidden=!active||withinWord&&!$('#word-dialog').open;
      if(!active)continue;
      const {total,bytes,position,count,title,phase}=active;
      const bar=el.querySelector('progress');bar.max=total||1;bar.value=Math.min(bytes||0,total||1);
      const copy=(phase==='index'?'Сохраняем':'Загружаем')+' · '+position+'/'+count+' · '+title+' · '+formatBytes(bytes||0)+' из '+formatBytes(total||0);
      el.querySelector('[data-task-copy]').textContent=copy;
      el.querySelector('[data-dict-cancel]').disabled=active.controller.signal.aborted;
      if(active.controller.signal.aborted)el.querySelector('[data-task-copy]').textContent='Отменяем установку…';
    }
    $('#dictionary-status').textContent=error||notice;$('#word-dict-status').textContent=readerNotice;
  }
  function draw(){
    const install=$('#bundle-install'),selector=$('#active-dictionary'),target=$('#dictionary-target'),list=$('#dictionary-packs');
    $('#bundle-language').disabled=$('#bundle-target').disabled=!!active;install.hidden=true;selector.disabled=target.disabled=!!active||installed===null;list.replaceChildren();
    $('#dictionary-import').disabled=!!active||installed===null;
    if(installed===null||!api){
      $('#bundle-note').textContent=error||'Проверяем установленные источники…';syncTask();return;
    }
    const catalog=bundle(bundleLanguage,bundleTarget),pending=catalog.filter(p=>!done(p)),size=pending.reduce((s,p)=>s+(p.bytes||0),0);
    const current=catalog.length-pending.length,labels=[...new Set(catalog.map(pair))].join(', ');
    $('#bundle-title').textContent=!catalog.length?'Дополнительные источники':!pending.length?'Набор установлен':'Расширить поиск слов';
    $('#bundle-note').textContent=!catalog.length?(hasBuiltIn(bundleLanguage,bundleTarget)?'Базовый словарь доступен. ':'Готового пакета для этой пары нет. ')+'Можно добавить свой файл ниже.':
      !pending.length?catalog.length+' '+plural(catalog.length)+' · '+labels+'. Поиск доступен без сети в открытой читалке.':
      labels+' · '+catalog.length+' '+plural(catalog.length)+'. '+(current?'Уже установлено: '+current+'. ':'')+'Установите один раз для этой языковой пары.';
    install.textContent=(current?'Докачать словари':pending.length===1?'Скачать словарь':'Скачать словари')+' · '+formatBytes(size);
    install.hidden=!pending.length||!!active;
    selector.replaceChildren(new Option('Автоматически · все источники',''));
    for(const p of installed)selector.append(new Option(p.title+' · '+pair(p),p.id));
    selector.value=byId(getPrefs().dictionaryPack)?getPrefs().dictionaryPack:'';
    target.value=getPrefs().dictionaryTarget;
    const packs=[...api.dictionaryPacks,...installed.filter(p=>!api.dictionaryPacks.some(s=>s.id===p.id))];
    for(const p of pairPacks(packs,bundleLanguage,bundleTarget)){
      const local=byId(p.id),row=make('div',null,'dictionary-pack'),buttons=make('div',null,'pack-actions');
      row.dataset.pack=p.id;row.append(make('strong',p.title));
      const count=local?.count||p.count;
      row.append(make('p',[pair(p),count?count.toLocaleString('ru-RU')+' статей':null,p.bytes?formatBytes(p.bytes):null,local?(done(p)?'установлен':'доступно обновление'):'не установлен'].filter(Boolean).join(' · ')));
      if(p.description)row.append(make('p',p.description));
      const credits=make('p',[p.source,p.license].filter(Boolean).join(' · ')),href=p.sourceUrl&&safeSourceUrl(p.sourceUrl);
      for(const [label,url] of [['Издатель',href],['Условия и авторство',p.noticeUrl&&safeSourceUrl(p.noticeUrl)]])if(url){const a=make('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';credits.append(document.createTextNode(' · '),a)}row.append(credits);
      if(local?.notice){const detail=make('details'),body=make('p',local.notice,'notice-copy');detail.append(make('summary','Авторство · на устройстве'),body);row.append(detail)}
      if(!local||!done(p)){const b=make('button',local?'Обновить':'Скачать','quiet');b.disabled=!!active;b.onclick=()=>installList([p]);buttons.append(b)}
      if(local){const b=make('button','Удалить','quiet');b.setAttribute('aria-label','Удалить словарь '+p.title);b.disabled=!!active;b.onclick=()=>remove(p);buttons.append(b)}
      row.append(buttons);list.append(row);
    }
    drawHint();syncTask();
  }
  async function refresh({repaintWord=false}={}){
    const seq=++scan;
    try{
      const mod=await load();if(!mod)throw Error('Модуль словарей недоступен.');
      const packs=await mod.getInstalledDictionaries();if(seq!==scan)return;
      api=mod;installed=packs;error='';
    }catch(e){if(seq!==scan)return;installed=null;error=e.message||'Локальное хранилище словарей недоступно.'}
    draw();onSources?.();if(repaintWord)onChange();
  }
  async function installList(catalog){
    if(active||!api)return;
    const pending=catalog.filter(p=>!done(p));if(!pending.length)return;
    const controller=new AbortController(),job=active={controller,total:pending.reduce((s,p)=>s+(p.bytes||0),0),bytes:0,position:1,count:pending.length,title:pending[0].title,phase:'download'};
    error=notice=readerNotice='';draw();$('#word-dict-hint').hidden=true;
    let completedBytes=0,finished=0;
    try{
      for(const [i,p] of pending.entries()){
        controller.signal.throwIfAborted();Object.assign(job,{position:i+1,title:p.title,phase:'download',bytes:completedBytes});syncTask();
        await api.installDictionary(p.id,{signal:controller.signal,onProgress:e=>{
          if(active!==job)return;job.phase=e.phase;job.bytes=completedBytes+Math.min(p.bytes||e.totalBytes||0,e.bytes||0);
          if(!p.bytes&&e.totalBytes)job.total=completedBytes+e.totalBytes;syncTask();
        }});
        completedBytes+=p.bytes||Math.max(0,job.bytes-completedBytes);finished++;
      }
      const local=await api.getInstalledDictionaries();if(!pending.every(p=>local.some(x=>x.id===p.id&&(!p.version||x.version===p.version)&&(!p.manifestSha256||x.manifestSha256===p.manifestSha256))))throw Error('Не все источники сохранились.');
      notice=finished===1?'Словарь установлен.':'Набор установлен. Можно вернуться к чтению.';
      readerNotice=notice;
    }catch(e){
      notice=controller.signal.aborted?'Установка отменена.':e?.name==='QuotaExceededError'?'Недостаточно места для словарей.':(e?.message||'Не удалось установить словарь.');
      if(finished)notice+=' Сохранено источников: '+finished+'.';notice+=' Можно повторить загрузку.';readerNotice=notice;
    }finally{active=null;await refresh();onChange();syncTask()}
  }
  async function remove(p){
    if(active||!api||!confirm('Удалить «'+p.title+'» из этого браузера? Книги и изученные слова останутся.'))return;
    try{await api.removeDictionary(p.id);if(getPrefs().dictionaryPack===p.id)changePrefs({dictionaryPack:''});notice='Словарь удалён.'}catch(e){notice=e.message||'Не удалось удалить словарь.'}
    await refresh({repaintWord:true});
  }
  for(const [id,value] of [['bundle-language',bundleLanguage],['bundle-target',bundleTarget],['dict-source-language',bundleLanguage],['dict-target-language',bundleTarget],['dictionary-target',bundleTarget]])fillLanguages($('#'+id),value);
  function selectPair(language,target){
    bundleLanguage=language;bundleTarget=target;
    $('#bundle-language').value=$('#dict-source-language').value=language;
    $('#bundle-target').value=$('#dict-target-language').value=target;
    draw();
  }
  $('#bundle-language').onchange=e=>selectPair(e.target.value,bundleTarget);
  $('#bundle-target').onchange=e=>selectPair(bundleLanguage,e.target.value);
  $('#bundle-install').onclick=()=>installList(bundle(bundleLanguage,bundleTarget));
  $('#word-install').onclick=()=>{if(word){selectPair(word.language,word.target);installList(bundle(word.language,word.target))}};
  for(const b of document.querySelectorAll('[data-dict-cancel]'))b.onclick=()=>{active?.controller.abort();syncTask()};
  $('#active-dictionary').onchange=e=>{const p=byId(e.target.value);changePrefs(p?{dictionaryPack:p.id,dictionaryTarget:p.target}:{dictionaryPack:''});draw();onChange()};
  $('#dictionary-target').onchange=e=>{changePrefs({dictionaryTarget:e.target.value,dictionaryPack:''});draw();onChange()};
  $('#word-senses-toggle').onclick=()=>{const box=$('#word-senses'),btn=$('#word-senses-toggle');box.hidden=!box.hidden;btn.setAttribute('aria-expanded',String(!box.hidden))};
  return {refresh,selectPair,controlsWord,hideHint,get installed(){return installed||[]},get busy(){return !!active},status:s=>{notice=s;syncTask()},installList};
}
