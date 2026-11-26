// Choosing a language is not a claim that a dictionary, OCR, or translation model exists.
export const languages=Object.freeze({en:'Английский',ru:'Русский',hi:'Хинди',es:'Испанский',kk:'Казахский',de:'Немецкий',fr:'Французский'});
const aliases={eng:'en',rus:'ru',hin:'hi',spa:'es',kaz:'kk',deu:'de',ger:'de',fra:'fr',fre:'fr',jpn:'ja',kor:'ko'};
export function knownLanguage(tag){
  const code=String(tag||'').trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,8}$/.test(code)&&!['und','zxx','mul'].includes(code)?(Object.hasOwn(aliases,code)?aliases[code]:code):'';
}
const scripts={en:'Latn',es:'Latn',de:'Latn',fr:'Latn',ru:'Cyrl',kk:'Cyrl',hi:'Deva'};
function textScript(text){
  const sample=String(text||'').slice(0,256);
  for(const [script,re] of [['Cyrl',/\p{Script=Cyrillic}/u],['Latn',/\p{Script=Latin}/u],['Deva',/\p{Script=Devanagari}/u],['other',/\p{L}/u]])
    if(re.test(sample))return script;
  return '';
}
export function resolveLanguage(tag,selected,text=''){
  const known=knownLanguage(tag);if(known)return known;
  if(/^(zxx|mul)(?:-|$)/i.test(tag||''))return 'und';
  const script=/^und[-_]([a-z]{4})(?:-|$)/i.exec(tag||'')?.[1]||textScript(text);
  if(/\p{Script=Cyrillic}/u.test(text)&&/[әғқңөұүһ]/iu.test(text)&&['en','ru','kk'].includes(selected))return 'kk';
  return Object.hasOwn(languages,selected)&&(!script||scripts[selected].toLowerCase()===script.toLowerCase())?selected:'und';
}
// An English definition may be displayed as a fallback, but it cannot suppress
// a matching Hindi/Spanish dictionary recommendation.
export const targetHit=(entries,source,target)=>(entries||[]).some(e=>e.target===target&&!!(e.translation?.trim()||source===target&&e.definition?.trim()));
export const pairCode=(source,target)=>source.toUpperCase()+' → '+target.toUpperCase();
export const pairPacks=(packs,source,target)=>packs.filter(p=>p.language===source&&p.target===target);
export const hasBuiltIn=(source,target)=>source==='en'&&['en','ru'].includes(target);
export function pairInfo(source,target,catalog,installed,pack,runtime){
  const matches=pairPacks(catalog,source,target),local=pairPacks(installed,source,target);
  const builtIn=hasBuiltIn(source,target);
  const dictionary=[builtIn?'Базовый словарь доступен сразу.':'',local.length?'Есть установленный словарь.':'',
    matches.some(p=>!local.some(l=>l.id===p.id))?'Можно скачать словарь.':'',
    !builtIn&&!local.length&&!matches.length?'Готового пакета нет. Можно импортировать свой словарь.':''].filter(Boolean).join(' ');
  const paragraphs=source===target?'Оригинал уже на выбранном языке.':!pack?'Локальной модели для этой пары нет.':
    !runtime?'Локальная модель есть, но этот браузер её не поддерживает.':'Можно скачать модель при чтении. Текст останется на устройстве.';
  return {dictionary,paragraphs};
}
export function fillLanguages(select,value,{unknown=false}={}){
  select.replaceChildren(...(unknown?[new Option('Не указан','')]:[]),...Object.entries(languages).map(([code,label])=>new Option(label,code)));
  select.value=value;
}


// Preserve the existing boundaries for spaced text, apostrophes and hyphens.
// Japanese needs word segmentation inside a continuous run of letters.
const readingWords=/[\p{L}][\p{L}\p{M}]*(?:['‘’ʼ‐‑\u00ad-][\p{L}][\p{L}\p{M}]*)*/gu;
const japaneseScript=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
let japaneseSegmenter;
export function* readingWordSegments(text,language){
  const japanese=knownLanguage(language)==='ja'&&typeof Intl.Segmenter==='function';
  for(const match of text.matchAll(readingWords)){
    const [word]=match,offset=match.index;
    // Bound the extra button work for unusually long continuous runs.
    if(japanese&&word.length<=4096&&japaneseScript.test(word)){
      japaneseSegmenter??=new Intl.Segmenter('ja',{granularity:'word'});
      for(const {segment,index,isWordLike} of japaneseSegmenter.segment(word)){
        if(isWordLike)yield {word:segment,offset:offset+index};
      }
    }else yield {word,offset};
  }
}
