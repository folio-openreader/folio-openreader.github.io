import {languages} from './language-pairs.js';
import {isStarterId,starterPublicationYear,starterSourceURL} from './starter-core.js';
import {isResearchId} from './research-core.js';
import {sanitizeNewsPhoto} from './news-photo.js';
import {isNewsId} from './news-core.js';
import {DEFAULT_READING_FONT, normalizeReadingFont} from './reading-fonts.js';
export const DEMO_ID = 'folio-night-ferry';
export const ACCENTS = [
  {value:'#79503a', label:'Ореховый (по умолчанию)'},
  {value:'#027dfb', label:'Синий'},
  {value:'#ea6a24', label:'Оранжевый'},
  {value:'#5655bb', label:'Индиго'},
  {value:'#19695e', label:'Можжевельник'},
  {value:'#1b61a5', label:'Океан'},
  {value:'#a04455', label:'Роза'},
  {value:'#89501d', label:'Терракота'},
  {value:'#69439c', label:'Слива'},
];
export const DEFAULT_PREFS = Object.freeze({size:21, theme:'paper', font:DEFAULT_READING_FONT, accent:ACCENTS[0].value, readingLanguage:'en', languageSetup:'unset', dictionaryTarget:'ru', dictionaryPack:'', autoSaveWords:true, haptics:true, practiceSound:false, iphoneCheckHaptic:false});
export const THEMES = Object.freeze({
  light:{surface:'#ffffff',bg:'#ffffff',ink:'#000000',scheme:'light'},
  paper:{surface:'#fcf8ec',bg:'#f4efdf',ink:'#36342d',scheme:'light'},
  linen:{surface:'#f0f2ea',bg:'#e4e9de',ink:'#243126',subtle:'#dfe6d9',scheme:'light'},
  ink:{surface:'#202f37',bg:'#17242b',ink:'#ebf1f0',subtle:'#263943',scheme:'dark'},
  night:{surface:'#171717',bg:'#101010',ink:'#f5f5f5',scheme:'dark'},
});
export const BACKUP_LIMIT = 50 * 1024 * 1024;
export const BACKUP_BOOK_LIMIT = 1000;
const HEX=/^#[0-9a-f]{6}$/i, BOOK_ID=/^book-[0-9a-f-]{36}$/i;
const object=value=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const safeString=(value,limit=300)=>typeof value==='string'?value.slice(0,limit):'';
const bounded=(x,min,max)=>Math.max(min,Math.min(max,x));
export function sanitizePrefs(raw={}) {
  const p=object(raw)?raw:{};
  return {
    size:typeof p.size==='number'&&Number.isFinite(p.size)?bounded(Math.round(p.size),17,30):DEFAULT_PREFS.size,
    theme:typeof p.theme==='string'&&Object.hasOwn(THEMES,p.theme)?p.theme:DEFAULT_PREFS.theme,
    font:normalizeReadingFont(p.font),
    accent:HEX.test(p.accent||'')?p.accent.toLowerCase():DEFAULT_PREFS.accent,
    autoSaveWords:p.autoSaveWords!==false,
    haptics:p.haptics!==false,
    practiceSound:p.practiceSound===true,
    iphoneCheckHaptic:p.iphoneCheckHaptic===true,
    readingLanguage:typeof p.readingLanguage==='string'&&Object.hasOwn(languages,p.readingLanguage)?p.readingLanguage:DEFAULT_PREFS.readingLanguage,
    languageSetup:['done','pending'].includes(p.languageSetup)?p.languageSetup:'unset',
    dictionaryTarget:typeof p.dictionaryTarget==='string'&&Object.hasOwn(languages,p.dictionaryTarget)?p.dictionaryTarget:DEFAULT_PREFS.dictionaryTarget,
    dictionaryPack: typeof p.dictionaryPack==='string'&&/^[a-z0-9-]{1,150}$/i.test(p.dictionaryPack)?p.dictionaryPack:'',
  };
}
const channels=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
function mix(a,b,p) {const x=channels(a),y=channels(b);return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*p).toString(16).padStart(2,'0')).join('')}
function luma(hex){return channels(hex).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)}
export function contrast(a,b){const l=[luma(a),luma(b)].sort((x,y)=>y-x);return (l[0]+.05)/(l[1]+.05)}
export function accentPalette(prefs) {
  const p=sanitizePrefs(prefs),t=THEMES[p.theme],dark=t.scheme==='dark',toward=dark?'#ffffff':'#000000';
  let accent=p.accent;
  for(let i=0;i<=100;i++){accent=mix(p.accent,toward,i/100);if(Math.min(contrast(accent,t.bg),contrast(accent,t.surface),contrast(accent,t.subtle||t.surface))>=4.9)break}
  const onAccent=contrast(accent,'#ffffff')>=4.5?'#ffffff':'#000000';
  const soft=mix(t.surface,accent,dark?.18:.09);
  return {accent,onAccent,soft,selection:mix(t.surface,accent,dark?.27:.18),focus:accent,themeColor:t.bg};
}
export function searchKey(text) {
  // Match the same in-word punctuation variants saved by the vocabulary.
  // Preserve real en/em dashes; a discretionary soft hyphen is only layout.
  return String(text).normalize('NFKC').replaceAll('\u00ad','').replace(/[‘’ʼ]/gu,"'").replace(/[‐‑]/gu,'-')
    .toLocaleLowerCase().replaceAll('ё','е').trim();
}
export function sanitizeSaved(words) {
  return [...new Set((Array.isArray(words)?words:[]).filter(w=>typeof w==='string').map(w=>w.trim().slice(0,128)).filter(Boolean))].slice(0,20000);
}
export function safePosition(p,book) {
  if(!object(p)||!Number.isInteger(p.chapter)||!Number.isInteger(p.paragraph))return null;
  if(p.chapter<0||p.paragraph<0||!book?.chapters[p.chapter]?.paragraphs[p.paragraph])return null;
  const fraction=typeof p.fraction==='number'&&Number.isFinite(p.fraction)?bounded(p.fraction,0,.99):0;
  const position={chapter:p.chapter,paragraph:p.paragraph,fraction};
  if(book.kind==='comic'&&Number.isFinite(p.comicImageOffset)&&p.comicImageOffset>=0&&p.comicImageOffset<=1)
    position.comicImageOffset=p.comicImageOffset;
  if(book.kind!=='comic'&&book.chapters.length===1&&book.chapters[0].paragraphs.length===1&&
     Number.isFinite(p.soloScrollProgress)&&p.soloScrollProgress>=0&&p.soloScrollProgress<=1)
    position.soloScrollProgress=p.soloScrollProgress;
  if(book.kind!=='comic'&&p.textEnd===true&&p.chapter===book.chapters.length-1&&
     (book.chapters.length>1||book.chapters[0].paragraphs.length>1))position.textEnd=true;
  if(book.kind!=='comic'&&p.chapterTop===true&&p.paragraph===0&&fraction===0)position.chapterTop=true;
  else if(Number.isFinite(p.viewportDelta)&&Math.abs(p.viewportDelta)<=512&&p.viewportDelta!==0)position.viewportDelta=p.viewportDelta;
  return position;
}
// Keep OCR diagnostics portable without storing images or duplicate preview excerpts.
export function sanitizeOcr(raw) {
  if(!object(raw))return null;
  const page=n=>Number.isInteger(n)&&n>=1&&n<=1000;
  const numbers=value=>[...new Set((Array.isArray(value)?value:[]).slice(0,150).filter(page))];
  const pages=numbers(raw.pages), known=new Set(pages), scores=new Map();
  for(const v of (Array.isArray(raw.confidence)?raw.confidence:[]).slice(0,150)){
    if(object(v)&&known.has(v.page)&&(v.value===null||(Number.isFinite(v.value)&&v.value>=0&&v.value<=100)))scores.set(v.page,v.value);
  }
  return {pages,uncertain:numbers(raw.uncertain).filter(n=>known.has(n)),unreadable:numbers(raw.unreadable),
    confidence:[...scores].map(([page,value])=>({page,value})),languages:[...new Set((Array.isArray(raw.languages)?raw.languages:[]).slice(0,3).filter(v=>['eng','rus','kaz'].includes(v)))]};
}
function editorialEdition(raw,kind){
  if(!object(raw))return null;
  const allowed=(value,hosts,path)=>{
    try{const u=new URL(value);return u.protocol==='https:'&&!u.port&&!u.username&&!u.password&&hosts.includes(u.hostname)&&path.test(u.pathname+u.search)&&!u.hash?u.href:''}
    catch{return ''}
  };
  const sourceUrl=kind==='news'?allowed(raw.sourceUrl,['en.wikipedia.org'],/^\/w\/index\.php\?oldid=[1-9]\d*$/):
    allowed(raw.sourceUrl,['elifesciences.org','joss.theoj.org'],/^\/(?:articles\/\d+|papers\/10\.21105\/joss\.\d+)$/);
  const license=kind==='news'?'CC BY-SA 4.0':'CC BY 4.0';
  if(!sourceUrl)return null;
  const photo=kind==='news'?sanitizeNewsPhoto(raw.photo):null;
  return {...(photo?{photo}:{}),source:safeString(raw.source,100),sourceUrl,license,licenseUrl:'https://creativecommons.org/licenses/'+(kind==='news'?'by-sa':'by')+'/4.0/',
    attribution:safeString(raw.attribution,940),changes:safeString(raw.changes,350),doi:safeString(raw.doi,100)};
}
function bookFromBackup(b) {
  const invalid=()=>{throw new Error('В копии есть книга с повреждённым форматом.')};
  const kind=isResearchId(b?.id)?'research':isNewsId(b?.id)?'news':null;
  if(!object(b)||(!BOOK_ID.test(b.id||'')&&!isStarterId(b.id)&&!kind)||!Array.isArray(b.chapters)||!b.chapters.length||b.chapters.length>1024||!['TXT','EPUB','PDF','PNG','JPEG','WEBP'].includes(b.format))invalid();
  let count=0,chars=0,anyTranslation=false;
  const chapters=b.chapters.map(c=>{
    if(!object(c)||!Array.isArray(c.paragraphs)||!c.paragraphs.length)invalid();
    const paragraphs=c.paragraphs.map(p=>{
      if(!object(p)||typeof p.text!=='string'||!p.text.trim()||!(p.translation==null||typeof p.translation==='string'))invalid();
      const translation=p.translation||null;
      if(translation)anyTranslation=true;
      if(++count>16000||(chars+=p.text.length+(translation?.length||0))>8*1024*1024)invalid();
      return {text:p.text,translation};
    });
    return {title:safeString(c.title,1000)||'Текст',paragraphs};
  });
  const ocr=sanitizeOcr(b.ocr),translationOcr=sanitizeOcr(b.translationOcr);
  const warnings=(Array.isArray(b.warnings)?b.warnings:[]).slice(0,20).map(x=>safeString(x,600)).filter(Boolean);
  let edition;
  if(isStarterId(b.id)&&object(b.edition)){
    const sourceUrl=starterSourceURL(b.edition.sourceUrl);
    if(sourceUrl)edition={source:safeString(b.edition.source,100),sourceUrl,translator:safeString(b.edition.translator,140),publicationYear:starterPublicationYear(b.edition.publicationYear)};
  }
  if(kind){edition=editorialEdition(b.edition,kind);if(!edition||b.format!=='TXT'||b.language!=='en')invalid()}
  return {...(kind?{kind}:{}),...(edition?{edition}:{}),...(ocr?{ocr}:{}),...(translationOcr?{translationOcr}:{}),...(warnings.length?{warnings}:{}),id:b.id,title:safeString(b.title,1000)||'Без названия',author:safeString(b.author,1000),language:safeString(b.language,40),translationTitle:safeString(b.translationTitle,1000),translationLanguage:safeString(b.translationLanguage,40),format:b.format,alignment:anyTranslation?'positional-unverified':'none',chapters,createdAt:Number.isFinite(b.createdAt)?b.createdAt:0};
}
export function serializeBackup(books,state,words,learning) {
  const included=books.filter(b=>b.id!==DEMO_ID&&b.kind!=='comic');
  if(included.length>BACKUP_BOOK_LIMIT)throw new RangeError('Не удалось создать копию: больше '+BACKUP_BOOK_LIMIT+' текстовых книг.');
  return JSON.stringify({format:'folio-backup',version:1,createdAt:new Date().toISOString(),books:included.map(({localTranslationGeneration,...book})=>({...book,chapters:book.chapters.map(({illustrations,...chapter})=>chapter)})),state:{positions:state.positions,bookmarks:state.bookmarks,lastBook:state.lastBook,prefs:sanitizePrefs(state.prefs)},words:sanitizeSaved(words),...(learning?{learning}:{})});
}
export function parseBackup(text,demo) {
  let raw;try{raw=JSON.parse(text)}catch{throw new Error('Не удалось прочитать JSON. Выберите копию Folio.')};
  if(!object(raw)||raw.format!=='folio-backup'||raw.version!==1||!Array.isArray(raw.books)||!object(raw.state)||!Array.isArray(raw.words))throw new Error('Файл не похож на поддерживаемую копию Folio.');
  if(raw.books.length>BACKUP_BOOK_LIMIT)throw new RangeError('В копии больше '+BACKUP_BOOK_LIMIT+' текстовых книг.');
  const books=raw.books.map(bookFromBackup),ids=new Set(books.map(b=>b.id));
  if(ids.size!==books.length)throw new Error('В копии есть повторяющиеся идентификаторы книг.');
  const positions=Object.create(null),bookmarks=Object.create(null);
  for(const b of [demo,...books]){
    const p=safePosition(raw.state.positions?.[b.id],b);
    if(p)positions[b.id]=p;
    const mark=raw.state.bookmarks?.[b.id];
    if(Array.isArray(mark))bookmarks[b.id]=mark.slice(0,1000).map(x=>safePosition(x,b)).filter(Boolean);
  }
  return {books,positions,bookmarks,words:sanitizeSaved(raw.words),learning:raw.learning||null,prefs:sanitizePrefs(raw.state.prefs),lastBook:ids.has(raw.state.lastBook)?raw.state.lastBook:DEMO_ID};
}
