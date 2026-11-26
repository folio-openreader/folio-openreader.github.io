import {starterPublicationYear} from './starter-core.js';
// Folio's catalogue is display metadata only. The app opens one local-origin
// book at a time. Filtering, opening and browsing this shelf never prefetch text.
const PAGE=8,LEVELS=['A1','A2','B1','B2','C1','C2'];
const genreNames={
  adventure:'Приключения',children:'Детская классика',classics:'Классика',comedy:'Комедия',
  detective:'Детектив',drama:'Драма',dystopia:'Антиутопия',essays:'Эссе',fairy_tales:'Сказки',
  family:'Семейная проза',fantasy:'Фэнтези',fiction:'Проза',gothic:'Готика',history:'История',
  horror:'Ужасы',memoir:'Мемуары',mystery:'Тайна',nonfiction:'Нон-фикшн',novella:'Повесть',
  philosophy:'Философия',plays:'Пьесы',poetry:'Поэзия',realism:'Реализм',romance:'Романтика',
  satire:'Сатира',science_fiction:'Научная фантастика',short_stories:'Рассказы',travel:'Путешествия',
};
const genreKey=s=>s.toLowerCase().trim().replace(/[\s-]+/gu,'_');
const text=(s,max)=>typeof s==='string'?s.trim().replace(/\s+/gu,' ').slice(0,max):'';
const searchKey=s=>s.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function genreLabel(s){const v=text(s,48),key=genreKey(v);return Object.hasOwn(genreNames,key)?genreNames[key]:v}
const langNames={en:'Английский',ru:'Русский',kk:'Казахский',fr:'Французский',de:'Немецкий',es:'Испанский'};
const langName=code=>Object.hasOwn(langNames,code)?langNames[code]:code.toUpperCase();
function words(n){const i=n%100,u=n%10;return n+' '+(i>=11&&i<=14?'книг':u===1?'книга':u>=2&&u<=4?'книги':'книг')}
// One semantic button per card; this is its visible action affordance.
const actionPath={download:'M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4',reading:'M12 6v14M3 4h4a5 5 0 0 1 5 3 5 5 0 0 1 5-3h4v13h-4a5 5 0 0 0-5 3 5 5 0 0 0-5-3H3z'};
const svgNS='http://www.w3.org/2000/svg';
const markers=['blue','rose','green','ochre','plum','slate'];
function marker(s){let n=0;for(const c of s)n=(n*31+c.codePointAt(0))|0;return markers[(n>>>0)%markers.length]}
function levels(value){
  const found=(Array.isArray(value)?value.join(' '):String(value||'')).toUpperCase().match(/\b[ABC][12]\b/gu)||[];
  const sorted=[...new Set(found)].sort((a,b)=>LEVELS.indexOf(a)-LEVELS.indexOf(b));
  if(!sorted.length)return {tags:[],label:''};
  const left=LEVELS.indexOf(sorted[0]),right=LEVELS.indexOf(sorted.at(-1));
  return {tags:LEVELS.slice(left,right+1),label:left===right?LEVELS[left]:LEVELS[left]+'–'+LEVELS[right]};
}
export function starterEntries(rows){
  if(!Array.isArray(rows))return [];
  const ids=new Set(),out=[];
  for(const row of rows.slice(0,200)){
    if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id||row.id.length>128||ids.has(row.id))continue;
    const title=text(row.title,190),author=text(row.author,120);if(!title)continue;
    const rawGenres=Array.isArray(row.genres)?row.genres:Array.isArray(row.genre)?row.genre:[row.genre];
    const genres=[...new Set(rawGenres.slice(0,5).map(genreLabel).filter(Boolean))];
    const rawLevel=row.level??row.difficulty??row.levels;
    const level=levels(typeof rawLevel==='object'&&!Array.isArray(rawLevel)?rawLevel?.label:rawLevel);
    const language=text(row.language||row.lang,35).replaceAll('_','-'),lang=language.toLowerCase().split('-')[0];
    const year=starterPublicationYear(row.edition?.publicationYear);
    const search=searchKey([title,author,text(row.titleRu,190),text(row.authorRu,120),year,...genres,level.label,langName(lang)].join(' '));
    ids.add(row.id);out.push({id:row.id,book:row,title,author,year,genres,level,language,lang,search,marker:marker(row.id)});
  }
  return out;
}
export function filterStarters(entries,{query='',genre='',level='',language=''}={}){
  const tokens=searchKey(typeof query==='string'?query.slice(0,160):'').split(' ').filter(Boolean);
  const matchesToken=(book,token)=>{
    if(book.search.includes(token))return true;
    if(typeof book.year!=='string'||!(/^[0-9]{4}$/.test(token)))return false;
    // Searching a year within a validated serial span should find the book too.
    const year=Number(token),first=Number(book.year.slice(0,4)),last=Number(book.year.slice(-4));
    return first<=year&&year<=last;
  };
  return entries.filter(b=>(!genre||b.genres.includes(genre))&&(!level||b.level.tags.includes(level))&&(!language||b.lang===language)&&tokens.every(t=>matchesToken(b,t)));
}

export function installStarterShelf(root,{loadCatalog,openBook,getProgress=()=>null}={}){
  if(!root||typeof loadCatalog!=='function'||typeof openBook!=='function')throw new TypeError('Starter shelf needs its host, a metadata loader and an opener.');
  const d=root.ownerDocument;
  const el=(tag,cls='',copy='')=>{const node=d.createElement(tag);if(cls)node.className=cls;if(copy)node.textContent=copy;return node};
  const node=(tag,text,cls='')=>el(tag,cls,text);
  const btn=(copy,cls)=>{const b=node('button',copy,cls);b.type='button';return b};
  const header=el('div','starter-head'),headText=el('div'),
    title=node('h2','Каталог'),copy=node('p','Полные тексты · без параллельного перевода','starter-description'),
    total=node('span','','starter-total');
  title.id='starter-title';root.setAttribute('aria-labelledby',title.id);root.classList.add('starter-shelf');
  total.hidden=true;headText.append(title,copy);header.append(headText,total);
  const filters=el('div','starter-filters');filters.hidden=true;
  const field=(caption,element,cls='')=>{const l=node('label','',cls);l.append(node('span',caption,'sr-only'),element);return l};
  const q=el('input','starter-search');q.type='search';q.placeholder='Название, автор или год';q.autocomplete='off';q.spellcheck=false;q.maxLength=160;q.enterKeyHint='search';
  const genre=el('select','starter-select'),level=el('select','starter-select'),language=el('select','starter-select');
  const languageField=field('Язык стартовых книг',language,'starter-language-field');
  const option=(value,copy)=>{const o=node('option',copy);o.value=value;return o};
  filters.append(field('Поиск стартовых книг',q,'starter-search-field'),field('Жанр стартовых книг',genre),field('Сложность стартовых книг',level),languageField);
  const explanation=node('p','Уровень ориентировочный. Издания не адаптированы.','starter-about');
  explanation.hidden=true;
  const notice=el('p','starter-status');notice.setAttribute('role','status');notice.setAttribute('aria-atomic','true');
  const list=el('ul','starter-grid');list.setAttribute('aria-label','Стартовые книги');
  const actions=el('div','starter-actions'),more=btn('Показать ещё','quiet starter-more'),reset=btn('Сбросить фильтры','quiet starter-more'),
    retry=btn('Повторить загрузку','quiet starter-more');
  for(const b of [more,reset,retry])b.hidden=true;
  actions.append(more,reset,retry);root.replaceChildren(header,filters,explanation,notice,list,actions);
  let entries=null,loading=null,pending='',openRequest=0,limit=PAGE,openError='',buttons=new Map();
  const alive=()=>root.isConnected;
  function focusBook(id){const b=buttons.get(id)?.button;if(!b?.isConnected)return false;b.focus({preventScroll:true});return true}
  function updatePending(){
    for(const [id,{button,available}] of buttons){
      const active=id===pending;button.toggleAttribute('data-book-loading',active);
      if(pending&&(active||!available))button.setAttribute('aria-disabled','true');else button.removeAttribute('aria-disabled');
      if(active)button.setAttribute('aria-busy','true');else button.removeAttribute('aria-busy');
    }
  }
  async function pick(entry,event){
    // A pending download blocks other uncached titles, not books on the device.
    const available=score(entry)!==null;
    if(pending&&(pending===entry.id||!available))return;
    const request=++openRequest;
    pending=entry.id;openError='';notice.textContent='Открываем «'+entry.title+'»…';updatePending();
    try{await openBook(entry.book,event)}
    catch{if(request===openRequest)openError='Не удалось открыть «'+entry.title+'». Попробуйте ещё раз.';}
    finally{if(request===openRequest){pending='';if(alive()){updatePending();updateStatus()}}}
  }
  function score(entry){
    try{const raw=getProgress(entry.book);if(Number.isFinite(raw)&&raw>=0)return Math.min(100,Math.round(raw))}catch{}
    return null;
  }
  function card(entry){
    const item=el('li','starter-item'),button=btn('','starter-card'),cover=el('span','starter-cover'),
      mark=el('span','starter-cover-book'),content=el('span','starter-card-copy'),row=el('span','starter-card-tags');
    button.dataset.starterBook=entry.id;cover.dataset.palette=entry.marker;cover.setAttribute('aria-hidden','true');
    cover.append(mark);
    if(/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})?$/u.test(entry.language)){
      const stamp=node('span',entry.language.split('-')[0].toUpperCase(),'starter-cover-language');cover.append(stamp);
    }
    const heading=node('bdi',entry.title,'starter-book-title');if(entry.language)heading.lang=entry.language;
    content.append(heading);
    if(entry.author){const by=node('bdi',entry.author,'starter-book-author');if(entry.language)by.lang=entry.language;content.append(by)}
    if(entry.level.label){const tag=node('span',entry.level.label,'starter-level');tag.title='Примерная сложность';row.append(tag)}
    if(entry.year)row.append(node('span',String(entry.year),'starter-genre starter-publication-year'));
    if(entry.genres.length)row.append(node('span',entry.genres[0],'starter-genre'));
    if(row.children.length)content.append(row);
    const percent=score(entry),normal=percent!==null?'Продолжить':'Скачать и читать',
      footer=el('span','starter-card-footer'),cta=el('span','starter-card-cta'),
      glyph=d.createElementNS(svgNS,'svg'),path=d.createElementNS(svgNS,'path');
    glyph.setAttribute('viewBox','0 0 24 24');glyph.setAttribute('focusable','false');
    path.setAttribute('d',actionPath[percent===null?'download':'reading']);
    glyph.append(path);cta.append(glyph);cta.setAttribute('aria-hidden','true');
    button.title=normal;
    button.setAttribute('aria-label',normal+': '+entry.title+(entry.author?', '+entry.author:'')+(entry.year?', '+entry.year:'')+(entry.level.label?', сложность '+entry.level.label:'')+(entry.lang?', '+langName(entry.lang):''));
    if(percent!==null)footer.append(node('span','Прочитано '+percent+'%','starter-reading-progress'));
    footer.append(cta);content.append(footer);button.append(cover,content);item.append(button);
    button.addEventListener('click',e=>void pick(entry,e));
    buttons.set(entry.id,{button,available:percent!==null});return item;
  }
  function selected(){return filterStarters(entries||[],{query:q.value,genre:genre.value,level:level.value,language:language.value})}
  function updateStatus(match=selected()){
    if(pending)return;
    const any=!!(q.value||genre.value||level.value||language.value),filtered=entries?.length||0;
    reset.hidden=!any;
    notice.textContent=openError||(!filtered?'В каталоге пока нет книг.':
      !match.length?'Ничего не найдено. Попробуйте другое название или сбросьте фильтры.':
      any?'Найдено: '+words(match.length):'');
    more.hidden=limit>=match.length;
    if(!more.hidden){const extra=Math.min(PAGE,match.length-limit);more.textContent='Показать ещё '+extra}
  }
  function paint({focusNew=false}={}){
    const match=selected(),next=focusNew?match[limit-PAGE]?.id:null,active=d.activeElement?.dataset?.starterBook;
    buttons=new Map();
    const group=d.createDocumentFragment();for(const entry of match.slice(0,limit))group.append(card(entry));
    list.replaceChildren(group);updateStatus(match);updatePending();
    if(next)focusBook(next);else if(active)focusBook(active);
  }
  function fillSelects(){
    const allGenres=[...new Set(entries.flatMap(b=>b.genres))].sort((a,b)=>a.localeCompare(b,'ru'));
    const allLevels=LEVELS.filter(l=>entries.some(b=>b.level.tags.includes(l)));
    genre.replaceChildren(option('','Все жанры'),...allGenres.map(g=>option(g,g)));
    level.replaceChildren(option('','Все уровни'),...allLevels.map(l=>option(l,l)));
    const languages=[...new Set(entries.map(b=>b.lang).filter(Boolean))].sort((a,b)=>langName(a).localeCompare(langName(b),'ru'));
    language.replaceChildren(option('','Все языки'),...languages.map(l=>option(l,langName(l))));
    languageField.hidden=languages.length<2;filters.classList.toggle('has-language',languages.length>1);
    genre.disabled=!allGenres.length;level.disabled=!allLevels.length;
    explanation.hidden=!allLevels.length;
  }
  function refresh(){
    if(!alive())return;
    if(entries){paint();return}
    if(loading)return loading;
    notice.textContent='Загружаем список книг…';retry.hidden=true;
    root.setAttribute('aria-busy','true');
    loading=Promise.resolve().then(loadCatalog).then(rows=>{
      if(!Array.isArray(rows))throw new TypeError('Invalid starter metadata');
      entries=starterEntries(rows);
      if(!alive())return;
      total.textContent=words(entries.length);total.hidden=!entries.length;
      filters.hidden=!entries.length;fillSelects();paint();
    }).catch(()=>{
      if(!alive())return;
      notice.textContent='Не удалось загрузить список книг.';retry.hidden=false;
    }).finally(()=>{loading=null;root.removeAttribute('aria-busy')});
    return loading;
  }
  const changed=()=>{limit=PAGE;openError='';paint()};
  q.addEventListener('input',changed);genre.addEventListener('change',changed);level.addEventListener('change',changed);language.addEventListener('change',changed);
  more.addEventListener('click',()=>{limit+=PAGE;paint({focusNew:true})});
  reset.addEventListener('click',()=>{q.value=genre.value=level.value=language.value='';changed();q.focus({preventScroll:true})});
  retry.addEventListener('click',()=>void refresh());
  return {refresh,focusBook};
}
