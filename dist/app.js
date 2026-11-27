import {createAutoTranslationPreferences,createLocalTranslator,supportsTranslation,translationPack,translationRevision} from './local-translation.js';
import {clearTextBookTranslations,prepareParagraphCache,readParagraphCache,stampTextBook,writeParagraphCache} from './paragraph-translation-cache.js';
import {installLanguages} from './language-settings.js';
import {fillLanguages,importSourceLanguages,knownLanguage,languages,pairCode,readingWordSegments,resolveLanguage,targetHit} from './language-pairs.js';
import {isComic,comicBook,booksOnly,putComic,readComicPage,dropComic,comicOCRChapter,updateComicPage} from './comic-storage.js';
import {COMIC_OCR_OPTIONS,comicPageModel,comicModelTag} from './comic-languages.js';
import {demoChapters, dictionary} from './data.js';
import {parseBook, pairBooks, singleBook} from './importers.js';
import {createIllustrationLayer, createIllustrationViewer, dropIllustrations, putIllustrations, readIllustration} from './epub-illustrations.js';
import {DEMO_ID, ACCENTS, DEFAULT_PREFS, THEMES, BACKUP_LIMIT, contrast, accentPalette, sanitizeOcr, sanitizePrefs, sanitizeSaved, safePosition, searchKey, serializeBackup, parseBackup} from './release-core.js';
import {bootMobileViewport} from './mobile-viewport.js';
import {READING_FONTS, populateReadingFontPicker, readingFontStack} from './reading-fonts.js';
import {cancelMotion, revealMotion, outcomeCue} from './motion.js';
import {installNavMotion} from './shell-motion.js';
import {installCommandButton} from './command-button.js';
import {installTranslationStorage,modelDownloadLabel} from './translation-storage.js';
import {installStorageMeter} from './storage-meter.js';
import {bookFileError, installDropMotion} from './file-drop-motion.js';
import {createBookDeleteDialog} from './book-delete.js';
import {createWordDeleteDialog} from './hold-button.js';
import {makeWordFlight} from './word-flight.js';
import {installSheet} from './sheet.js';
import {installReadingHome} from './reading-home.js';
import {installReadingActivity} from './reading-activity.js';
import {installVoiceControls} from './voice-controls.js';
import {createBookSpeech} from './book-speech.js';
import {createWordSpeech,speechLanguage,wordSpeechMessage} from './word-speech.js';
import {BYOK_PROVIDERS,createByokSession} from './byok-core.js';
import {installByokSettings} from './byok-settings.js';
import {mountAiWordHint,requestAiWordHint} from './byok-word.js';
import {createStarterSource,isStarterId,starterPublicationYear,starterSourceURL} from './starter-core.js';
import {installStarterShelf} from './starter-shelf.js';
import {createResearchSource,isResearchId} from './research-core.js';
import {loadNewsFeed,loadNewsBook,isNewsId,readSavedNewsFeed} from './news-core.js';
import {makeEditorialCover,makeEditorialCredit} from './editorial-cover.js';
import {installResearchCatalog} from './research-ui.js';
import {normalizeWord,loadLearning,packLearning,mergeLearning,trackWord,getWord,removeWord,detachWord,noteLookup,recordEncounter,markKnown,resumeLearning,review,stage,encounterCount,passageCount,due,stats as learningStats,bookStats} from './learning-core.js';
import {MIN_PAIRS,MAX_PAIRS,MAX_CANDIDATES,makePracticeCard,distinctCards,createMatchRound,matchChoice} from './practice-core.js';
import {buildPracticeLesson,PRACTICE_LIMITS} from './practice-engine.js';
import {practicePlayer} from './practice-player.js';
import {rankPracticeWords,rememberStudyWords,recallQueue} from './practice-planning.js';
import {dictionaryControls,renderSenses,formatBytes} from './dictionary-ui.js';
import {lingotIcons} from './lingot-icons.js';
import {tactileFeedback,createPracticeAudio,nativeLessonSwitch,supportsIphoneSwitch,tactileMode} from './feedback.js';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const readingHome=installReadingHome({goHome:e=>navigateHome('home',e)});
const readingActivity=installReadingActivity($('#reading-activity'),readingHome.getReadingHistory);
const wordFlight=makeWordFlight($('#word-dialog'),$('#word-save'));
const byokSession=createByokSession();
const byokSettings=installByokSettings($('#byok-settings'),byokSession,{providers:BYOK_PROVIDERS,summary:$('#profile-byok-summary')});
let aiWordHint=null;
const glyphs={
  research:'M4 3h11l5 5v13H4z M14 3v6h6M8 16l3-3 2 2 3-4',
  comicBook:'M3 4h18v16H3z M13 4v16M3 12h10m0 3h8',
  comicStrip:'M6 3h12v7H6z M6 14h12v7H6z M9 6h6M9 17h6',
  haptic:'M9 5h6v14H9z M6 8c-1.5 2-1.5 6 0 8m12-8c1.5 2 1.5 6 0 8M3 6c-2.5 3-2.5 9 0 12m18-12c2.5 3 2.5 9 0 12',
  theme:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 3v18m1-15 2 1m-2 2 4 2m-4 1 4 2m-4 1 2 1',
  type:'M3 18 8 5l5 13M5 14h6m4-4h6m-3 0v8',
  home:'m3 10 9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  myDictionary:'M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2zm0 14a2 2 0 0 1 2-2h13M22 7h-3m3 5h-3M8 12l2.4-5 2.4 5M8.9 10h3m3-.5h1.3',
  library:'M4 4h4v15H4z M11 4h4v15h-4z M17 6l3-1 4 14-3 1z',
  pairConnect:'M3.75 6.75h3.5a1.75 1.75 0 0 1 0 3.5h-3.5a1.75 1.75 0 0 1 0-3.5zm13 7h3.5a1.75 1.75 0 0 1 0 3.5h-3.5a1.75 1.75 0 0 1 0-3.5z M9 8.5h1.2c3 0 1 7 4.6 7H15 M16.5 7h3m-1.5-1.5v3 M4.5 17h3m-1.5-1.5v3',
  flashcards:'M5 7.75h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z M7 4.75h12a2 2 0 0 1 2 2v9 M7 12h7m-7 4h4',
  studySeries:'M4 5.25h12a2 2 0 0 1 2 2V10m0 8v.75a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6m0 0c0-1.1.9-2 2-2h10 M8.5 9h4m-4 4h2m-2 4h3 M17.5 11l1.1 2.4L21 14.5l-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z',
  repeat:'m17 2 4 4-4 4 M3 11V9a3 3 0 0 1 3-3h15 M7 22l-4-4 4-4 M21 13v2a3 3 0 0 1-3 3H3',
  bookmark:'M6.5 4.5h11v15l-5.5-3.6-5.5 3.6z',
  sliders:'M5 7h14M5 17h14M9 4v6m6 4v6',
  back:'m14 5-7 7 7 7',
  close:'m6 6 12 12M18 6 6 18',
  file:'M6 3h8l4 4v14H6z M14 3v5h4M9 12h6m-6 4h6',
  languages:'M3 6h12M9 3v3M5 9c1 4 4 7 8 9M12 6c0 5-3 9-9 12m13 3 3-8 3 8m-5-2h4',
  book:'M3 4h4c3 0 5 1.5 5 4 0-2.5 2-4 5-4h4v14h-4c-3 0-5 1-5 3 0-2-2-3-5-3H3z M12 8v13',
  lock:'M6 11h12v9H6z M8 11V8a4 4 0 1 1 8 0v3',
  headphones:'M3 14v-2a9 9 0 0 1 18 0v2 M6 12H5a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2v-7z M18 12h1a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2v-7z',
  listenPause:'M7.5 5.5h2v13h-2zM14.5 5.5h2v13h-2z',
  speaker:'M4 9h4l4-4v14l-4-4H4z M16 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11',
  upload:'M12 19V5m-6 6 6-6 6 6',
  selectWords:'M3.5 7.5l1.8 1.8L9 5.5M3.5 15.5l1.8 1.8 3.7-3.8M12 8h8.5M12 16h8.5',
  list:'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  search:'M15.8 10a5.8 5.8 0 1 1-11.6 0 5.8 5.8 0 0 1 11.6 0zm-1.6 4.2L20 20',
  trash:'M4 6h16M9 6V3h6v3M6 6l1 14h10l1-14M10 10v6m4-6v6',
  lookup:'M11 5a4 4 0 0 0-3-1H3v14h5a4 4 0 0 1 3 1V5zm0 0a4 4 0 0 1 3-1h5v3m-3.6 11.1-1.4.5a4 4 0 0 0-3 1m10-7.1a3.6 3.6 0 1 1-7.2 0 3.6 3.6 0 0 1 7.2 0zm-1.1 2.6L22 18',
  download:'M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4',
  aiSpark:'M9 2c.7 5 2 6.3 7 7-5 .7-6.3 2-7 7-.7-5-2-6.3-7-7 5-.7 6.3-2 7-7zm9 12c.4 2.9 1.1 3.6 4 4-2.9.4-3.6 1.1-4 4-.4-2.9-1.1-3.6-4-4 2.9-.4 3.6-1.1 4-4z',
};
const iconAlias={vault:'book-open',openBook:'book-open',practice:'dumbbell',person:'user'};
function iconMarkup(name){return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${lingotIcons[iconAlias[name]||name]||`<path d="${glyphs[name]||glyphs.book}"/>`}</svg>`;}
function paintIcons(scope=document){scope.querySelectorAll('[data-icon]').forEach(el=>{el.classList.add('icon-glyph');el.innerHTML=iconMarkup(el.dataset.icon)})}
let renderEpoch=0;
let homeView='home',readerReturn='home',readerTrigger='',homeLeaving=false,lastPointerInput=false;
let readerBackPending=false;
const routeScroll={home:0,library:0};
const returnRoute=()=>history.state?.folioReaderReturn==='library'?'library':'home';
let touchRibbon=null,programmaticRibbonLeft=0;
function setChromeColor(){const property=document.body.classList.contains('reading')?'--surface':'--bg';$('meta[name="theme-color"]').content=getComputedStyle(document.body).getPropertyValue(property).trim()||accentPalette(state.prefs).themeColor}
function markPointerInput(){
  lastPointerInput=true;
  document.documentElement.removeAttribute('data-keyboard-ui');
  document.documentElement.setAttribute('data-pointer-ui','');
}
document.addEventListener('pointerdown',markPointerInput,{capture:true,passive:true});
// Some touch browsers synthesize a click without delivering the originating pointerdown.
document.addEventListener('click',e=>{if(e.isTrusted&&e.detail>0)markPointerInput()},{capture:true,passive:true});
document.addEventListener('keydown',e=>{
  if(!e.isTrusted||e.metaKey||e.altKey||e.ctrlKey||['Shift','Control','Alt','Meta'].includes(e.key))return;
  lastPointerInput=false;
  document.documentElement.removeAttribute('data-pointer-ui');
  document.documentElement.setAttribute('data-keyboard-ui','');
},{capture:true});
const demo={id:DEMO_ID,title:'The Night Ferry',author:'Folio',language:'en',translationLanguage:'ru',format:'DEMO',alignment:'demo',chapters:demoChapters.map(c=>({title:c.title,paragraphs:c.text.map((text,i)=>({text,translation:c.ru[i]}))}))};
function storedValue(key){try{return localStorage.getItem(key)}catch{return null}}
function readJSON(key,fallback){try{return JSON.parse(storedValue(key))??fallback}catch{return fallback}}
const firstLanguageVisit=['folio-v2','folio-words','folio-learning-v1','folio-page','folio-bookmark'].every(key=>storedValue(key)===null);
const prior=readJSON('folio-v2',{}), record=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
let state={positions:{...record(prior.positions)},bookmarks:{...record(prior.bookmarks)},lastBook:typeof prior.lastBook==='string'?prior.lastBook:DEMO_ID,prefs:sanitizePrefs(prior.prefs)};
if(!safePosition(state.positions[DEMO_ID],demo))state.positions[DEMO_ID]={chapter:Math.max(0,Math.min(2,Number(storedValue('folio-page'))||0)),paragraph:0,fraction:0,chapterTop:true};
const legacySaved=sanitizeSaved(readJSON('folio-words',[]));
const LEARNING_KEY='folio-learning-v1';
const SYNC_WORDS='folio-word-store-v2';
let legacyCursor=storedValue(LEARNING_KEY),legacyListCursor=storedValue('folio-words'),wordDisk=null,wordDiskFault=false;
const diskOptions=()=>({storage:localStorage,locks:navigator.locks,legacyCursor:()=>legacyCursor,legacyListCursor:()=>legacyListCursor,liveWords:()=>learning,onApplied(next){
  clearTimeout(learningTimer);learningDirty=false;
  if(learning!==next){learning=next;try{reviewSequence++;resetWordView();reviewQueue=[];manualWords.clear();recentSeriesWords=[];deactivatePractice();renderHomePanel();wordSavedState();refreshSelectedStage()}catch{wordStoreNotice('Словарь сохранён. Перезагрузите страницу, чтобы обновить экран.')}}
}});
function wordStoreNotice(message){const el=$('#sync-word-notice');el.hidden=!message;el.textContent=message}
const otherTab='Словарь открыт в другой вкладке. Здесь изменения слов не сохраняются. Закройте другую вкладку и перезагрузите эту страницу.';
if(storedValue(SYNC_WORDS)!==null){
  try{wordDisk=(await import('./sync-local.js')).createWordStore(diskOptions());if(!await wordDisk.own())wordStoreNotice(otherTab)}
  catch{wordDiskFault=true;wordStoreNotice('Не удалось открыть сохранённый словарь. Перезагрузите Folio. Исходная копия не удалена; сохранение слов остановлено.')}
}
const learningSnapshot=wordDisk?.packed??readJSON(LEARNING_KEY,null);
const malformedLearningAtBoot=legacyCursor!==null
  ?!learningSnapshot||learningSnapshot.version!==1||!Array.isArray(learningSnapshot.rows)
  :legacyListCursor!==null&&(()=>{try{const list=JSON.parse(legacyListCursor);return !Array.isArray(list)||list.length!==legacySaved.length||list.some(w=>typeof w!=='string'||!w.trim()||w.length>128)}catch{return true}})();
let learning=loadLearning(learningSnapshot,learningSnapshot?.version===1&&Array.isArray(learningSnapshot.rows)?[]:legacySaved,wordDisk?.enrolled?8640000000000000:Date.now()),learningDirty=!learningSnapshot,learningTimer=0,seenTimer=0;
const stageText={new:'Новое',learning:'Учу',almost:'Почти',known:'Знаю'};
const stageIcon={new:'zap',learning:'openBook',almost:'flame',known:'check'};
let wordFilter='all',wordLimit=48,selectingWords=false,wordDeleteDialog=null;
const selectedWordKeys=new Set();
let reviewQueue=[],reviewIndex=0,reviewed=0,reviewRecalled=0,reviewSequence=0,reviewCanGrade=false,reviewOpener=null;
function legacyWords(){return [...new Set(Object.values(learning.words).map(r=>r.word))]}
function assertWordWriter(){
  if(wordDiskFault||malformedLearningAtBoot&&!wordDisk?.enrolled)throw Error('local-invalid');
  if(wordDisk?.enrolled){wordDisk.assertEditor();return}
  if(localStorage.getItem(SYNC_WORDS)!==null||localStorage.getItem(LEARNING_KEY)!==legacyCursor||legacyCursor===null&&localStorage.getItem('folio-words')!==legacyListCursor){
    wordStoreNotice('Словарь изменился в другой вкладке. Здесь новые изменения слов не сохраняются. При необходимости скачайте резервную копию и перезагрузите страницу.');
    throw Error('local-changed');
  }
}
// No lock acquisition here: nonholders remain read-only. Validate before each
// ordinary mutation, including delayed/passive actions. Only an explicit transfer enrolls.
function canWriteWords(notify=false){
  try{assertWordWriter();return true}catch{
    if(notify){wordStoreNotice('Словарь не изменён. Закройте другие вкладки Folio и перезагрузите страницу.');toast('Здесь словарь доступен только для чтения.')}
    return false;
  }
}
function persistWordRows(packed){
  assertWordWriter();if(wordDisk?.enrolled){wordDisk.saveWords(packed);return}
  const raw=JSON.stringify(packed);localStorage.setItem(LEARNING_KEY,raw);legacyCursor=raw;
}
function wordSaved(){clearTimeout(learningTimer);learningDirty=false;try{mirrorLegacy()}catch{}}
function failedWordSave(){toast('Словарь не изменён. Проверьте свободное место и открытые вкладки.')}
function changeScore(record,edit){
  if(record!==learning.words[record.key]||!canWriteWords(true))return false;
  const {wins,manual,lapsed,lastActionAt,nextReviewAt}=record;
  if(!edit())return false;
  try{persistWordRows(packLearning(learning));wordSaved();return true}
  catch{Object.assign(record,{wins,manual,lapsed,lastActionAt,nextReviewAt});failedWordSave();return false}
}
function mirrorLegacy(){if(!wordDisk?.enrolled){const list=JSON.stringify(legacyWords());localStorage.setItem('folio-words',list);legacyListCursor=list}}
function saveLearning(){
  clearTimeout(learningTimer);
  if(!learningDirty)return;
  persistWordRows(packLearning(learning));
  mirrorLegacy();
  learningDirty=false;
}
function trackChanged(){learningDirty=true;clearTimeout(learningTimer);learningTimer=setTimeout(saveState,260)}
function ruCount(n,forms){const a=n%100,b=n%10;return n+' '+forms[a>=11&&a<=14?2:b===1?0:b>=2&&b<=4?1:2]}
const encounterText=n=>ruCount(n,['встреча','встречи','встреч']);
const wordCountText=n=>ruCount(n,['слово','слова','слов']);
function stageBadge(record){const value=stage(record),badge=node('span',null,'word-stage-badge'),icon=node('i',null,'icon-glyph');icon.innerHTML=iconMarkup(stageIcon[value]);badge.append(icon,node('span',stageText[value]||stageText.new));badge.dataset.stage=value;return badge}
function recordInfo(record){return [record.language.toUpperCase(),encounterText(encounterCount(record))].join(' · ')}
function attachStage(el,record){if(record&&stage(record)!=='known')el.dataset.learning=stage(record);else delete el.dataset.learning}
function refreshSelectedStage(){if(wordAnchor?.button?.isConnected)attachStage(wordAnchor.button,getWord(learning,wordAnchor.token,wordAnchor.trackLanguage))}

const legacyBookmark=Number(storedValue('folio-bookmark'));if(storedValue('folio-bookmark')!==null&&!state.bookmarks[DEMO_ID]&&Number.isInteger(legacyBookmark)&&legacyBookmark>=0&&legacyBookmark<3)state.bookmarks[DEMO_ID]=[{chapter:legacyBookmark,paragraph:0,fraction:0}];
let storageWarning='',backupDraft=null,backupSequence=0,restoring=false;
let lexicon=null,lexiconPending=null,lexiconFailures=0,lexiconRetryAt=0,selectedWordSequence=0,importingDictionary=false;
let paragraphObserver=null,illustrationLayer=null,illustrationViewer=null,illustratedRows=null,importSequence=0;
function clearIllustrations(){illustrationViewer?.leave();illustrationLayer?.destroy();illustrationLayer=null;illustratedRows=null}
let books=[demo],current=null,chapter=0,paragraph=0,selectedWord='',wordAnchor=null,previewBook=null,db=null,toastTimer,saveTimer,suppressScroll=false,ribbonManual=false,drag=null;
const starterSource=createStarterSource();
let starterIntent=0;
const starterShelf=installStarterShelf($('#starter-shelf'),{
  loadCatalog:starterSource.loadCatalog,
  openBook:(book,event)=>openStarterBook(book.id,{motion:!!event?.detail,focus:event?.detail===0,trigger:'starter:'+book.id}),
  getProgress:book=>{const cached=books.find(b=>b.id===book.id);return cached?progress(cached):null},
});
async function openStarterBook(id,options={}){
  editorialIntent++;
  const intent=++starterIntent,url=location.hash;
  let book=books.find(b=>b.id===id);
  if(!book){
    book=stampTextBook(await starterSource.loadBook(id));
    if(intent!==starterIntent||location.hash!==url)return;
    try{await dbAction('readwrite',store=>{clearTextBookTranslations(store,[book.id]);return store.put(book)});}
    catch{toast('Книга открылась, но браузер не смог сохранить её на устройстве.');}
    if(!books.some(b=>b.id===id))books.push(book);
  }
  if(intent===starterIntent&&location.hash===url)openBook(id,undefined,options);
}
function renderStarterEdition(book){
  const info=$('#starter-edition'),ed=book.edition;info.replaceChildren();
  if(editorialKind(book.id)){
    info.hidden=!ed?.sourceUrl;if(info.hidden)return;
    const permitted=(raw,hosts)=>{try{const u=new URL(raw);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&hosts.includes(u.hostname)?u.href:''}catch{return ''}};
    const add=(label,url)=>{if(!url)return;const a=node('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';info.append(a)};
    info.append(node('p',ed.attribution||book.author||''));
    if(ed.changes)info.append(node('p',ed.changes));
    add('Оригинал · '+(ed.source||'источник'),permitted(ed.sourceUrl,['en.wikipedia.org','elifesciences.org','joss.theoj.org']));
    add(ed.license||'Лицензия',permitted(ed.licenseUrl,['creativecommons.org']));
    info.hidden=!info.querySelector('a');return;
  }
  const url=starterSourceURL(ed?.sourceUrl);info.hidden=!isStarterId(book.id)||!url;
  if(info.hidden)return;
  const year=starterPublicationYear(ed.publicationYear);
  if(year)info.append(node('p','Год издания: '+year));
  if(ed.translator)info.append(node('p','Перевод: '+ed.translator));
  const link=node('a','Издание: '+(ed.source||'источник'));link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';
  info.append(link);
}

function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',4000)}
function updateStorageStatus(){const status=$('#local-storage-status');if(status)status.textContent=storageWarning||(!db?'Хранилище книг недоступно. Восстановление книг отключено.':'')}
let rememberedReadingPositions={...state.positions},rememberedBookmarks={...record(prior.bookmarks)};
function sameReadingPosition(a,b){
  return a===b||!!a&&!!b&&['chapter','paragraph','fraction','viewportDelta','chapterTop','textEnd','comicImageOffset','comicLayout','comicStripArtworkOffset','soloScrollProgress'].every(k=>a[k]===b[k]);
}
function readingPositionsToSave(stored,previous,local){
  // A stale tab only owns reading positions it actually changed. Do not
  // resurrect a deletion or overwrite the checkpoint of another book.
  const merged=Object.assign(Object.create(null),stored);
  for(const id of new Set([...Object.keys(previous),...Object.keys(local)])){
    if(!Object.hasOwn(local,id)){if(Object.hasOwn(previous,id))delete merged[id];}
    else if(!Object.hasOwn(previous,id)||!sameReadingPosition(previous[id],local[id]))merged[id]=local[id];
  }
  return merged;
}
const bookmarkLocation=mark=>mark&&Number.isSafeInteger(mark.chapter)&&mark.chapter>=0&&Number.isSafeInteger(mark.paragraph)&&mark.paragraph>=0
  ?mark.chapter+'/'+mark.paragraph:'';
const bookmarkList=marks=>Array.isArray(marks)?marks.filter(bookmarkLocation):[];
function bookmarksToSave(stored,previous,local,deletedBook){
  const merged=Object.create(null);
  for(const [id,marks] of Object.entries(stored))if(Array.isArray(marks))merged[id]=bookmarkList(marks);
  // Apply only this tab's additions/removals, by chapter and paragraph. A
  // checkpoint must never overwrite an unrelated explicitly saved bookmark.
  for(const id of new Set([...Object.keys(previous),...Object.keys(local)])){
    if(previous[id]===local[id])continue;
    const index=marks=>new Map(bookmarkList(marks).map(mark=>[bookmarkLocation(mark),mark]));
    const old=index(previous[id]),next=index(local[id]),latest=index(merged[id]);
    for(const key of old.keys())if(!next.has(key))latest.delete(key);
    for(const [key,mark] of next)if(!sameReadingPosition(old.get(key),mark))latest.set(key,mark);
    if(latest.size)merged[id]=[...latest.values()];else delete merged[id];
  }
  if(deletedBook)delete merged[deletedBook];
  return merged;
}
function storedReadingState(){
  const raw=localStorage.getItem('folio-v2');
  if(raw==null)return null;
  try{return record(JSON.parse(raw))}catch{return null}
}
function saveState({deletedBook}={}){try{
  const latest=storedReadingState(),savedPositions=latest?.positions;
  const positions=savedPositions&&typeof savedPositions==='object'&&!Array.isArray(savedPositions)
    ?readingPositionsToSave(savedPositions,rememberedReadingPositions,state.positions):state.positions;
  const bookmarks=latest?bookmarksToSave(record(latest.bookmarks),rememberedBookmarks,state.bookmarks,deletedBook):state.bookmarks;
  localStorage.setItem('folio-v2',JSON.stringify({...state,positions,bookmarks}));
  rememberedReadingPositions={...state.positions};
  state.bookmarks=bookmarks;rememberedBookmarks={...bookmarks};
  saveLearning();storageWarning='';updateStorageStatus();return true}catch{if(!storageWarning)toast('Изменения работают в этой вкладке, но не сохраняются в браузере.');storageWarning='Хранилище настроек недоступно. Изменения будут потеряны после перезагрузки; их можно скачать в копию.';updateStorageStatus();return false}}
function escapeHTML(t){return String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(className)e.className=className;return e};
function openDB(){return new Promise((resolve,reject)=>{const request=indexedDB.open('folio-library');request.onupgradeneeded=()=>request.result.createObjectStore('books',{keyPath:'id'});request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)};request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Хранилище занято другой вкладкой.'))})}
function dbAction(mode,action){return new Promise((resolve,reject)=>{if(!db)return reject(new Error('Хранилище книг недоступно в этом браузере.'));const tx=db.transaction('books',mode);let result;const request=action(tx.objectStore('books'));request.onsuccess=()=>result=request.result;tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}

const researchSource=createResearchSource();
function paintNewsFreshness(feed){
  $('#news-freshness').textContent=feed.stale?(feed.items.length?'Сводка Wikipedia · сохранённая версия':'Не удалось обновить сводку Wikipedia'):'Сводка Wikipedia';
  return feed.items;
}
const editorial=Object.freeze({research:{...researchSource,
  loadStoredCatalog:()=>books.filter(b=>b.kind==='research'&&isResearchId(b.id)).map(b=>({
    id:b.id,title:b.title,journal:b.edition?.source||b.author,topic:'На устройстве',year:b.edition?.publicationYear,
  })),
},news:{
  loadStoredCatalog:()=>{const feed=readSavedNewsFeed();return feed.items.length?paintNewsFreshness(feed):[]},
  loadCatalog:async options=>paintNewsFreshness(await loadNewsFeed(options)),
  loadBook:loadNewsBook,
}});
let catalogKind='books',editorialIntent=0;
const catalogMotion=installNavMotion($('.catalog-switch'),{indicator:'.catalog-current',keyAttribute:'catalog'});
const editorialKind=id=>isResearchId(id)?'research':isNewsId(id)?'news':null;
const catalogPanels={books:$('#starter-shelf'),research:$('#research-catalog'),news:$('#news-catalog')};
const newsFreshness=node('p','','muted');newsFreshness.id='news-freshness';newsFreshness.setAttribute('role','status');catalogPanels.news.querySelector('.section-title').after(newsFreshness);
const newsRefresh=node('button',null,'icon-button');newsRefresh.type='button';
newsRefresh.setAttribute('aria-label','Обновить новости');newsRefresh.title='Обновить новости';newsRefresh.innerHTML='<i class="icon-glyph">'+iconMarkup('repeat')+'</i>';
catalogPanels.news.querySelector('.section-title').append(newsRefresh);
const editorialUI={};
newsRefresh.onclick=async()=>{newsRefresh.disabled=true;try{await editorialUI.news.refresh({force:true})}finally{newsRefresh.disabled=false}};
for(const kind of ['research','news']) editorialUI[kind]=installResearchCatalog(catalogPanels[kind],{
  loadCatalog:editorial[kind].loadCatalog,loadStoredCatalog:editorial[kind].loadStoredCatalog,
  openBook:(entry,e)=>openEditorialBook(entry.id,{motion:e.detail>0,focus:e.detail===0,trigger:'editorial:'+entry.id}),
  progress:id=>{const book=books.find(b=>b.id===id);return book?progress(book):null},
  makeIcon:key=>{const el=node('i',null,'icon-glyph');el.innerHTML=iconMarkup(key);return el},
});
function refreshCatalog(){
  catalogMotion.select(catalogKind);
  if(catalogKind==='books')void starterShelf.refresh();else void editorialUI[catalogKind].refresh({live:catalogKind==='news'});
}
function setCatalogKind(kind,{motion=false}={}){
  if(!Object.hasOwn(catalogPanels,kind))return;
  if(kind!==catalogKind){editorialIntent++;starterIntent++}
  catalogKind=kind;
  for(const b of $$('[data-catalog]'))b.setAttribute('aria-pressed',String(b.dataset.catalog===kind));
  for(const key of Object.keys(catalogPanels))catalogPanels[key].hidden=key!==kind;
  if(homeView==='library'){catalogMotion.select(kind,{animate:motion});refreshCatalog()}
}
async function openEditorialBook(id,options={}){
  starterIntent++;
  const kind=editorialKind(id);if(!kind)return;
  const intent=++editorialIntent,url=location.hash;
  let book=books.find(b=>b.id===id);
  if(!book){
    book=stampTextBook(await editorial[kind].loadBook(id));
    if(intent!==editorialIntent||location.hash!==url)return;
    try{await dbAction('readwrite',store=>{clearTextBookTranslations(store,[book.id]);return store.put(book)})}
    catch{toast('Текст открылся, но не сохранился на устройстве.')}
    if(!books.some(b=>b.id===id))books.push(book);
  }
  if(intent===editorialIntent&&location.hash===url)openBook(id,undefined,options);
}

function totalParagraphs(book){return book.chapters.reduce((n,c)=>n+c.paragraphs.length,0)}
function progress(book){
  const p=safePosition(state.positions[book.id],book)||{chapter:0,paragraph:0};
  if(isComic(book))return Math.round((p.chapter+1)/book.comicPages.length*100);
  if(book.chapters.length===1&&book.chapters[0].paragraphs.length===1)
    return Math.round((p.soloScrollProgress??p.fraction??0)*100);
  if(p.textEnd)return 100;
  const before=book.chapters.slice(0,p.chapter).reduce((n,c)=>n+c.paragraphs.length,0);
  return Math.min(99,Math.round((before+p.paragraph+(p.fraction||0))/Math.max(1,totalParagraphs(book))*100));
}
function alignmentLabel(book){if(isComic(book))return book.comicPages.length+' стр.';return book.alignment==='demo'?'Демо · EN / RU':book.alignment==='none'?'Без перевода':'Пара файлов · сверить соответствие'}
let bookDeleteDialog=null;
async function deleteBook(book){
  if(book.id===DEMO_ID||!books.some(b=>b.id===book.id))throw new Error('Book unavailable');
  if(isComic(book))await dropComic(db,book.id,book.comicPages.length);else await dbAction('readwrite',store=>{clearTextBookTranslations(store,[book.id]);if(book.chapters.some(c=>c.illustrations?.length))dropIllustrations(store,book.id);return store.delete(book.id)});
  books=books.filter(b=>b.id!==book.id);
  delete state.positions[book.id];delete state.bookmarks[book.id];localAuto.forget(book.id);
  if(state.lastBook===book.id)state.lastBook=DEMO_ID;
  saveState({deletedBook:book.id});renderPersonalShelf();
}
function renderPersonalShelf(){
  const last=books.find(b=>b.id===state.lastBook)||demo,pos=state.positions[last.id]||{chapter:0},pct=progress(last);
  $('#shelf-count').textContent=books.filter(b=>!editorialKind(b.id)).length;
  const c=node('button',null,'continue-card');
  c.innerHTML=`<div class="continue-copy"><p class="eyebrow">ПРОДОЛЖИТЬ ЧТЕНИЕ</p><h2>${escapeHTML(last.title)}</h2><p>${escapeHTML(last.chapters[pos.chapter]?.title||last.chapters[0].title)}</p><div class="continue-progress"><progress value="${pct}" max="100" aria-hidden="true"></progress><span>${pct}%</span></div><span class="continue-sign">Открыть книгу</span></div><span class="continue-cover" aria-hidden="true"><i class="icon-glyph">${iconMarkup('book')}</i></span>`;
  c.onclick=e=>openBook(last.id,undefined,{motion:e.detail>0,focus:e.detail===0,trigger:'continue'});
  $('#continue-card').replaceChildren(c);
  const shelf=$('#books');shelf.replaceChildren();
  const editorialShelves={research:$('#research-home-books'),news:$('#news-home-books')};
  for(const container of Object.values(editorialShelves))container.replaceChildren();
  for(const b of books){
    const kind=editorialKind(b.id);
    const card=node('div',null,kind?'book-card editorial-book':'book-card'),open=node('button',null,'book-open');
    open.dataset.book=b.id;
    let credit;
    if(kind){
      const cover=makeEditorialCover(b);if(cover)open.append(cover);credit=makeEditorialCredit(b,cover);
      open.append(node('h3',b.title),node('p',b.edition?.source||b.author));
    }else open.innerHTML=`<div class="book-cover"><span>${escapeHTML(b.title)}</span><small>${b.format==='DEMO'?'ДЕМО':escapeHTML(b.format)} · ${escapeHTML(b.language||'текст')}</small></div><h3>${escapeHTML(b.title)}</h3><p>${escapeHTML(b.author||'Ваша библиотека')}</p>`;
    open.onclick=e=>openBook(b.id,undefined,{motion:e.detail>0,focus:e.detail===0,trigger:b.id});
    const foot=node('div',null,'book-card-footer');foot.append(node('span',kind?(progress(b)?progress(b)+'%':'EN'):alignmentLabel(b)));
    if(b.id!==DEMO_ID){
      const remove=node('button','Удалить');
      remove.setAttribute('aria-label',`Удалить книгу ${b.title}`);
      remove.onclick=e=>{
        if(!e.isTrusted)return;
        const list=editorialShelves[kind]||shelf,index=[...list.children].indexOf(card);
        (bookDeleteDialog??=createBookDeleteDialog()).open({
          bookTitle:b.title,trigger:remove,remove:()=>deleteBook(b),
          focusFallback:()=>{
            // After rebuilding the shelf, the next book occupies this slot;
            // if it was the last, keep the reader at the previous card.
            const remaining=list.querySelectorAll('.book-open');
            return remaining[index]||remaining[index-1]||(kind?$('#'+kind+'-home-empty'):null);
          },
        });
      };
      foot.append(remove)
    }
    card.append(open);if(credit)card.append(credit);card.append(foot);(editorialShelves[kind]||shelf).append(card)
  }
  for(const [kind,container] of Object.entries(editorialShelves))$('#'+kind+'-home-empty').hidden=container.childElementCount>0;
  readingHome.render();
}
function baseEntry(word){return Object.hasOwn(dictionary,word)?dictionary[word]:null}
function baseForStudy(record){return sourceLanguage(record.word,record.language)==='en'?baseEntry(record.word):null}
function fallbackGloss(word,language,target){
  if(language!=='en'||target!=='ru')return null;
  const b=baseEntry(word);return b?{headword:word,entries:[{translation:b[0],definition:b[2],source:'Базовый словарь Folio',target:'ru'}]}:null;
}
async function lookupStudy(record,{packId=state.prefs.dictionaryPack,target=state.prefs.dictionaryTarget}={}){
  const language=sourceLanguage(record.word,record.language);
  const mod=await loadLexicon();
  try{return (mod&&await mod.lookupWord(record.word,{language,target,preferredPackId:packId}))||fallbackGloss(record.word,language,target)}
  catch(e){const base=fallbackGloss(record.word,language,target);if(base)return base;throw e}
}
function firstGloss(result){const hit=result?.entries?.find(e=>e.translation?.trim()||e.definition?.trim());return hit?.translation?.trim()||hit?.definition?.trim()||''}
const practiceAudio=createPracticeAudio(()=>state.prefs.practiceSound);
const allowNativeCheck=()=>nativeLessonSwitch(state.prefs.haptics && state.prefs.iphoneCheckHaptic);
function actionFeedback(event, kind='study'){
  const tactile=tactileFeedback(event,kind,state.prefs.haptics);
  practiceAudio.play(event,kind);return tactile;
}
function studyStatus(record,event){
  const keyboard=event?.detail===0;
  const s=stage(record),changed=changeScore(record,()=>s==='known'?resumeLearning(record,Date.now()):markKnown(record,Date.now()));
  if(!changed)return;actionFeedback(event);renderHomePanel();wordSavedState();refreshSelectedStage();
  const destination=stage(record),updated=$$('#saved-list [data-study-word]').find(row=>row.dataset.studyWord===record.key);
  const status=$('#word-stage-feedback');
  status.textContent='«'+record.word+'» теперь в разделе «'+stageText[destination]+'».';
  const filter=$('[data-stage-filter="'+destination+'"]');
  for(const el of $$('[data-stage-filter][data-outcome-cue]'))if(el!==filter)delete el.dataset.outcomeCue;
  outcomeCue(filter,'stage');
  outcomeCue(updated?.querySelector('.word-stage-badge'),'stage');
  if(keyboard){
    (updated?.querySelector('.word-card-know')||$('[data-stage-filter][aria-pressed=true]'))?.focus({preventScroll:true});
  }
}
function removeStudy(record,event){
  if(!canWriteWords(true))return;
  if(!confirm(`Убрать «${record.word}»? Встречи и повторы этого слова будут удалены.`))return;
  const keyboard=event?.detail===0,index=$$('#saved-list .saved-row').findIndex(row=>row.dataset.studyWord===record.key);
  try{persistWordRows(packLearning(learning,{excludeKeys:new Set([record.key])}))}catch{failedWordSave();return}
  if(removeWord(learning,record.word,record.language)){
    wordSaved();renderHomePanel();wordSavedState();refreshSelectedStage();
    if(keyboard){
      const buttons=$$('#saved-list .word-card-remove');
      (buttons[Math.min(index,buttons.length-1)]||$('#words-title')).focus({preventScroll:true});
    }
  }
}
function paintWordSelection(total=Object.keys(learning.words).length){
  for(const key of selectedWordKeys)if(!Object.hasOwn(learning.words,key))selectedWordKeys.delete(key);
  if(!total)exitWordSelection();
  const tray=$('#word-selection-tools'),toggle=$('#word-selection-toggle'),wasHidden=tray.hidden;
  toggle.disabled=!total;
  toggle.setAttribute('aria-pressed',String(selectingWords));
  toggle.title=selectingWords?'Завершить выбор':'Выбрать слова';
  $('#words-view').toggleAttribute('data-selecting',selectingWords);
  tray.hidden=!selectingWords;
  const count=selectedWordKeys.size,now=Date.now();
  const label='Выбрано: '+count;
  if($('#word-selection-count').textContent!==label)$('#word-selection-count').textContent=label;
  $('#word-selection-remove').disabled=$('#words-to-practice').disabled=!count;
  renderRecallButton($('#review-start'),[...selectedWordKeys].filter(key=>due(learning.words[key],now)).length);
  if(selectingWords&&wasHidden)revealMotion(tray,'panel');
}
function exitWordSelection(){
  selectingWords=false;selectedWordKeys.clear();
  $('#word-selection-tools').hidden=true;
  $('#word-selection-toggle').setAttribute('aria-pressed','false');
  $('#words-view').removeAttribute('data-selecting');
}
function setWordSearch(open,{focus=false,render=true}={}){
  const panel=$('#word-search-panel'),toggle=$('#word-search-toggle'),input=$('#word-search');
  if(!open&&focus)toggle.focus({preventScroll:true});
  panel.toggleAttribute('data-open',open);
  panel.inert=!open;
  if(open)panel.removeAttribute('aria-hidden');else panel.setAttribute('aria-hidden','true');
  toggle.setAttribute('aria-expanded',String(open));
  toggle.title=open?'Свернуть поиск':'Поиск по словам';
  if(open&&focus)input.focus({preventScroll:true});
  if(!open&&input.value){input.value='';wordLimit=48;if(render)renderWords()}
}
function resetWordView(){exitWordSelection();setWordSearch(false,{render:false})}
function removeSelectedWords(keys){
  const records=keys.map(key=>learning.words[key]).filter(Boolean);
  if(!records.length)throw new Error('Selection no longer exists');
  const exactKeys=new Set(records.map(r=>r.key));
  // Persist the authoritative snapshot first; denied storage leaves the list and selection unchanged.
  persistWordRows(packLearning(learning,{excludeKeys:exactKeys}));
  for(const r of records)removeWord(learning,r.word,r.language);
  clearTimeout(learningTimer);learningDirty=false;
  try{mirrorLegacy()}catch{}
  exitWordSelection();renderHomePanel();wordSavedState();refreshSelectedStage();
  return 'Удалено: '+wordCountText(records.length)+'.';
}
function renderRecallButton(b,n){b.textContent=n?`Флеш-карты · ${n}`:'Флеш-карты';b.disabled=!n}
function renderHomePanel(){
  languageUI?.place(homeView);
  if(homeView==='words'){renderWords();return}
  // The dock badge is shared, but hidden panels shouldn't build shelves or word cards.
  const measures=homeView==='practice'?learningStats(learning,Date.now()):null;
  const total=measures?.total??Object.keys(learning.words).length;
  $('#word-count').textContent=total;
  if(homeView==='home')renderPersonalShelf();
  else if(homeView==='library')refreshCatalog();
  else if(homeView==='profile'){renderProfileStats(total);readingActivity.render()}
  else if(homeView==='practice'){
    const n=measures.due;
    const launch=$('#practice-review'),count=$('#practice-due-count');
    launch.disabled=!n;count.hidden=!n;count.textContent=n?String(n):'';
    if(n)count.setAttribute('aria-label',wordCountText(n)+' к повторению');
    else count.removeAttribute('aria-label');
    $('#practice-recall-note').textContent=n?'Вспомните значение, потом проверьте себя.':
      measures.total?'Пока нет слов, которые пора повторить.':'Сохраните слова при чтении, чтобы собрать карточки.';
  }
}
const wordStageFilters=$('#word-stage-filters');
const wordStageButtons=$$('[data-stage-filter]');
const wordStageMotion=installNavMotion(wordStageFilters,{indicator:'.catalog-current',keyAttribute:'stage-filter'});
function revealWordStageButton(button){
  if(!button?.matches('button[data-stage-filter]')||wordStageFilters.scrollWidth<=wordStageFilters.clientWidth)return;
  const bounds=wordStageFilters.getBoundingClientRect(),cell=button.getBoundingClientRect();
  const left=bounds.left+wordStageFilters.clientLeft,right=left+wordStageFilters.clientWidth;
  // Reveal only inside the filter control, without moving the page.
  if(cell.left<left)wordStageFilters.scrollLeft+=cell.left-left;
  else if(cell.right>right)wordStageFilters.scrollLeft+=cell.right-right;
}
wordStageFilters.addEventListener('focusin',e=>revealWordStageButton(e.target));

function renderWords({motion=false,appendFrom=0}={}){
  const measures=learningStats(learning,Date.now());
  $('#word-count').textContent=measures.total;
  paintWordSelection(measures.total);
  $('#study-summary').textContent=measures.total?`${wordCountText(measures.total)} · ${measures.known} знаю`:'Слова из ваших книг';
  for(const b of wordStageButtons){
    const status=b.dataset.stageFilter,n=status==='all'?measures.total:measures[status];
    b.setAttribute('aria-pressed',String(status===wordFilter));b.querySelector('small').textContent=n;
  }
  wordStageMotion.select(wordFilter,{animate:motion});
  const list=$('#saved-list'),key=searchKey($('#word-search').value),filter=wordFilter;
  const matches=Object.values(learning.words).filter(r=>(filter==='all'||stage(r)===filter)&&(!key||searchKey(r.word).includes(key)||(!state.prefs.dictionaryPack&&state.prefs.dictionaryTarget==='ru'&&searchKey(baseForStudy(r)?.[0]||'').includes(key))));
  $('#word-matches').textContent=key||filter!=='all'?`Найдено: ${matches.length}`:'';
  $('#words-more').hidden=matches.length<=wordLimit;
  // Appending an unchanged prefix keeps its controls and async glosses alive.
  // Filtering or a changed word order still rebuilds the complete visible list.
  let offset=appendFrom>0&&matches.length>appendFrom&&list.childElementCount===appendFrom?appendFrom:0;
  for(let i=0;i<offset;i++)if(list.children[i].dataset.studyWord!==matches[i].key){offset=0;break}
  if(!offset)list.replaceChildren();
  if(!matches.length){
    if(key||filter!=='all'){list.append(node('p',key?'Ничего не найдено.':'Пока нет слов с этим статусом.','empty-state'));return}
    const empty=node('div',null,'empty-state wordbook-empty'),link=node('a','Выбрать книгу','wordbook-link');
    link.href='#library';
    empty.append(node('h2','Пока нет сохранённых слов'),node('p','Нажмите слово в книге, чтобы начать изучение.'),link);
    list.append(empty);return
  }
  const chunk=document.createDocumentFragment(),packId=state.prefs.dictionaryPack,target=state.prefs.dictionaryTarget,captions=[];
  for(const record of matches.slice(offset,wordLimit)){
    const row=node('div',null,'saved-row'),info=node('div',null,'saved-main'),title=node('div',null,'word-row-title'),word=node('strong',record.word);
    row.dataset.studyWord=record.key;word.lang=record.language;title.append(word,stageBadge(record));
    const base=packId||target!=='ru'?null:baseForStudy(record),caption=node('p',base?.[0]||'','word-list-gloss');
    caption.hidden=!base;captions.push({record,caption});
    info.append(title,caption,node('p',recordInfo(record),'word-list-meta'));
    if(selectingWords){
      const label=node('label',null,'word-select-row'),input=node('input'),check=node('span',null,'word-select-check');
      input.type='checkbox';input.checked=selectedWordKeys.has(record.key);
      input.setAttribute('aria-label',`Выбрать ${record.word} (${record.language.toUpperCase()})`);
      check.setAttribute('aria-hidden','true');check.innerHTML=iconMarkup('check');
      input.onchange=()=>{if(input.checked)selectedWordKeys.add(record.key);else selectedWordKeys.delete(record.key);paintWordSelection()};
      label.append(input,check,info);row.append(label);chunk.append(row);continue;
    }
    const known=stage(record)==='known',actions=node('div',null,'word-row-actions'),
      setKnown=node('button',null,'icon-button word-card-know'),del=node('button',null,'icon-button word-card-remove');
    const label=known?`Вернуть ${record.word} в изучение`:`Отметить ${record.word} как известное`;
    for(const [button,glyph,description,tooltip] of [[setKnown,'check',label,known?'Вернуть в изучение':'Знаю'],[del,'trash',`Убрать слово ${record.word}`,'Удалить слово']]){
      button.type='button';button.setAttribute('aria-label',description);button.title=tooltip;
      const icon=node('i',null,'icon-glyph');icon.innerHTML=iconMarkup(glyph);button.append(icon);
    }
    setKnown.toggleAttribute('data-known',known);
    setKnown.onclick=e=>studyStatus(record,e);del.onclick=e=>removeStudy(record,e);
    actions.append(setKnown,del);row.append(info,actions);chunk.append(row);
  }
  list.append(chunk);
  if(captions.length)void fillStudyCaptions(captions,{packId,target});
}
async function fillStudyCaptions(captions,prefs){
  if($('#words-view').hidden)return;
  for(let i=0;i<captions.length;i+=12){
    if(!captions[i].caption.isConnected||$('#words-view').hidden)return;
    await Promise.all(captions.slice(i,i+12).map(async ({record,caption})=>{
      try{
        const meaning=firstGloss(await lookupStudy(record,prefs));
        if(!caption.isConnected||!meaning)return;
        caption.textContent=meaning.length>160?meaning.slice(0,157)+'…':meaning;caption.hidden=false;
      }catch{}
    }));
  }
}
const HOME_ROUTES=['home','library','words','practice','profile'];
const navMotion=installNavMotion($('.nav-dock'));
function homeRoute(){const view=location.hash.slice(1);if(view.startsWith('profile/'))return 'profile';return HOME_ROUTES.includes(view)?view:'home'}
function showHome(which='home',{motion=false,focus=false}={}){
  const leavingReader=!$('#reader').hidden,changed=homeView!==which,forward=HOME_ROUTES.indexOf(which)>HOME_ROUTES.indexOf(homeView);
  if(leavingReader){cancelLocalQueue({abortAutomatic:true});readingHome.leaveReader();closeReaderSheets();capturePosition(true);closeComicView();clearIllustrations();renderEpoch++;$('#passage').removeAttribute('aria-busy');suppressScroll=false;clearTimeout(saveTimer);clearTimeout(seenTimer)}
  if(!leavingReader&&!changed&&homeLeaving===false&&$('#home').dataset.ready==='true')return;
  cancelSpeech();cancelMotion($('#reader'));
  document.body.classList.remove('reading');setChromeColor();$('#reader').hidden=true;$('#home').hidden=false;$('#home').dataset.ready='true';
  if(changed)cancelMotion($('#'+homeView+'-view'));
  if(which!=='words')resetWordView();
  homeView=which;homeLeaving=false;
  for(const view of HOME_ROUTES)$('#'+view+'-view').hidden=view!==which;
  $$('[data-view]').forEach(b=>{const active=b.dataset.view===which;b.classList.toggle('active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')});
  navMotion.select(which,{animate:motion&&!leavingReader&&changed});
  renderHomePanel();
  if(which==='profile')void dictUI.refresh();
  if(which==='practice'&&changed)showPracticeMenu();
  if(which!=='practice'&&changed)deactivatePractice();
  if(leavingReader||changed){
    window.scrollTo({top:leavingReader?(routeScroll[which]||0):0,behavior:'instant'});
    revealMotion($('#'+which+'-view'),leavingReader?'home':forward?'tabForward':'tabBack',{enabled:motion});
  }
  if(leavingReader&&which==='library'&&readerTrigger.startsWith('editorial:')&&focus){
    const id=readerTrigger.slice(10);if(editorialUI[editorialKind(id)]?.focusArticle(id))return;
  }
  if(leavingReader&&which==='library'&&readerTrigger.startsWith('starter:')&&focus){
    if(starterShelf.focusBook(readerTrigger.slice(8)))return;
  }
  if(focus&&leavingReader&&which==='home'){
    const target=$$('.book-open').find(b=>b.dataset.book===readerTrigger);
    if(target)target.focus({preventScroll:true});else readingHome.focusContinue();
  }else if(focus&&leavingReader&&which==='library'){
    $('#import-open').focus({preventScroll:true});
  }else if(focus&&changed){
    const title=$('#'+which+'-view h1'); if(title){title.tabIndex=-1;title.focus({preventScroll:true})}
  }
}
function closeReaderSheets(){
  // These modal elements live outside #reader, so hiding the reader alone
  // does not remove them from the top layer on a browser Back or hash change.
  for(const id of ['translation-dialog','contents-dialog','preferences']){
    const dialog=$('#'+id);if(dialog.open)dialog.close();
  }
  dismissWord();
}
function navigateHome(which,event){
  if(location.hash!=='#'+which)location.hash=which;
  showHome(which,{motion:!!event?.detail,focus:!!event&&event.detail===0});
}
function openBook(id,explicit,{motion=false,focus=false,trigger=''}={}){
  if(readerBackPending)return;
  const fromShelf=$('#reader').hidden&&!$('#home').hidden;
  if(!$('#reader').hidden){
    if(current?.id!==id)cancelLocalQueue({abortAutomatic:true});
    dismissWord();capturePosition(true);closeComicView();
  }
  else if(!$('#home').hidden){
    readerReturn=location.hash.startsWith('#read/')?returnRoute():homeView==='library'?'library':'home';
    if(Object.hasOwn(routeScroll,readerReturn))routeScroll[readerReturn]=window.scrollY;
  }
  resetWordView();
  current=books.find(b=>b.id===id)||demo;state.lastBook=current.id;readerTrigger=trigger;homeLeaving=true;
  const comic=isComic(current),scroll=$('#reading-scroll');
  scroll.setAttribute('aria-label',comic?'Просмотр комикса':'Оригинал книги');
  scroll.setAttribute('aria-describedby',comic?'reader-comic-keys':'reader-word-keys');
  const pos=safePosition(explicit||state.positions[current.id],current)||
    {chapter:0,paragraph:0,fraction:0,...(comic?{}:{chapterTop:true})};
  chapter=pos.chapter;paragraph=pos.paragraph;
  cancelMotion($('#'+homeView+'-view'));$('#home').hidden=true;$('#reader').hidden=false;document.body.classList.add('reading');setChromeColor();
  $('#book-title').textContent=current.title;renderStarterEdition(current);if(!comic)renderRibbon();renderChapter(pos);saveState();
  const url='#read/'+encodeURIComponent(current.id);
  if(location.hash!==url){
    const shelfParent=fromShelf&&(location.hash==='#'+readerReturn||(!location.hash&&readerReturn==='home'));
    const {folioIllustration,folioIllustrationTarget,...parent}=history.state||{};
    history.pushState({...parent,folioReaderReturn:readerReturn,folioReaderShelfParent:shelfParent},'',url);
  }
  readingHome.enterReader();
  revealMotion($('#reader'),'reader',{enabled:motion});
  if(focus)scroll.focus({preventScroll:true});
}
let comicView=null,comicStrip=null,activeComicPage=null,comicOCR=null,comicImportJob=null,comicCorrection=null;
let comicResizeAnchor=null,comicRegionPicker=null,comicRegionEpoch=0,comicRegionRun=null;
const comicOCRDialog=$('#comic-ocr-dialog'),comicOCRLanguage=$('#comic-ocr-language'),comicOCRStart=$('#comic-ocr-start');
const comicOCRSheet=installSheet(comicOCRDialog);
for(const [id,option] of Object.entries(COMIC_OCR_OPTIONS)){
  const choice=node('option',option.label);choice.value=id;comicOCRLanguage.append(choice);
}
function closeComicCorrection(){
  comicRegionEpoch++;comicRegionPicker?.leave();comicCorrection=null;if(comicOCRDialog.open)comicOCRDialog.close();
}
function openComicCorrection(index,opener){
  if(!isComic(current)||index!==chapter||activeComicPage?.index!==index||comicOCR)return;
  comicCorrection={book:current,index,opener};
  comicOCRLanguage.value=comicPageModel(current,index);
  comicOCRStart.textContent=activeComicPage.ocr?'Распознать заново':'Распознать';
  comicOCRSheet.open();
}
comicOCRDialog.addEventListener('close',()=>{
  if(comicOCRDialog.open)return;
  const target=comicCorrection;comicCorrection=null;
  if(target?.book===current&&target.index===chapter&&!$('#reader').hidden&&target.opener.isConnected)target.opener.focus({preventScroll:true});
});
$('#comic-ocr-form').onsubmit=event=>{
  event.preventDefault();
  const target=comicCorrection, model=comicOCRLanguage.value;
  if(!target||target.book!==current||target.index!==chapter||!Object.hasOwn(COMIC_OCR_OPTIONS,model))return;
  closeComicCorrection();
  $('#reading-scroll').focus({preventScroll:true});
  void recognizeCurrentComicPage(target.index,model,{replace:true});
};
$('#comic-region-open').onclick=async()=>{
  const target=comicCorrection,stored=activeComicPage;
  if(!target||target.book!==current||target.index!==chapter||stored?.index!==chapter||comicOCR)return;
  const model=stored.ocr?.ocrLanguage||comicOCRLanguage.value;
  if(!Object.hasOwn(COMIC_OCR_OPTIONS,model))return;
  capturePosition(true);
  const offset=state.positions[current.id]?.comicImageOffset??0,meta=current.comicPages[chapter];
  closeComicCorrection();const intent=++comicRegionEpoch;
  try{
    const {createComicRegionPicker}=await import('./comic-region.js');
    if(intent!==comicRegionEpoch||target.book!==current||stored!==activeComicPage||$('#reader').hidden||comicOCR)return;
    comicRegionPicker??=createComicRegionPicker($('#comic-region-dialog'));
    comicRegionPicker.open({...meta,blob:stored.blob,offset,opener:target.opener,apply(region){
      if(target.book===current&&stored===activeComicPage&&!$('#reader').hidden)
        void recognizeCurrentComicPage(target.index,model,{replace:true,region});
    }});
  }catch{if(intent===comicRegionEpoch)toast('Не удалось открыть выбор области. Попробуйте ещё раз.');}
};
function readingSourceLanguage(book,index){
  return isComic(book)?comicModelTag(comicPageModel(book,index)):book?.language;
}
function clearComicStrip(){
  comicStrip?.destroy();comicStrip=null;
  $('#reader').classList.remove('comic-strip-mode');
}
function paintComicLayout(strip){
  $('#comic-layout').setAttribute('aria-pressed',String(strip));
  $('#reading-scroll').setAttribute('aria-describedby',strip?'reader-comic-strip-keys':'reader-comic-keys');
}
function changeComicLayout(strip,{focusOcr=false}={}){
  if(!current||!isComic(current)||$('#reader').hidden)return;
  capturePosition(true);dismissWord();
  const p=safePosition(state.positions[current.id],current)||{chapter,paragraph,fraction:0};
  if(strip){p.comicLayout='strip';p.paragraph=0;}
  else delete p.comicLayout;
  chapter=p.chapter;paragraph=p.paragraph;
  renderChapter(p,{focusOcr});saveState();
}
$('#comic-layout').onclick=()=>changeComicLayout(state.positions[current?.id]?.comicLayout!=='strip');
function closeComicView(){
  clearComicStrip();comicResizeAnchor=null;closeComicCorrection();
  comicOCR?.abort();comicOCR=null;activeComicPage=null;
  comicView?.destroy();comicView=null;
  $('#reader').classList.remove('comic-mode');$('.translation-wrap').hidden=false;$('#translation-full').hidden=false;
}
function comicPageGeometry(sc){
  const frame=sc.querySelector('.comic-frame:not(.comic-image-failed)'),bar=sc.querySelector('.comic-bar');
  if(!frame||!bar||!activeComicPage)return null;
  const {top,height}=frame.getBoundingClientRect();
  if(height<=0)return null;
  return {offset:sc.getBoundingClientRect().top+bar.offsetHeight-top,height,maxScroll:Math.max(0,sc.scrollHeight-sc.clientHeight)};
}
function restoreComicPosition(sc,position){
  const g=comicPageGeometry(sc);
  if(!g)return;
  const anchor=position.comicStripArtworkOffset??position.comicImageOffset;
  if(anchor===1){sc.scrollTop=g.maxScroll;return}
  if(anchor===0){sc.scrollTop=0;return}
  // Older bookmarks lack an artwork anchor. Keep their existing interpretation.
  sc.scrollTop=anchor==null?g.maxScroll*(position.fraction||0):sc.scrollTop-g.offset+anchor*g.height;
}
function rememberComicResizeAnchor(sc,position){
  comicResizeAnchor={epoch:renderEpoch,top:sc.scrollTop,position};
}
function updateComicProgress(){
  const percentage=progress(current);
  $('#reading-progress').textContent=`${chapter+1} / ${current.comicPages.length}`;
  $('#progress-fill').style.transform=`scaleX(${percentage/100})`;updateBookmark();
}
async function renderComicPage(position,{bookmark=false,focusOcr=false}={}){
  clearComicStrip();paintComicLayout(false);
  const epoch=++renderEpoch,book=current,index=chapter,meta=book.comicPages[index],sc=$('#reading-scroll');
  const visible=()=>epoch===renderEpoch&&current===book&&chapter===index&&!$('#reader').hidden;
  closeComicCorrection();comicOCR?.abort();comicOCR=null;activeComicPage=null;
  cancelSpeech();paragraphObserver?.disconnect();suppressScroll=true;
  paragraph=Math.min(position.paragraph||0,book.chapters[index].paragraphs.length-1);
  state.positions[book.id]={...position,chapter,paragraph,fraction:position.fraction||0};
  $('#reader').classList.add('comic-mode');$('.translation-wrap').hidden=true;$('#translation-full').hidden=true;
  $('#chapter-title').textContent=`Страница ${index+1} из ${book.comicPages.length}`;
  updateComicProgress();
  try{
    const [{createComicReader},stored]=await Promise.all([import('./comic-reader.js'),readComicPage(db,book.id,index)]);
    if(!visible())return;
    if(!(stored?.blob instanceof Blob))throw new Error('Page unavailable');
    activeComicPage=stored;
    comicView??=createComicReader($('#passage'),{
      onNavigate:next=>switchChapter(next),
      onWord:({button,event})=>{if(isComic(current)&&activeComicPage?.index===chapter)void showWord(button,event)},
      onRecognize:idx=>void recognizeCurrentComicPage(idx),
      onCorrection:openComicCorrection,onCancel:cancelComicRegionOCR,
      decorateWord:(button,word)=>attachStage(button,getWord(learning,word,trackingLanguage(word))),
    });
    const data=stored.ocr||{};
    comicView.showPage({...meta,index,total:book.comicPages.length,blob:stored.blob,...data,language:readingSourceLanguage(book,index)});
    requestAnimationFrame(()=>{
      if(!visible())return;
      restoreComicPosition(sc,position);suppressScroll=false;
      rememberComicResizeAnchor(sc,state.positions[book.id]);
      if(bookmark)outcomeCue($('#chapter-open'),'bookmark',1000);
      // Focus the page's existing tools without automatically running OCR.
      if(focusOcr&&!document.querySelector('dialog[open]')&&document.activeElement===sc)
        ($('#passage .comic-scan:not([hidden])')||$('#passage .comic-text-toggle:not([hidden])')||sc).focus({preventScroll:true});
    });
  }catch{
    if(!visible())return;
    comicView?.destroy();comicView=null;
    $('#passage').replaceChildren(node('p','Не удалось открыть страницу на этом устройстве.','comic-storage-error'));
    suppressScroll=false;
  }
}
async function renderComicStrip(position,{bookmark=false}={}){
  const epoch=++renderEpoch,book=current,sc=$('#reading-scroll'),host=$('#passage');
  const owns=()=>epoch===renderEpoch&&current===book&&!$('#reader').hidden;
  clearComicStrip();comicView?.destroy();comicView=null;
  closeComicCorrection();comicOCR?.abort();comicOCR=null;activeComicPage=null;comicResizeAnchor=null;
  cancelSpeech();paragraphObserver?.disconnect();suppressScroll=true;
  chapter=position.chapter;paragraph=0;
  state.positions[book.id]={...position,chapter,paragraph,comicLayout:'strip'};
  $('#reader').classList.add('comic-mode','comic-strip-mode');
  $('.translation-wrap').hidden=true;$('#translation-full').hidden=true;paintComicLayout(true);
  const paint=()=>{
    const label='Страница '+(chapter+1)+' из '+book.comicPages.length;
    if($('#chapter-title').textContent!==label)$('#chapter-title').textContent=label;
    updateComicProgress();
  };
  paint();host.replaceChildren(node('p','Открываем ленту…','comic-note'));
  try{
    const {createComicStrip}=await import('./comic-strip.js');
    if(!owns())return;
    comicStrip=createComicStrip(host,sc,book.comicPages,{
      load:index=>readComicPage(db,book.id,index),
      onPosition:pos=>{
        if(!owns())return;
        const moved=chapter!==pos.chapter;
        chapter=pos.chapter;paragraph=0;state.positions[book.id]=pos;
        if(moved)paint();
      },
      onReadPage:()=>{
        if(!owns())return;
        sc.focus({preventScroll:true});changeComicLayout(false,{focusOcr:true});
      },
    });
    requestAnimationFrame(()=>{
      if(!owns())return;
      comicStrip.seek(position);suppressScroll=false;paint();
      if(bookmark)outcomeCue($('#chapter-open'),'bookmark',1000);
    });
  }catch{
    if(!owns())return;
    const fallback={...position};delete fallback.comicLayout;
    toast('Не удалось открыть ленту. Показана текущая страница.');
    void renderComicPage(fallback,{bookmark});saveState();
  }
}
function cancelComicRegionOCR(index){
  const job=comicRegionRun;
  if(!job||job.index!==index||job.controller!==comicOCR||chapter!==index)return;
  comicRegionRun=null;comicOCR=null;job.controller.abort();
  comicView?.setOCR({status:'idle'});
}
async function recognizeCurrentComicPage(index,language,{replace=false,region}={}){
  const book=current,stored=activeComicPage;
  if(!isComic(book)||index!==chapter||stored?.index!==index||comicOCR||(stored.ocr&&!replace))return;
  language??=comicPageModel(book,index);
  if(!Object.hasOwn(COMIC_OCR_OPTIONS,language))return;
  cancelLocalQueue();
  const controller=comicOCR=new AbortController(),signal=controller.signal;
  if(region)comicRegionRun={index,controller};
  const active=()=>!signal.aborted&&current===book&&chapter===index&&activeComicPage===stored&&!$('#reader').hidden;
  comicView.setOCR({status:'loading',cancellable:!!region});
  try{
    const {recognizeComicPage}=await import('./comic-ocr.js');
    if(!active())return;
    const displayImage=region?comicView.decodedPage(stored.blob):null;
    const result=await recognizeComicPage(stored.blob,{language,signal,region,displayImage,onProgress:update=>{
      if(active())comicView.setOCRProgress(update);
    }});
    if(!active())return;
    const found=result.paragraphs||[];
    if(!found.some(p=>typeof p?.text==='string'&&p.text.trim())){comicView.setOCR({status:'empty'});return}
    let merged=result;
    const priorText=region?stored.ocr?.paragraphs?.[paragraph]?.text:null;
    if(region&&stored.ocr){
      const {mergeComicRegion}=await import('./comic-region.js');
      if(!active())return;
      merged=mergeComicRegion(stored.ocr,result,region);
      if(merged.status==='ambiguous'){
        comicView.setOCR({status:'idle'});
        toast('Порядок реплик неясен. Старый текст оставлен. Выберите одно облачко.');
        return;
      }
    }
    if(merged.paragraphs.length>2000||(merged.words?.length??0)>5000||
       merged.paragraphs.reduce((n,p)=>n+p.text.length,0)>160_000)throw Error('Слишком много текста на странице.');
    const ocr={status:'ready',ocrLanguage:language,text:merged.paragraphs.map(p=>p.text).join('\n\n'),paragraphs:merged.paragraphs,words:merged.words||[]};
    const updatedChapter=comicOCRChapter(book.chapters[index],ocr);
    // A failed retry, or one the browser cannot persist, must not replace
    // the last usable transcription and its dictionary language.
    if(comicRegionRun?.controller===controller)comicRegionRun=null;
    comicView.setOCRProgress({stage:'save'});
    await updateComicPage(db,book.id,{...stored,ocr});
    book.chapters[index]=updatedChapter;stored.ocr=ocr;
    if(active()){
      dismissWord();
      if($('#translation-dialog').open)$('#translation-dialog').close();
      const retain=priorText?updatedChapter.paragraphs.findIndex(p=>p.text===priorText):-1;
      if(retain>=0&&retain!==paragraph)setActiveParagraph(retain);
      else if(paragraph>=updatedChapter.paragraphs.length)setActiveParagraph(0);
      comicView.setOCR({...ocr,language:readingSourceLanguage(book,index)});
    }
  }catch(e){if(active())comicView.setOCR({status:'error'})}
  finally{if(comicRegionRun?.controller===controller)comicRegionRun=null;if(comicOCR?.signal===signal)comicOCR=null}
}
const comicImportDialog=$('#comic-import-dialog'),comicFiles=$('#comic-files'),comicImportStart=$('#comic-import-start'),comicImportStatus=$('#comic-import-status'),comicImportCancel=$('#comic-import-cancel');
const comicImportSheet=installSheet(comicImportDialog,{opener:$('#comic-import-open'),canDismiss:()=>!comicImportDialog.hasAttribute('data-saving')});
$('#comic-import-open').onclick=()=>{
  comicFiles.value='';comicImportStart.disabled=true;comicImportStatus.textContent='';comicImportSheet.open();
};
comicFiles.onchange=()=>{comicImportStart.disabled=!comicFiles.files.length;comicImportStatus.textContent=''};
comicImportCancel.onclick=()=>comicImportJob?.abort();
comicImportDialog.addEventListener('close',()=>{if(!comicImportDialog.open)comicImportJob?.abort()});
comicImportStart.onclick=async()=>{
  if(comicImportJob||!comicFiles.files.length)return;
  const controller=comicImportJob=new AbortController(),signal=controller.signal;
  comicFiles.disabled=comicImportStart.disabled=$('#comic-language').disabled=true;comicImportCancel.hidden=false;
  comicImportStatus.textContent='Проверяем страницы…';
  try{
    const {parseComicFiles}=await import('./comic-import.js');
    const parsed=await parseComicFiles([...comicFiles.files],{signal,onProgress:({page,total})=>{
      if(!signal.aborted)comicImportStatus.textContent='Страницы: '+page+' / '+total;
    }});
    if(signal.aborted||!comicImportDialog.open)return;
    const book=comicBook('book-'+crypto.randomUUID(),parsed,$('#comic-language').value);
    comicImportDialog.setAttribute('data-saving','');comicImportCancel.hidden=true;
    await putComic(db,book,parsed.pages);
    books.push(book);comicImportDialog.close();toast('Комикс добавлен.');openBook(book.id,undefined,{focus:true,trigger:book.id});
  }catch(e){
    if(!comicImportDialog.open)return;
    comicImportStatus.textContent=signal.aborted?'Импорт отменён.':e.name==='QuotaExceededError'?'Недостаточно места для страниц.':e.message||'Не удалось импортировать комикс.';
  }finally{
    comicImportJob=null;comicImportDialog.removeAttribute('data-saving');
    comicFiles.disabled=$('#comic-language').disabled=false;comicImportStart.disabled=!comicFiles.files.length;comicImportCancel.hidden=true;
  }
};

function readingClip(){
  const r=$('#reading-scroll').getBoundingClientRect(),v=window.visualViewport;
  return {top:Math.max(r.top,v?.offsetTop||0),bottom:Math.min(r.bottom,(v?.offsetTop||0)+(v?.height||innerHeight)),left:Math.max(r.left,v?.offsetLeft||0),right:Math.min(r.right,(v?.offsetLeft||0)+(v?.width||innerWidth))};
}
function tokenInClip(button,clip){
  const r=button.getBoundingClientRect();
  const y=Math.min(r.bottom,clip.bottom)-Math.max(r.top,clip.top),x=Math.min(r.right,clip.right)-Math.max(r.left,clip.left);
  return r.width>0&&r.height>0&&x>=Math.min(r.width*.65,24)&&y>=r.height*.6;
}
function scheduleSeen(){
  clearTimeout(seenTimer);if(!current||isComic(current)||$('#reader').hidden||document.visibilityState!=='visible'||suppressScroll||document.querySelector('dialog[open]'))return;
  const epoch=renderEpoch,bookId=current.id,chapterIndex=chapter,index=paragraph,scroller=$('#reading-scroll'),y=scroller.scrollTop;
  seenTimer=setTimeout(()=>{
    if(epoch!==renderEpoch||current?.id!==bookId||chapter!==chapterIndex||paragraph!==index||$('#reader').hidden||suppressScroll||document.visibilityState!=='visible'||document.querySelector('dialog[open]')||Math.abs(scroller.scrollTop-y)>3)return;
    if(!canWriteWords())return;
    const row=$('#paragraph-'+index);if(!row?.isConnected)return;
    const clip=readingClip(),rowRect=row.getBoundingClientRect();
    if(Math.min(clip.bottom,rowRect.bottom)-Math.max(clip.top,rowRect.top)<Math.min(55,rowRect.height*.60))return;
    let changed=false;
    for(const token of row.querySelectorAll('button.word')){
      const record=getWord(learning,token.textContent,trackingLanguage(token.textContent));
      if(record&&tokenInClip(token,clip)&&recordEncounter(record,{bookId,chapter:chapterIndex,paragraph:index,offset:Number(token.dataset.offset)},Date.now())){
        changed=true;attachStage(token,record);
      }
    }
    if(changed)trackChanged();
  },650);
}
function wordNodes(text,language){
  const fragment=document.createDocumentFragment();
  let cursor=0,first=true;
  for(const {word,offset} of readingWordSegments(text,language)){
    if(offset>cursor)fragment.append(document.createTextNode(text.slice(cursor,offset)));
    const b=node('button',word,'word');b.dataset.word=word.replaceAll('\u00ad','').toLocaleLowerCase();b.dataset.offset=offset;b.type='button';b.tabIndex=first?0:-1;
    attachStage(b,getWord(learning,word,trackingLanguage(word)));fragment.append(b);
    first=false;cursor=offset+word.length;
  }
  if(cursor<text.length)fragment.append(document.createTextNode(text.slice(cursor)));
  return fragment;
}
function renderChapter(position={chapter,paragraph:0,fraction:0},{bookmark=false,focus=false,focusOcr=false}={}){
  const host=$('#passage'),sc=$('#reading-scroll'),book=current,chapterIndex=chapter;
  const comic=isComic(book);clearIllustrations();listenButton.hidden=comic;$('#comic-layout').hidden=!comic;
  if(comic){
    host.removeAttribute('aria-busy');
    if(position.comicLayout==='strip')void renderComicStrip(position,{bookmark});
    else void renderComicPage(position,{bookmark,focusOcr});
    return;
  }
  const epoch=++renderEpoch,c=book.chapters[chapterIndex],language=book.language||'';
  // Use estimated off-screen row sizes only for substantial chapters. A
  // small chapter is cheap to lay out and its exact geometry stays stable
  // when a background tab becomes visible before the checkpoint is saved.
  let chapterChars=0;
  host.toggleAttribute('data-deferred-layout',c.paragraphs.length>96||c.paragraphs.some(p=>(chapterChars+=p.text.length)>48_000));
  const alive=()=>epoch===renderEpoch&&!$('#reader').hidden;
  suppressScroll=true;cancelSpeech();
  paragraph=Math.max(0,Math.min(c.paragraphs.length-1,position.paragraph||0));
  state.positions[book.id]={...position,chapter:chapterIndex,paragraph,fraction:position.fraction||0};
  $('#chapter-title').textContent=`${chapterIndex+1} / ${book.chapters.length} · ${c.title}`;
  $('#chapter-meta').textContent=`ГЛАВА ${chapterIndex+1} · ${language||'ОРИГИНАЛ'}`;
  $('#chapter-heading').textContent=c.title;
  $('#previous-chapter').disabled=chapterIndex===0;
  $('#next-chapter').disabled=chapterIndex===book.chapters.length-1;
  $('.reader-help').open=false;
  $('#reading-note').textContent=book.alignment==='demo'?'Демо: три фрагмента с готовым переводом.':book.alignment==='none'
    ?(isStarterId(book.id)?'У издания нет готового парного текста. Словарь доступен по нажатию на слово.':'Файл перевода не добавлен.')
    :'Сопоставление по порядку, не по смыслу. Несовпавшие главы не переведены.';
  const pageNo=Number(/^Страница (\d+)$/.exec(c.title)?.[1]);
  if(book.ocr?.pages.includes(pageNo))$('#reading-note').textContent+=book.ocr.uncertain.includes(pageNo)
    ?' На этой странице OCR не уверено в результате. Сверьте текст с оригиналом.':' Эта страница содержит распознанный текст.';
  paragraphObserver?.disconnect();
  const observer=paragraphObserver=new IntersectionObserver(entries=>{
    if(!alive())return;
    for(const entry of entries)if(entry.isIntersecting){
      const el=entry.target;
      if(!el.dataset.hydrated){el.replaceChildren(wordNodes(el.textContent,el.lang));el.dataset.hydrated='true'}
      observer.unobserve(el);
    }
  },{root:sc,rootMargin:'600px'});
  const passage=document.createDocumentFragment(),large=c.paragraphs.length>640;
  // A cold render can rehydrate the viewer only from this tab's current
  // history entry. Chapter switches and normal routing never auto-open it.
  const target=$('#folio-boot')?history.state?.folioIllustrationTarget:null;
  const restoreToken=target&&target.route===location.href&&target.chapter===chapterIndex?history.state?.folioIllustration:null;
  const loadIllustration=index=>dbAction('readonly',store=>readIllustration(store,book.id,index));
  const openIllustration=(info,token)=>{
    if(!alive())return;
    bookSpeech.pause();if(!token)capturePosition(true);
    illustrationViewer??=createIllustrationViewer($('#illustration-full'));
    illustrationViewer.open(info,token);
  };
  const slots=new Map(),drawings=new Map();let restoreDrawing=null;
  const layer=c.illustrations?.length
    ?(illustrationLayer=createIllustrationLayer(sc,loadIllustration,info=>{
      openIllustration({...info,chapter:chapterIndex,slot:slots.get(info.button)});
    })):null;
  if(layer)c.illustrations.forEach((illustration,slot)=>{
    if(!drawings.has(illustration.before))drawings.set(illustration.before,[]);
    drawings.get(illustration.before).push({illustration,slot});
  });
  const appendArt=layer?index=>{
    for(const {illustration,slot} of drawings.get(index)||[]){
      const figure=layer.mount(document,illustration,language),button=figure.firstElementChild;
      slots.set(button,slot);passage.append(figure);
      if(restoreToken&&slot===target.slot)restoreDrawing={...illustration,language,button,chapter:chapterIndex,slot};
    }
  }:null;
  let next=0;
  if(large){
    const status=node('p','Открываем главу…','muted');status.setAttribute('role','status');
    host.setAttribute('aria-busy','true');host.replaceChildren(status);
  }
  function appendRows(){
    if(!alive()){observer.disconnect();return;}
    const end=large?Math.min(c.paragraphs.length,next+256):c.paragraphs.length;
    while(next<end){
      const i=next++,el=node('p',null,'reading-paragraph');
      el.dataset.paragraph=i;el.id=`paragraph-${i}`;el.lang=language;el.dir='auto';el.textContent=c.paragraphs[i].text;
      appendArt?.(i);passage.append(el);observer.observe(el);
    }
    // During a large chapter, let Back or a chapter change cancel the
    // detached build. Commit once so partial geometry never saves a position.
    if(next<c.paragraphs.length){setTimeout(appendRows,0);return}
    appendArt?.(c.paragraphs.length);host.replaceChildren(passage);host.removeAttribute('aria-busy');
    // Position and translation binary-search only text rows, never figures.
    if(layer)illustratedRows=host.querySelectorAll(':scope > .reading-paragraph');
    requestAnimationFrame(()=>{
      if(!alive())return;
      restorePosition(position);setActiveParagraph(paragraph,true);
      if(bookmark)outcomeCue($('#paragraph-'+paragraph),'bookmark',1000);
      if(!alive())return;
      suppressScroll=false;scheduleSeen();queueColdAnchorCorrection(position,epoch);
      if(restoreDrawing)void loadIllustration(restoreDrawing.asset).then(saved=>{
        if(saved?.blob instanceof Blob&&alive()&&history.state?.folioIllustration===restoreToken&&!document.querySelector('dialog[open]'))
          openIllustration({...restoreDrawing,blob:saved.blob},restoreToken);
      }).catch(()=>{});
      // Keyboard/AT jumps move focus only after settling their viewport.
      if(focus&&!document.hidden&&!document.querySelector('dialog[open]')){
        const target=bookmark?$('#paragraph-'+paragraph):$('#chapter-heading');
        if(target){if(bookmark)target.tabIndex=-1;target.focus({preventScroll:true})}
      }
    });
  }
  appendRows();
}
function restorePosition(p){
  if(isComic(current))return;
  const sc=$('#reading-scroll');
  if(p.textEnd){sc.scrollTop=sc.scrollHeight;markReadingScrollAnchor();return}
  if(p.chapterTop&&paragraph===0){sc.scrollTop=0;markReadingScrollAnchor();return}
  const el=$('#paragraph-'+paragraph);if(!el)return;
  const top=el.getBoundingClientRect().top-sc.getBoundingClientRect().top+sc.scrollTop;
  sc.scrollTop=Math.max(0,top-22+(p.fraction||0)*el.offsetHeight+(p.viewportDelta||0));
  markReadingScrollAnchor();
}
function queueColdAnchorCorrection(position,epoch){
  if(!globalThis.CSS?.supports('content-visibility','auto')||
    !(position.paragraph||position.fraction||position.viewportDelta)||document.hidden||readingScrollAnchor?.epoch!==epoch)return;
  const sc=$('#reading-scroll'),stopper=new AbortController(),signal=stopper.signal;
  const stop=()=>stopper.abort();
  const input={capture:true,passive:true,signal};
  for(const name of ['pointerdown','touchstart','wheel','keydown'])sc.addEventListener(name,stop,input);
  window.addEventListener('pagehide',stop,{once:true,signal});
  document.addEventListener('visibilitychange',stop,{once:true,signal});
  let anchor=readingScrollAnchor,frames=4;
  const settle=()=>{
    if(signal.aborted)return;
    if(epoch!==renderEpoch||document.hidden||readerSuspended||$('#reader').hidden||
      anchor!==readingScrollAnchor||Math.abs(sc.scrollTop-anchor.top)>1||document.querySelector('dialog[open]')){stop();return;}
    // On cold opens compositor layout may replace the upstream row estimates.
    // Re-read only the original row during a short, gesture-cancellable window.
    const before=sc.scrollTop;
    restorePosition(position);anchor=readingScrollAnchor;
    if(Math.abs(sc.scrollTop-before)>.5)scheduleSeen();
    if(--frames)requestAnimationFrame(settle);else stop();
  };
  requestAnimationFrame(settle);
}

function capturePosition(quiet=false){
  if(!current||$('#reader').hidden)return;
  // Before a layout/seek finishes, renderChapter already holds the intended target.
  if(suppressScroll){if(quiet)return saveState();return}
  const sc=$('#reading-scroll');
  if(isComic(current)){
    if(comicStrip){comicStrip.position();return saveState();}
    const g=comicPageGeometry(sc);
    if(!g)return saveState(); // A page that failed to load has no position to replace the saved one.
    const atEnd=g.maxScroll>0&&g.maxScroll-sc.scrollTop<1;
    // Use the visible location within the artwork, not the scroll percentage of
    // the whole view; the OCR transcript above the image opens and collapses.
    const comicImageOffset=atEnd?1:Math.max(0,Math.min(.999999,g.offset/g.height));
    const position=state.positions[current.id]={chapter,paragraph,comicImageOffset,
      fraction:Math.max(0,Math.min(.99,sc.scrollTop/Math.max(1,g.maxScroll)))};
    rememberComicResizeAnchor(sc,position);
    return saveState();
  }
  pendingReadingScroll?.flush(quiet);
  // A resize may have changed geometry before its frame and before the page hides.
  // Until a newer scroll owns the spot, keep its pre-reflow relative anchor.
  if(quiet&&readerSuspended&&readingResizeCurrent(pendingReadingResize,sc)){
    pendingReadingResize=null;deferredReadingReflowEpoch=renderEpoch;return saveState();
  }
  // Browsers can move the scroller, then hide before delivering its scroll event.
  if(!bookSpeech.playing&&readingScrollAnchor?.epoch===renderEpoch&&Math.abs(sc.scrollTop-readingScrollAnchor.top)>1){
    const reached=readingScrollParagraph(sc);
    if(reached!==paragraph)activateScrolledParagraph(reached,quiet);
    else markReadingScrollAnchor();
  }
  clearTimeout(saveTimer); // This synchronous writer supersedes its own delayed save.
  markReadingScrollAnchor();
  const para=$('#paragraph-'+paragraph),height=Math.max(1,para?.offsetHeight||0);
  const offset=para?sc.getBoundingClientRect().top+22-para.getBoundingClientRect().top:0;
  // The true chapter start includes its title, above the first paragraph.
  const atChapterTop=paragraph===0&&sc.scrollTop<=1;
  const fraction=atChapterTop?0:Math.max(0,Math.min(.99,offset/height)),position={chapter,paragraph,fraction};
  if(atChapterTop)position.chapterTop=true;
  // Selection and translation use a deeper line than the checkpoint. The viewport
  // can still be above the selected row or inside the gap below its last line.
  const remainder=offset-fraction*height;
  if(!atChapterTop&&Math.abs(remainder)>.01&&Math.abs(remainder)<=512&&readingScrollParagraph(sc)===paragraph)position.viewportDelta=remainder;
  // A whole article or long note can be one paragraph. Use its actual
  // scroll progress for display, independent of the exact text restore anchor.
  const solo=current.chapters.length===1&&current.chapters[0].paragraphs.length===1;
  if(solo){
    // The initial checkpoint can already scroll the chapter heading away.
    const start=Math.max(0,sc.scrollTop-offset),range=sc.scrollHeight-sc.clientHeight-start;
    const prior=state.positions[current.id]?.soloScrollProgress;
    if(range>0)position.soloScrollProgress=Math.max(0,Math.min(1,(sc.scrollTop-start)/range));
    else if(Number.isFinite(prior))position.soloScrollProgress=prior;
  }else if(chapter===current.chapters.length-1){
    // The last paragraph can run for many screens. Reserve 100% for the
    // end of the scroller, not for the moment this paragraph becomes active.
    const range=sc.scrollHeight-sc.clientHeight;
    if(range>1?range-sc.scrollTop<2:paragraph===current.chapters[chapter].paragraphs.length-1)position.textEnd=true;
  }
  state.positions[current.id]=position;
  if(!quiet)paintTextReadingProgress();
  if(current.id===DEMO_ID)try{localStorage.setItem('folio-page',chapter)}catch{}
  return saveState();
}
function paintTextReadingProgress(){
  const percentage=progress(current);
  const label=$('#reading-progress'),fill=$('#progress-fill');
  const message=`${percentage}% · абзац ${paragraph+1} / ${current.chapters[chapter].paragraphs.length}`;
  const scale=`scaleX(${percentage/100})`;
  if(label.textContent!==message)label.textContent=message;
  if(fill.style.transform!==scale)fill.style.transform=scale;
}
function setActiveParagraph(i,sync=false){
 pendingReadingScroll=null;deferredReadingTranslationEpoch=-1; // Explicit selections supersede older manual scrolls.
 if(!followingBook&&i!==paragraph)bookSpeech.stop();
 if(isComic(current)){paragraph=i;const p=state.positions[current.id];state.positions[current.id]={...p,chapter,paragraph,fraction:p?.fraction||0};updateComicProgress();return}
 markReadingScrollAnchor();
 const previous=paragraph;$('#paragraph-'+paragraph)?.classList.remove('active');paragraph=i;$(`#paragraph-${i}`)?.classList.add('active');if(previous!==i)state.positions[current.id]={chapter,paragraph,fraction:0};paintTextReadingProgress();updateBookmark();
 if(readerSuspended){if(sync)deferredReadingTranslationEpoch=renderEpoch;return}
 if(sync)syncTranslation();clearTimeout(saveTimer);saveTimer=setTimeout(capturePosition,180);scheduleSeen()}
let pendingReadingScroll=null,readingScrollAnchor=null,deferredReadingTranslationEpoch=-1,readerSuspended=false,checkpointSaved=false;
let pendingReadingResize=null,deferredReadingReflowEpoch=-1;
function suspendReading(){
  readerSuspended=true;
  if(!checkpointSaved&&current&&!$('#reader').hidden)checkpointSaved=capturePosition(true)===true;
  clearTimeout(saveTimer);clearTimeout(seenTimer);
}
function resumeReading(){
  if(document.hidden||!readerSuspended)return;
  readerSuspended=false;checkpointSaved=false;
  if(deferredReadingReflowEpoch===renderEpoch&&current&&!isComic(current)&&!$('#reader').hidden&&!suppressScroll){
    const p=state.positions[current.id];
    if(p?.chapter===chapter&&p.paragraph===paragraph){
      restorePosition(p);
      if(!ribbonManual)deferredReadingTranslationEpoch=renderEpoch;
    }
  }
  deferredReadingReflowEpoch=-1;
  resumeReadingTranslation();scheduleSeen();
}
function deferHiddenReadingReflow(epoch){
  if(!readerSuspended&&!document.hidden)return false;
  deferredReadingReflowEpoch=epoch;return true;
}
function activateScrolledParagraph(i,quiet){
  setActiveParagraph(i,!quiet);
  if(quiet)deferredReadingTranslationEpoch=renderEpoch;
}
function resumeReadingTranslation(){
  if(document.hidden||deferredReadingTranslationEpoch!==renderEpoch||$('#reader').hidden)return;
  deferredReadingTranslationEpoch=-1;syncTranslation();
}
function markReadingScrollAnchor(dirty=false){readingScrollAnchor={epoch:renderEpoch,top:$('#reading-scroll').scrollTop,dirty}}
function readingScrollParagraph(sc){
    const max=sc.scrollHeight-sc.clientHeight,atEnd=max>0&&max-sc.scrollTop<2;
    const anchor=sc.getBoundingClientRect().top+(atEnd?Math.min(220,sc.clientHeight*.45):65),rows=illustratedRows||$('#passage').children;
    // Scrolling generally stays in the current row. Read live geometry (no height
    // cache invalidation on font, width or hydration), then binary-search only on a jump.
    const top=i=>rows[i].getBoundingClientRect().top;
    let low=0,high=rows.length-1,found=0;
    if(rows[paragraph]&&top(paragraph)<=anchor){
      found=paragraph;
      if(paragraph===high||top(paragraph+1)>anchor)high=-1;
      else{found=paragraph+1;low=paragraph+2}
    }else high=paragraph-1;
    while(low<=high){const middle=(low+high)>>>1;if(top(middle)<=anchor){found=middle;low=middle+1}else high=middle-1}
  return found;
}
function onReadingScroll(){
  clearTimeout(seenTimer);if(readerSuspended||suppressScroll||!current||bookSpeech.playing)return;
  if(isComic(current)){clearTimeout(saveTimer);saveTimer=setTimeout(capturePosition,180);return}
  if(pendingReadingScroll?.epoch===renderEpoch)return;
  // A lifecycle save can run before RAF; resolve the same live anchor exactly once.
  const pending=pendingReadingScroll={epoch:renderEpoch,flush(quiet=false){
    if(pendingReadingScroll!==pending)return;
    pendingReadingScroll=null;
    if(pending.epoch!==renderEpoch||$('#reader').hidden||suppressScroll||bookSpeech.playing)return;
    const sc=$('#reading-scroll');
    if(readingScrollAnchor?.epoch===renderEpoch&&Math.abs(sc.scrollTop-readingScrollAnchor.top)<=1){
      if(!readerSuspended)scheduleSeen();return;
    }
    const found=readingScrollParagraph(sc);
    if(found!==paragraph)activateScrolledParagraph(found,quiet);
    else{clearTimeout(saveTimer);saveTimer=setTimeout(capturePosition,180);scheduleSeen()}
    markReadingScrollAnchor(true);
  }};
  requestAnimationFrame(()=>pending.flush());
}
let ribbonBook=null,ribbonChapter=-1,ribbonHasPairs=false,currentSegment=null;
const localTranslator=createLocalTranslator(),localAuto=createAutoTranslationPreferences(()=>localStorage);
let localTimer=0,localWanted=null,localJob=null,localFailure=null,localDialogTarget=null,localDialogProbe=null,paintingLocalSegment=null;
let localPageAway=false,localResumeQueued=false;
let localDownload={loaded:0,total:0};
const localNotStored=new Set();
let lastLocalCacheProbe=null,localRibbonProbe=null,localRibbonTimer=0;
let wordContextTranslation=null;
const localTarget=(book,ci,pi)=>{
  const p=book?.chapters[ci]?.paragraphs[pi];
  return p&&{book,ci,pi,p,source:sourceLanguage(p.text,readingSourceLanguage(book,ci)),target:state.prefs.dictionaryTarget};
};
const currentLocalTarget=()=>localTarget(current,chapter,paragraph);
const sameLocalPair=(a,b)=>!!a&&!!b&&a.book===b.book&&a.source===b.source&&a.target===b.target;
const sameLocal=(a,b)=>sameLocalPair(a,b)&&a.ci===b.ci&&a.pi===b.pi&&a.p===b.p;
const localFailureFor=loc=>sameLocalPair(localFailure,loc)&&
  (!['length','empty'].includes(localFailure.reason)||sameLocal(localFailure,loc))?localFailure:null;
const autoLocal=loc=>localAuto.has(loc.book,loc.source,loc.target);
function setAutoLocal(loc,enabled){
  if(!localAuto.set(loc.book,loc.source,loc.target,enabled))toast('Браузер не сохранил настройку автоперевода.');
}
const canLocal=loc=>!!loc&&localTranslator.capabilities()&&supportsTranslation(loc.source,loc.target);
const canProbeLocalCache=loc=>!!db&&loc.book.id!==DEMO_ID&&!isComic(loc.book);
const peekLocal=loc=>loc&&supportsTranslation(loc.source,loc.target)?localTranslator.peek(loc.p.text,{source:loc.source,target:loc.target}):null;
function refreshWordContextTranslation(loc){
  const context=wordContextTranslation;
  // Keep the nested dialog's opener until the browser has returned focus.
  if(!context||!sameLocal(context.loc,loc)||$('#translation-dialog').open)return;
  const value=peekLocal(loc);if(value)context.refresh(value);
}
const localErrorMessages={
  length:'Этот абзац слишком длинный для локального перевода.',
  'not-installed':'Модель не найдена на устройстве. Скачайте её ещё раз.',
  unsupported:'Локальный перевод недоступен в этом браузере.',
  'download-auth':'Folio потерял доступ к модели. Обновите страницу и войдите снова, если потребуется.',
  'download-network':'Загрузка модели прервалась. Проверьте интернет и нажмите «Повторить».',
  'download-timeout':'Модель не успела скачаться. Можно продолжить загрузку.',
  'download-http':'Сайт не отдал файл модели. Попробуйте ещё раз.',
  'download-integrity':'Файл модели скачался с ошибкой. Попробуйте ещё раз.',
  'engine-init':'Не удалось запустить переводчик. Обновите браузер или попробуйте другой.',
};
const localErrorText=reason=>localErrorMessages[reason]||'Не удалось перевести этот абзац. Попробуйте ещё раз.';
function cancelLocalQueue({abortAutomatic=false}={}){
  clearTimeout(localTimer);localWanted=null;
  // Automatic work belongs to the visible book. A reader's explicit request
  // can still finish, while a stale automatic worker must release the slot.
  if(abortAutomatic){
    cancelSavedRibbonProbe();
    if(localJob&&!localJob.explicit)stopLocalJob();
  }
}
const localWorkPaused=()=>localPageAway||document.hidden;
function stopLocalJob(){
  localJob=null;localDownload={loaded:0,total:0};
  localTranslator.stop();
}
function suspendLocalWork(leaving=false){
  cancelSavedRibbonProbe();
  if(leaving||!localWanted?.explicit)cancelLocalQueue();
  // An already requested download may continue during a brief tab switch.
  // Background automatic work, and all work on pagehide, is released.
  if(!leaving&&(!localJob||localJob.explicit))return;
  stopLocalJob();
}
function resumeLocalWork(){
  if(localResumeQueued)return;
  localResumeQueued=true;
  // Let the reading checkpoint/layout listeners select the latest paragraph first.
  queueMicrotask(()=>{
    localResumeQueued=false;
    if(localWorkPaused()||$('#reader').hidden||!current||isComic(current))return;
    if(!ribbonManual)syncTranslation();
    if(localDialogTarget)paintLocalDialog(localDialogTarget);
    if(localWanted?.explicit)void pumpLocal();
  });
}
function paintLocalRibbon(loc,target){
  const open=$('#local-translation-open'),sync=$('#sync-translation'),track=$('#translation-track');
  const show=!loc.p.translation&&canLocal(loc),value=!loc.p.translation?peekLocal(loc):null;
  const enabled=show&&autoLocal(loc),failure=localFailureFor(loc);
  open.hidden=!show;open.textContent=enabled&&!failure?'Пауза':failure?'Повторить':value?'Продолжить':'Перевести';
  open.setAttribute('aria-label',enabled&&!failure?'Приостановить автоперевод':value&&!failure?'Продолжить автоперевод':'Локальный перевод абзаца');
  if(paintingLocalSegment&&(paintingLocalSegment.parentElement!==target||!value)){
    paintingLocalSegment.textContent='[У этого абзаца нет перевода]';paintingLocalSegment.removeAttribute('lang');paintingLocalSegment=null;
  }
  if(value&&target){
    paintingLocalSegment=target.querySelector('.translation-copy');
    paintingLocalSegment.textContent=value;paintingLocalSegment.lang=loc.target;
  }
  if(!target&&!track.querySelector('.translation-segment')){
    const empty=track.querySelector('.translation-empty');
    if(empty){
      empty.textContent=value||((enabled&&!failure)?'Переводим на устройстве…':'Нет готового перевода.');
      empty.classList.toggle('machine-line',!!value);
      if(value)empty.lang=loc.target;else empty.removeAttribute('lang');
    }
    track.toggleAttribute('data-readable',!!value);
    sync.disabled=!value;
    $('#translation-ribbon').setAttribute('aria-label',value?'Строка машинного перевода':'Перевод отсутствует');
  }
  if(value)$('#ribbon-label').textContent='МАШИННЫЙ · '+loc.target.toUpperCase()+' · АБЗАЦ '+(loc.pi+1);
  return value;
}
function cancelSavedRibbonProbe(){
  clearTimeout(localRibbonTimer);localRibbonProbe=null;
}
function queueSavedRibbonProbe(loc){
  if(sameLocal(localRibbonProbe,loc))return;
  cancelSavedRibbonProbe();
  const probe=localRibbonProbe=loc;
  const stillHere=()=>localRibbonProbe===probe&&!ribbonManual&&!localWorkPaused()&&!$('#reader').hidden&&
    sameLocal(currentLocalTarget(),probe)&&!sameLocal(localJob,probe)&&!sameLocal(localWanted,probe);
  // Showing a persisted result is a read-only action. Debounce active-row
  // changes, and never let a stale answer move the ribbon after navigation.
  localRibbonTimer=setTimeout(async()=>{
    if(!stillHere())return;
    const saved=await savedLocalTranslation(probe,stillHere);
    if(!saved||!stillHere())return;
    localTranslator.prime(probe.p.text,saved,{source:probe.source,target:probe.target});
    syncTranslation();
  },160);
}
async function savedLocalTranslation(loc,stillHere){
  try{
    const entry=await prepareParagraphCache(db,loc,translationRevision(loc.source,loc.target),{createGeneration:false});
    return entry&&stillHere()?await readParagraphCache(db,entry,loc.book):null;
  }catch{return null} // A storage error is equivalent to an unavailable cached result.
}
async function loadSavedDialogTranslation(probe){
  const {source,target}=probe;
  const saved=await savedLocalTranslation(probe,()=>localDialogProbe===probe);
  if(localDialogProbe!==probe)return;
  localDialogProbe=null;
  if(!$('#translation-dialog').open||!sameLocal(localDialogTarget,probe)||!books.includes(probe.book))return;
  if(saved)localTranslator.prime(probe.p.text,saved,{source,target});
  paintLocalDialog(probe);
  if(saved&&sameLocal(probe,currentLocalTarget())&&!localWorkPaused()&&!ribbonManual)syncTranslation();
}
function openLocalDialog(loc){
  if(!loc)return;
  localDialogTarget=loc;localDialogProbe=null;
  const dialog=$('#translation-dialog');
  if(!loc.p.translation&&!peekLocal(loc)&&supportsTranslation(loc.source,loc.target)&&canProbeLocalCache(loc)&&!sameLocal(localJob,loc)&&!sameLocal(localWanted,loc)){
    // Viewing a past result is not consent to resume inference or download a model.
    localDialogProbe={...loc};void loadSavedDialogTranslation(localDialogProbe);
  }
  if(!dialog.open)dialog.showModal();
  paintLocalDialog(loc);
}
let localDialogPaint=0;
function paintLocalDialog(loc){
  const dialog=$('#translation-dialog');
  if(!sameLocal(localDialogTarget,loc)||!dialog.open)return;
  const paint=++localDialogPaint;
  const wrap=$('#translation-result'),status=$('#local-translation-status'),bar=$('#local-translation-progress'),button=$('#local-translation-start');
  const value=!loc.p.translation?peekLocal(loc):null,checking=sameLocal(localDialogProbe,loc);
  const original=$('#translation-original'),lang=readingSourceLanguage(loc.book,loc.ci)||'';
  if(original.textContent!==loc.p.text)original.textContent=loc.p.text;
  if(original.lang!==lang)original.lang=lang;
  const focused=document.activeElement;
  const focusResult=(focused===button&&!lastPointerInput)||
    (!!focused&&focused.parentElement===wrap&&focused.classList.contains('machine-result'));
  const setWaiting=waiting=>{
    // Keep a keyboard user's place; the handler rejects further activation.
    if(waiting)button.setAttribute('aria-disabled','true');else button.removeAttribute('aria-disabled');
  };
  wrap.replaceChildren();
  $('#local-translation-section').hidden=!!loc.p.translation||!!value||(!checking&&!canLocal(loc));
  if(loc.p.translation){
    const p=node('p',loc.p.translation);p.lang=loc.book.translationLanguage||'';p.dir='auto';wrap.append(p);
    if(loc.book.alignment==='positional-unverified')wrap.append(node('p','Сопоставление по порядку, не по смыслу.','muted'));
    return;
  }
  if(value){
    const p=node('p',value,'machine-result');p.lang=loc.target;p.dir='auto';
    wrap.append(node('p','Машинный перевод · '+loc.target.toUpperCase(),'machine-source'),p);
    if(localNotStored.has(pairCode(loc.source,loc.target)))wrap.append(node('p','Модель не сохранилась целиком. После перезапуска может понадобиться интернет.','muted'));
    if(focusResult&&!document.hidden&&!dialog.hasAttribute('data-sheet-exiting')){
      p.tabIndex=-1;p.focus({preventScroll:true});
    }
    return;
  }
  if(checking){status.textContent='Ищем сохранённый перевод…';button.textContent='Подождите…';setWaiting(true);bar.hidden=true;return}
  if(!canLocal(loc)){wrap.append(node('p',localTranslator.capabilities()?(loc.source===loc.target?'Оригинал уже на выбранном языке.':loc.source==='und'?'Язык оригинала не определён.':'Нет локальной модели для '+pairCode(loc.source,loc.target)+'.'):'Локальный перевод недоступен в этом браузере.','muted'));return}
  const busy=sameLocal(localJob,loc)||sameLocal(localWanted,loc);
  setWaiting(busy);bar.hidden=!busy||!localDownload.total||localDownload.loaded>=localDownload.total;
  bar.max=localDownload.total||1;bar.value=localDownload.loaded;
  const failure=localFailureFor(loc)?.reason||'';
  status.textContent=busy?(bar.hidden?'Переводим на устройстве…':'Скачиваем модель…'):failure?localErrorText(failure):pairCode(loc.source,loc.target)+'. '+(!knownLanguage(readingSourceLanguage(loc.book,loc.ci))?'Язык оригинала взят из настроек. ':'')+'Текст остаётся на устройстве. При первом запуске также загрузится движок.';
  button.textContent=busy?'Переводим…':failure?'Повторить':'Скачать модель · '+formatBytes(translationPack(loc.source,loc.target).downloadBytes);
  if(!busy&&!failure)void localTranslator.modelStorage({source:loc.source,target:loc.target}).then(info=>{
    if(paint===localDialogPaint&&dialog.open&&!$('#local-translation-section').hidden)button.textContent=modelDownloadLabel(info);
  });
}
function queueLocal(loc,{explicit=false}={}){
  if(!loc||loc.p.translation||!canLocal(loc)||sameLocal(localJob,loc)||(!explicit&&localWorkPaused()))return;
  if(localWanted?.explicit&&!explicit)return;
  if(!explicit&&sameLocal(localWanted,loc))return;
  localWanted={...loc,explicit};
  clearTimeout(localTimer);localTimer=setTimeout(pumpLocal,explicit?0:260);
}
async function pumpLocal(){
  if(localJob||!localWanted||localWorkPaused())return;
  const job=localWanted;localWanted=null;
  if(!job.explicit&&!autoLocal(job))return;
  localJob=job;
  const pair={source:job.source,target:job.target};
  localDownload={loaded:0,total:0};paintLocalDialog(job);
  try{
    let entry,saved;
    if(canProbeLocalCache(job)){
      lastLocalCacheProbe=job;
      try{
        entry=await prepareParagraphCache(db,job,translationRevision(job.source,job.target));
        if(localJob!==job)return;
        saved=await readParagraphCache(db,entry,job.book);
      }catch{/* A storage error is only a cache miss, never a translation error. */}
    }
    if(localJob!==job||!books.includes(job.book))return;
    if(localWorkPaused()){
      if(job.explicit&&!localPageAway&&!localWanted)localWanted=job;
      return;
    }
    if(!job.explicit&&($('#reader').hidden||!sameLocal(job,currentLocalTarget())||!autoLocal(job)))return;
    if(saved)localTranslator.prime(job.p.text,saved,pair);
    else{
      if(!job.explicit&&localFailureFor(job))return;
      const value=await localTranslator.translate(job.p.text,{...pair,allowNetwork:job.explicit,onProgress:(loaded,total)=>{
        if(localJob!==job)return;
        localDownload={loaded,total};
        if(!localWorkPaused())paintLocalDialog(job);
      }});
      if(localJob!==job)return;
      // Pause stops automatic work, not saving a translation the reader explicitly requested.
      if(entry&&books.includes(job.book)&&(job.explicit||autoLocal(job)))void writeParagraphCache(db,entry,value).catch(()=>{});
    }
    if(job.explicit&&!saved){
      const key=pairCode(job.source,job.target);
      const stored=await localTranslator.installed({source:job.source,target:job.target});
      if(localJob!==job)return;
      if(stored)localNotStored.delete(key);else localNotStored.add(key);
    }
    if(sameLocalPair(localFailure,job))localFailure=null;
  }catch(e){
    if(localJob===job&&e.name!=='AbortError')localFailure={...job,reason:e.message};
  }finally{
    if(localJob===job){
      localJob=null;localDownload={loaded:0,total:0};
      if(!localWorkPaused()){
        paintLocalDialog(job);refreshWordContextTranslation(job);
        if(sameLocal(job,currentLocalTarget())&&!$('#reader').hidden&&!ribbonManual)syncTranslation();
        if(localWanted)void pumpLocal();
      }
    }
  }
}
$('#local-translation-open').onclick=()=>{
  const loc=currentLocalTarget();if(!loc||!canLocal(loc)||loc.p.translation)return;
  const failed=localFailureFor(loc);
  if(autoLocal(loc)&&!failed){
    setAutoLocal(loc,false);cancelLocalQueue({abortAutomatic:true});syncTranslation();
  }
  else if(!failed&&peekLocal(loc)){setAutoLocal(loc,true);syncTranslation()}
  else openLocalDialog(loc);
};
$('#local-translation-start').onclick=()=>{
  const loc=localDialogTarget;if(!loc||!canLocal(loc)||loc.p.translation||
    sameLocal(localDialogProbe,loc)||sameLocal(localJob,loc)||sameLocal(localWanted,loc))return;
  setAutoLocal(loc,true);
  if(sameLocalPair(localFailure,loc))localFailure=null;
  queueLocal(loc,{explicit:true});paintLocalDialog(loc);
  // The underlying control already pauses automatic work; reflect that
  // immediately if the reader closes the sheet while the manual job runs.
  if(!$('#reader').hidden&&!ribbonManual&&sameLocal(loc,currentLocalTarget()))syncTranslation();
};
$('#translation-dialog').addEventListener('close',()=>{
  if($('#translation-dialog').open)return;
  const loc=localDialogTarget;localDialogTarget=null;localDialogProbe=null;
  refreshWordContextTranslation(loc);
});
window.addEventListener('storage',e=>localAuto.refresh(e.key));
window.addEventListener('pagehide',()=>{localPageAway=true;suspendLocalWork(true)});
window.addEventListener('pageshow',()=>{localPageAway=false;resumeLocalWork()});
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspendLocalWork();else resumeLocalWork()});

function renderRibbon(){
  ribbonManual=false;
  if(ribbonBook===current&&ribbonChapter===chapter)return;
  // Paired translation content is immutable. A chapter is the same boundary
  // as the reading pane; never create thousands of DOM nodes for other pages.
  if(ribbonBook!==current)ribbonHasPairs=current.chapters.some(c=>c.paragraphs.some(p=>p.translation));
  ribbonBook=current;ribbonChapter=chapter;currentSegment=null;paintingLocalSegment=null;
  const track=$('#translation-track'),fragment=document.createDocumentFragment();
  if(ribbonHasPairs){
    current.chapters[chapter].paragraphs.forEach((p,pi)=>{
      const span=node('span',null,'translation-segment');span.id=`translation-${chapter}-${pi}`;span.dataset.chapter=chapter;span.dataset.paragraph=pi;span.lang=current.translationLanguage||'';
      if(pi===0)span.append(node('span',`${chapter+1} ·`,'separator'));
      // Isolate the translation direction without reversing the chapter prefix
      // or the horizontal track used by all book languages.
      const copy=node('bdi',p.translation||'[У этого абзаца нет перевода]','translation-copy');
      copy.dir='auto';span.append(copy);fragment.append(span)
    });
  }else fragment.append(node('span','Нет готового перевода.','translation-empty'));
  track.replaceChildren(fragment);track.toggleAttribute('data-readable',ribbonHasPairs);
  $('#sync-translation').disabled=!ribbonHasPairs;
  $('#translation-ribbon').setAttribute('aria-label',ribbonHasPairs?'Строка перевода главы, горизонтальная прокрутка':'Перевод отсутствует')
}
function syncTranslation(){
  ribbonManual=false;touchRibbon=null;renderRibbon();
  const target=document.getElementById(`translation-${chapter}-${paragraph}`),ribbon=$('#translation-ribbon');
  if(target!==currentSegment){currentSegment?.classList.remove('current');target?.classList.add('current');currentSegment=target}
  if(target){
    $('#ribbon-label').textContent=`ПЕРЕВОД · ${current.translationLanguage||'ПАРА ФАЙЛОВ'} · АБЗАЦ ${paragraph+1}${current.alignment==='positional-unverified'?' · СВЕРИТЬ':''}`
  }else ribbon.scrollLeft=0;
  const loc=currentLocalTarget();
  if(!loc||isComic(loc.book))return;
  if(!loc.p.translation)$('#ribbon-label').textContent='НЕТ ГОТОВОГО ПЕРЕВОДА';
  const cached=paintLocalRibbon(loc,target);
  if(target)ribbon.scrollLeft=target.offsetLeft-ribbon.offsetLeft-parseFloat(getComputedStyle($('#translation-track')).paddingLeft);
  programmaticRibbonLeft=ribbon.scrollLeft;
  $('#sync-translation').textContent='К абзацу ↻';
  const automatic=!loc.p.translation&&canLocal(loc)&&autoLocal(loc);
  if(automatic&&!cached&&
    (!localFailureFor(loc)||(canProbeLocalCache(loc)&&!sameLocal(lastLocalCacheProbe,loc))))queueLocal(loc);
  else if(localWanted&&!localWanted.explicit)cancelLocalQueue();
  if(!automatic&&!cached&&!loc.p.translation&&!localWorkPaused()&&supportsTranslation(loc.source,loc.target)&&canProbeLocalCache(loc))
    queueSavedRibbonProbe(loc);
  else cancelSavedRibbonProbe();
}
function markExploring(){if(ribbonManual)return;ribbonManual=true;cancelSavedRibbonProbe();$('#sync-translation').textContent='Вернуться ↻';$('#ribbon-label').textContent='ПРОСМОТР ПЕРЕВОДА'}
function switchChapter(next,{focus=false}={}){
  if(!current?.chapters[next])return;
  const comic=isComic(current);
  if(comic){dismissWord();capturePosition()}
  const layout=comic&&state.positions[current.id]?.comicLayout==='strip'?{comicLayout:'strip'}:{};
  chapter=next;paragraph=0;
  renderChapter({chapter,paragraph:0,fraction:0,...(comic?layout:{chapterTop:true})},{focus});saveState();
}
function updateBookmark(){const list=state.bookmarks[current.id]||[];const active=list.some(x=>x.chapter===chapter&&x.paragraph===paragraph);$('#reader-bookmark').setAttribute('aria-pressed',String(active));$('#reader-bookmark').setAttribute('aria-label',active?'Удалить закладку':'Сохранить закладку')}
function openReaderContents(){
  const dialog=$('#contents-dialog'),list=$('#chapter-list');
  const rows=document.createDocumentFragment();
  let active;
  current.chapters.forEach((c,i)=>{
    const b=node('button',(i+1)+'. '+c.title,'chapter-row'+(i===chapter?' active':''));
    if(i===chapter){b.setAttribute('aria-current','location');b.setAttribute('autofocus','');active=b}
    b.onclick=e=>{dialog.close();switchChapter(i,{focus:e.detail===0})};
    rows.append(b);
  });
  list.replaceChildren(rows);
  renderReaderBookmarks();
  dialog.showModal();
  if(!active)return;
  if(document.activeElement!==active)active.focus({preventScroll:true});
  // Move only the chapter list, not the heading, close handle or bookmarks.
  dialog.scrollTop=0;
  const row=active.getBoundingClientRect(),box=list.getBoundingClientRect();
  list.scrollTop+=row.top-box.top-(list.clientHeight-row.height)/2;
}
function renderReaderBookmarks(){
  const marks=$('#bookmarks-list'),tally=bookStats(learning,current.id);
  marks.replaceChildren();
  $('#reading-book-stats').textContent=`${wordCountText(tally.words)} · ${encounterText(tally.encounters)}`;
  const bookmarks=state.bookmarks[current.id]||[];
  if(!bookmarks.length){
    const hint=node('p','Сохраните абзац значком закладки.','muted');hint.tabIndex=-1;marks.append(hint);
  }
  bookmarks.forEach((p,index)=>{
    const row=node('div',null,'bookmark-row'),label=`${current.chapters[p.chapter]?.title||'Глава'} · абзац ${p.paragraph+1}`;
    const b=node('button',label,'chapter-row');
    b.onclick=event=>{
      capturePosition();chapter=p.chapter;paragraph=p.paragraph;$('#contents-dialog').close();
      const selected={...p};
      if(isComic(current)&&state.positions[current.id]?.comicLayout==='strip')selected.comicLayout='strip';
      else delete selected.comicLayout;
      renderChapter(selected,{bookmark:true,focus:event?.detail===0});
    };
    const del=node('button','×','icon-button');del.setAttribute('aria-label','Удалить закладку: '+label);
    del.onclick=()=>{
      const ownsFocus=document.activeElement===del;
      state.bookmarks[current.id]=(state.bookmarks[current.id]||[]).filter(mark=>bookmarkLocation(mark)!==bookmarkLocation(p));
      saveState();renderReaderBookmarks();updateBookmark();
      if(ownsFocus&&$('#contents-dialog').open){
        const remaining=marks.querySelectorAll('.bookmark-row .chapter-row');
        // A different tab may have removed additional bookmarks before save.
        (remaining[Math.min(index,remaining.length-1)]||marks.firstElementChild)?.focus({preventScroll:true});
      }
    };
    row.append(b,del);marks.append(row);
  });
}
function sourceLanguage(text,bookLanguage){return resolveLanguage(bookLanguage,state.prefs.readingLanguage,text)}
function trackingLanguage(token){
  const raw=readingSourceLanguage(current,chapter)||'und';
  if(knownLanguage(raw)||getWord(learning,token,raw))return raw;
  return sourceLanguage(token,raw);
}
async function loadLexicon(){
  if(lexicon||lexiconPending)return lexicon||lexiconPending;
  if(performance.now()<lexiconRetryAt)return null;
  // The browser remembers a failed module URL for the lifetime of the page.
  // Change only our local URL on retry and share one attempt across all lookups.
  const path=lexiconFailures?'./lexicon.js?retry='+lexiconFailures:'./lexicon.js';
  lexiconPending=import(path).then(mod=>lexicon=mod).catch(error=>{
    lexiconRetryAt=error instanceof TypeError?performance.now()+Math.min(3000,300*++lexiconFailures):Infinity;
    return null;
  }).finally(()=>{lexiconPending=null});
  return lexiconPending;
}
function showGloss(result,lang,target){
  const lookup=$('.word-lookup'),entry=result?.entries?.find(item=>item.translation?.trim()||item.definition?.trim());
  delete lookup.dataset.source;delete lookup.dataset.headword;lookup.lang=entry?.target||'ru';
  renderSenses(result,lang,target);
  if(!entry){lookup.textContent='В местных словарях значения нет.';return}
  if(entry.packTitle||entry.source)lookup.dataset.source=entry.source||entry.packTitle;
  if(result.headword)lookup.dataset.headword=result.headword;
  const meaning=(entry.translation?.trim()||entry.definition?.trim()||'').replace(/\s+/g,' ');
  if(meaning.length<=108){lookup.textContent=meaning;return}
  const end=meaning.lastIndexOf(' ',105);
  lookup.textContent=meaning.slice(0,end>65?end:105)+'…';
}
function selectedRecord(){return wordAnchor?getWord(learning,wordAnchor.token,wordAnchor.trackLanguage):null}
function wordSavedState(){
  const record=selectedRecord(),mini=$('#word-study-mini'),save=$('#word-save');
  mini.replaceChildren();
  save.disabled=!wordAnchor;
  save.setAttribute('aria-pressed',String(!!record));
  save.title=record?'Убрать из словаря':'Добавить в словарь';
  if(record)mini.append(stageBadge(record),node('span',encounterText(encounterCount(record))));
}
function syncWordMark(anchor,record){
  // The same learning key can appear in several hydrated tokens.
  const key=CSS.escape(anchor.button.dataset.word);
  for(const token of $$('#passage .word[data-word="'+key+'"]'))attachStage(token,record);
}
function toggleWordSaved(event){
  if(!wordAnchor||!$('#word-dialog').open)return;
  const a=wordAnchor,status=$('#word-save-status'),record=selectedRecord();
  if(!canWriteWords(true)){status.textContent='Словарь не изменён: эта вкладка не может его сохранить.';return}
  wordFlight.cancel();
  if(record){
    try{
      persistWordRows(packLearning(learning,{excludeKeys:new Set([record.key])}));
    }catch{
      status.textContent='Не удалось сохранить изменение.';
      toast('Не удалось убрать слово.');return;
    }
    a.undoRemove=detachWord(learning,a.token,a.trackLanguage);
    clearTimeout(learningTimer);learningDirty=false;
    try{mirrorLegacy()}catch{}
    syncWordMark(a,null);wordSavedState();status.textContent='Убрано из словаря.';
  }else{
    const next=a.undoRemove?a.undoRemove(learning):trackWord(learning,a.token,a.trackLanguage,Date.now());
    if(!next){status.textContent='Слово не добавлено.';toast('Не удалось добавить слово.');return}
    a.undoRemove=null;
    if(tokenInClip(a.button,readingClip()))noteLookup(next,a.location,Date.now());
    try{persistWordRows(packLearning(learning));wordSaved()}
    catch{a.undoRemove=detachWord(learning,a.token,a.trackLanguage);wordSavedState();status.textContent='Не удалось добавить слово. Словарь не изменён.';failedWordSave();return}
    syncWordMark(a,next);wordSavedState();status.textContent='Добавлено в словарь.';
    if(event.isTrusted&&event.detail>0)wordFlight.start(a.token,a.button.getBoundingClientRect(),$('#word-sheet-heading'));
  }
  $('#word-count').textContent=Object.keys(learning.words).length;
}
function resetWordContext(){
  wordContextTranslation=null;
  aiWordHint?.dispose();aiWordHint=null;
  const context=$('#word-context'),toggle=$('#word-context-toggle'),dialog=$('#word-dialog');
  context.hidden=true;context.replaceChildren();toggle.textContent='В контексте';toggle.setAttribute('aria-expanded','false');dialog.removeAttribute('data-expanded');
}
function toggleWordContext(event){
  const anchor=wordAnchor;if(!anchor)return;
  const context=$('#word-context'),toggle=$('#word-context-toggle'),dialog=$('#word-dialog');
  if(!context.hidden){resetWordContext();return}
  openWordContext(event);
}
function openWordContext(event){
  const anchor=wordAnchor;if(!anchor)return;
  const context=$('#word-context'),toggle=$('#word-context-toggle'),dialog=$('#word-dialog');
  if(!context.hidden)return;
  const {text,translation,token,offset,sourceLanguage:sourceLanguageTag,translatedLanguage,alignment}=anchor;
  const original=node('p',null,'word-original');original.dir='auto';
  if(sourceLanguageTag)original.lang=sourceLanguageTag;
  if(text.slice(offset,offset+token.length)===token){
    original.append(document.createTextNode(text.slice(0,offset)),node('mark',token),document.createTextNode(text.slice(offset+token.length)));
  }else original.textContent=text;
  context.replaceChildren(node('h3','Абзац оригинала'),original);
  if(translation){
    const translated=node('p',translation,'word-parallel');translated.dir='auto';
    if(translatedLanguage)translated.lang=translatedLanguage;
    context.append(node('h3','Перевод абзаца'),translated);
    if(alignment==='positional-unverified')context.append(node('p','Сопоставление по порядку, не по смыслу.','muted'));
    else context.append(node('p','Перевод всего абзаца.','muted'));
  }else{
    const loc=localTarget(current,anchor.location.chapter,anchor.location.paragraph),preview=node('div');
    context.append(preview);
    const stillHere=()=>wordAnchor===anchor&&dialog.open&&!context.hidden&&preview.isConnected&&
      !dialog.hasAttribute('data-sheet-exiting');
    let shown=null;
    const paint=local=>{
      preview.removeAttribute('aria-busy');
      if(shown&&(!local||shown===local))return;
      if(local){
        shown=local;const restoreFocus=preview.contains(document.activeElement);
        const translated=node('p',local,'word-parallel');translated.lang=loc.target;translated.dir='auto';
        preview.replaceChildren(node('h3','Машинный перевод · '+loc.target.toUpperCase()),translated);
        if(restoreFocus){translated.tabIndex=-1;translated.focus({preventScroll:true});}
      }else if(loc&&canLocal(loc)){
        const button=node('button','Перевести абзац','quiet');button.type='button';button.onclick=()=>openLocalDialog(loc);
        preview.replaceChildren(button);
      }else preview.replaceChildren(node('p','Для этого абзаца нет готового перевода.','muted'));
    };
    if(loc&&supportsTranslation(loc.source,loc.target))
      wordContextTranslation={loc,refresh:value=>{if(stillHere())paint(value)}};
    const local=loc&&peekLocal(loc);
    if(local)paint(local);
    else if(loc&&supportsTranslation(loc.source,loc.target)&&canProbeLocalCache(loc)){
      preview.setAttribute('aria-busy','true');preview.append(node('p','Ищем сохранённый перевод…','muted'));
      // Looking at context reads only local data, even with auto-translate off.
      void savedLocalTranslation(loc,stillHere).then(saved=>{if(stillHere())paint(saved||peekLocal(loc))});
    }else paint(null);
  }
  const source=$('.word-lookup').dataset.source;
  if(source)context.append(node('p','Словарь: '+source,'muted'));
  const connection=byokSession.snapshot(),provider=BYOK_PROVIDERS.find(p=>p.id===connection?.provider);
  if(provider&&connection.model){
    const language=sourceLanguage(token,sourceLanguageTag);
    aiWordHint=mountAiWordHint(context,{anchor,sourceLanguage:language,targetLanguage:state.prefs.dictionaryTarget,connection:{...connection,providerLabel:provider.label},
      request:(hint,options)=>requestAiWordHint(byokSession,connection,hint,options).finally(()=>byokSettings.refresh())});
  }
  context.hidden=false;dialog.setAttribute('data-expanded','');toggle.textContent='Свернуть контекст';toggle.setAttribute('aria-expanded','true');
  revealMotion(context,'panel',{enabled:!!event?.detail});
}
function dismissWord(){
  const dialog=$('#word-dialog');if(!dialog.open)return;
  wordFlight.cancel();wordAnchor=null;selectedWordSequence++;dialog.close();
}
async function showWord(button,event){
  const row=button.closest('[data-paragraph]'),pi=Number(row?.dataset.paragraph),c=current?.chapters[chapter],p=c?.paragraphs[pi];
  if(!p||$('#reader').hidden)return;
  actionFeedback(event,'word');
  wordFlight.cancel();$('#word-save-status').textContent='';
  const wordOrigin=button.getBoundingClientRect();
  // A lookup pauses the current paragraph without forgetting the narration
  // cursor. Selecting another paragraph still resets it in setActiveParagraph.
  wordSpeech.reset();bookSpeech.pause();wordSpeech.warm();
  const word=selectedWord=button.dataset.word,sequence=++selectedWordSequence,dialog=$('#word-dialog'),lookup=$('.word-lookup');
  const source=readingSourceLanguage(current,chapter),trackLanguage=trackingLanguage(button.textContent);
  wordAnchor={button,text:p.text,translation:p.translation,token:button.textContent,offset:Number(button.dataset.offset),trackLanguage,sourceLanguage:source,translatedLanguage:current.translationLanguage,alignment:current.alignment};
  wordAnchor.location={bookId:current.id,chapter,paragraph:pi,offset:wordAnchor.offset};
  $$('.word.selected').forEach(b=>b.classList.remove('selected'));button.classList.add('selected');
  const existed=getWord(learning,button.textContent,trackLanguage);
  const writable=canWriteWords(),record=existed||(writable&&state.prefs.autoSaveWords?trackWord(learning,button.textContent,trackLanguage,Date.now()):null);
  if(record&&writable){
    const changed=tokenInClip(button,readingClip())&&noteLookup(record,wordAnchor.location,Date.now());
    if(existed){if(changed)trackChanged();attachStage(button,record)}
    else{
      try{persistWordRows(packLearning(learning));wordSaved();syncWordMark(wordAnchor,record)}
      catch{removeWord(learning,wordAnchor.token,wordAnchor.trackLanguage);$('#word-save-status').textContent='Автосохранение не удалось. Слово не добавлено.';failedWordSave()}
    }
  }
  setActiveParagraph(pi,true);clearTimeout(seenTimer);resetWordContext();
  const heading=$('#word-sheet-heading');heading.textContent=button.textContent;heading.lang=source||'';heading.dir='auto';wordSavedState();
  $('#word-senses').hidden=true;$('#word-senses-toggle').setAttribute('aria-expanded','false');
  dictUI.hideHint();
  const language=sourceLanguage(word,source),target=state.prefs.dictionaryTarget;
  const base=fallbackGloss(word,language,target);
  if(base)showGloss(base,language,target);
  else{delete lookup.dataset.source;delete lookup.dataset.headword;renderSenses(null,language,target);lookup.textContent='Ищем в словарях…'}
  if(!dialog.open)dialog.showModal();
  if(record&&!existed){
    $('#word-save-status').textContent='Добавлено в словарь.';
    if(event?.isTrusted&&event.detail>0)wordFlight.start(button.textContent,wordOrigin,$('#word-sheet-heading'));
  }
  await refreshWordGloss(sequence);
}
async function refreshWordGloss(sequence=selectedWordSequence){
  if(!wordAnchor||!$('#word-dialog').open)return;
  const word=selectedWord,language=sourceLanguage(word,wordAnchor.sourceLanguage),target=state.prefs.dictionaryTarget;
  const stillHere=()=>sequence===selectedWordSequence&&$('#word-dialog').open;
  try{
    const result=await lookupStudy({word,language});
    if(!stillHere())return;
    showGloss(result,language,target);dictUI.controlsWord({seq:sequence,language,target,hasResult:targetHit(result?.entries,language,target)});
    if(!result&&!dictUI.installed.some(p=>p.language===language)&&!['en','ru'].includes(language))
      $('.word-lookup').textContent=language==='und'?'Язык слова не определён.':'Для языка '+language.toUpperCase()+' нет установленного словаря.';
  }catch(e){if(stillHere()){$('.word-lookup').textContent='Словарное хранилище недоступно.';renderSenses(null,language,target)}}
}
function cancelSpeech(){wordSpeech.reset();if(!followingBook)bookSpeech.stop()}
function sayWord(event){
  if(!wordAnchor||!$('#word-dialog').open)return;
  const {token,sourceLanguage:from}=wordAnchor;
  wordSpeech.speak({text:token,language:speechLanguage(from,sourceLanguage(token,from)),event});
}
function applyPrefs(){
  const p=state.prefs=sanitizePrefs(state.prefs),palette=accentPalette(p),style=document.documentElement.style;
  document.documentElement.dataset.theme=p.theme;
  $('meta[name="color-scheme"]').content=THEMES[p.theme].scheme;
  document.body.classList.toggle('night',p.theme==='night');document.body.classList.toggle('paper',p.theme==='paper');
  const bodyStyle=document.body.style;for(const [property,value] of [['--accent',palette.accent],['--on-accent',palette.onAccent],['--soft',palette.soft],['--focus',palette.focus],['--selection',palette.selection]])bodyStyle.setProperty(property,value);
  // Switch knobs are non-text indicators: white can stay on a vivid accent
  // where it misses the stronger text threshold, but not on a pale custom tint.
  document.body.style.setProperty('--switch-on-knob',contrast(palette.accent,'#ffffff')>=3?'#ffffff':'#141414');
  style.setProperty('--reading-size',p.size+'px');style.setProperty('--reading-font',readingFontStack(p.font));
  setChromeColor();
  for(const prefix of ['','profile-']){$('#'+(prefix?prefix+'size':'font-size')).value=p.size;$('#'+prefix+(prefix?'size-output':'font-output')).textContent=p.size+' px';$('#'+prefix+(prefix?'theme':'reading-theme')).value=p.theme;$('#'+prefix+(prefix?'font':'reading-font')).value=p.font}
  $('#reading-auto-save').checked=p.autoSaveWords;
  applyFeedbackPrefs();$('#custom-accent').value=p.accent;$('#accent-value').textContent=p.accent.toUpperCase();$$('.accent-swatch').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.accent===p.accent)));
}
function applyFeedbackPrefs(){
  const p=state.prefs, mode=tactileMode(), iphone=mode==='iphone-switch';
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const haptics=$('#pref-haptics'),on=p.haptics&&(!iphone||p.iphoneCheckHaptic);
  haptics.checked=mode!=='none'&&on;haptics.disabled=mode==='none';
  haptics.closest('label').querySelector('span').textContent=iphone?'Тактильный отклик «Проверить»':'Вибрация';
  $('#pref-haptic-note').textContent=mode==='none'?'Этот браузер не поддерживает вибрацию. Результат ответа всё равно появится на экране.':
    reduced?'Отклик приостановлен из-за настройки «Уменьшение движения».':
    iphone?'На iPhone возможен только короткий системный отклик: при касании этого переключателя или кнопки «Проверить» в серии. Зависит от настроек iOS.':
    'Короткая вибрация при ответах. Отклик зависит от настроек устройства.';
  for(const input of [$('#pref-sound'),$('#lesson-sound')]){input.checked=p.practiceSound;input.removeAttribute('switch')}
  haptics.toggleAttribute('switch',iphone&&!reduced);
  $('#pref-sound-test').disabled=!p.practiceSound;
  if(!p.practiceSound){practiceAudio.stop();$('#pref-sound-test-status').textContent=''}
  player.refreshContact();
}
let prefsLayoutEpoch=0;
function prefsChanged(change){
  capturePosition();
  const position=current&&!$('#reader').hidden?state.positions[current.id]:null;
  const oldFont=state.prefs.font;
  Object.assign(state.prefs,change);applyPrefs();saveState();
  if(!position||$('#passage').hasAttribute?.('aria-busy'))return; // The full chapter will restore using the new style.
  const layout=++prefsLayoutEpoch,epoch=renderEpoch,sc=$('#reading-scroll');
  const stillHere=()=>layout===prefsLayoutEpoch&&epoch===renderEpoch&&!$('#reader').hidden;
  const font=state.prefs.font;
  const face='400 1em "'+READING_FONTS[font].label+'"';
  const chars='Aa Әә Ғғ Ққ Ңң Өө Ұұ Үү Һһ Іі';
  // A slow cache miss can reflow the already-open chapter after the first frame.
  // Re-anchor only if the same paragraph is still on screen and has not scrolled.
  const late=font!==oldFont&&document.fonts?.load&&!document.fonts.check(face,chars)?document.fonts.load(face,chars).catch(()=>[]):null;
  const restore=()=>{
    restorePosition(position);
    // restorePosition recorded the programmatic offset; the next real swipe owns it.
    suppressScroll=false;
    if(!ribbonManual){
      if(readerSuspended||document.hidden)deferredReadingTranslationEpoch=epoch;
      else syncTranslation();
    }
    if(!readerSuspended)scheduleSeen();
  };
  suppressScroll=true;
  requestAnimationFrame(()=>{
    if(!stillHere())return;
    restore();
    const heldScroll=sc.scrollTop;
    requestAnimationFrame(()=>{
      if(!stillHere())return;
      late?.then(faces=>{
        if(!faces.length||!stillHere()||deferHiddenReadingReflow(epoch)||
          state.positions[current.id]!==position||paragraph!==position.paragraph||Math.abs(sc.scrollTop-heldScroll)>3)return;
        suppressScroll=true;restore();
      });
    });
  });
}
function renderProfileStats(total){$('#profile-book-count').textContent=books.filter(b=>!editorialKind(b.id)).length;$('#profile-word-count').textContent=total;$('#profile-mark-count').textContent=Object.values(state.bookmarks).reduce((n,m)=>n+(Array.isArray(m)?m.length:0),0);updateStorageStatus()}
function downloadText(text,type,name){downloadBlob(new Blob([text],{type}),name)}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
async function arrangeBackup(file){
  backupDraft=null;const sequence=++backupSequence,status=$('#backup-preview');$('#restore-backup').disabled=true;
  if(!file){status.textContent='Выберите файл копии Folio.';return}
  if(file.size>BACKUP_LIMIT){status.textContent='Копия больше 50 МБ. Восстановление такого файла не поддерживается.';return}
  try{
    const parsed=parseBackup(await file.text(),demo);if(sequence!==backupSequence)return;
    if(Object.hasOwn(parsed,'epubArt')){
      const {restoreEpubBackup}=await import('./epub-art-backup.js');
      if(sequence!==backupSequence)return;
      Object.assign(parsed,restoreEpubBackup(parsed.epubArt,parsed.books));delete parsed.epubArt;
    }
    backupDraft=parsed;
    const ids=new Set(books.map(b=>b.id)),fresh=backupDraft.books.filter(b=>!ids.has(b.id));
    const artCount=fresh.reduce((n,book)=>n+(parsed.assetsByBook?.get(book.id)?.length||0),0);
    status.textContent=`Книг: ${backupDraft.books.length}. Слов: ${backupDraft.words.length}. Новых книг: ${fresh.length}. ${artCount?'Иллюстраций в новых книгах: '+artCount+'. ':''}${!db&&fresh.length?'Хранилище книг недоступно.':''}`;
    $('#restore-backup').disabled=!db&&fresh.length>0;
  }catch(e){if(sequence===backupSequence)status.textContent=e.message}
}
async function restoreBackup(){
  if(!backupDraft||restoring)return;
  if(!canWriteWords(true)){$('#backup-preview').textContent='Восстановление не начато. Закройте другую вкладку Folio и перезагрузите страницу.';return}
  restoring=true;$('#restore-backup').disabled=true;$('#backup-file').disabled=true;
  const backup=backupDraft,ids=new Set(books.map(b=>b.id)),fresh=backup.books.filter(b=>!ids.has(b.id)).map(stampTextBook);
  try{
    if(fresh.length)await dbAction('readwrite',store=>{clearTextBookTranslations(store,fresh.map(b=>b.id));for(const b of fresh){putIllustrations(store,b.id,backup.assetsByBook?.get(b.id));store.add(b)}return store.count()});
    books.push(...fresh);
    const merged=mergeLearning(learning,loadLearning(backup.learning,backup.words));
    // The optional books transaction may already have committed; never imply a full rollback.
    try{persistWordRows(packLearning(merged))}
    catch{renderHomePanel();$('#backup-preview').textContent=fresh.length?'Книги добавлены, но словарь и настройки не восстановлены. Проверьте место и открытые вкладки.':'Словарь и настройки не изменены. Проверьте место и открытые вкладки.';$('#restore-backup').disabled=false;return}
    learning=merged;wordSaved();
    for(const b of books){
      if(!state.positions[b.id]&&backup.positions[b.id])state.positions[b.id]=backup.positions[b.id];
      const marks=Array.isArray(state.bookmarks[b.id])?state.bookmarks[b.id]:[],added=backup.bookmarks[b.id]||[];
      if(added.length)state.bookmarks[b.id]=[...new Map([...added,...marks].map(p=>[`${p.chapter}/${p.paragraph}`,p])).values()];
    }
    // A fresh reader can continue the restored book immediately. In a
    // merged library the currently selected local book keeps its priority.
    if(ids.size===1&&ids.has(DEMO_ID)&&state.lastBook===DEMO_ID&&fresh.some(b=>b.id===backup.lastBook))
      state.lastBook=backup.lastBook;
    if($('#backup-prefs').checked){const {theme,accent,font,size}=backup.prefs;Object.assign(state.prefs,{theme,accent,font,size});applyPrefs()}
    const savedOK=saveState();renderHomePanel();$('#backup-dialog').close();
    toast(savedOK?'Копия восстановлена.':'Данные добавлены, но настройки и слова могут не сохраниться.');
  }catch(e){$('#backup-preview').textContent='Не удалось завершить восстановление. Перед повтором проверьте библиотеку. '+(e.name==='QuotaExceededError'?'Недостаточно места.':'Проверьте хранилище браузера.');$('#restore-backup').disabled=false}
  finally{restoring=false;$('#backup-file').disabled=false}
}
let languageUI=null;
function saveLanguagePrefs(patch){
  const changed=patch.readingLanguage&&patch.readingLanguage!==state.prefs.readingLanguage||patch.dictionaryTarget&&patch.dictionaryTarget!==state.prefs.dictionaryTarget;
  if(changed){
    if(!Object.hasOwn(patch,'languageSetup'))patch.languageSetup='done';
    if(!Object.hasOwn(patch,'dictionaryPack'))patch.dictionaryPack='';
    localFailure=null;cancelLocalQueue();
  }
  Object.assign(state.prefs,patch);saveState();
  if(changed){dictUI.selectPair(state.prefs.readingLanguage,state.prefs.dictionaryTarget);languageUI?.sync()}
}
const dictUI=dictionaryControls({
  load:loadLexicon,getPrefs:()=>state.prefs,
  changePrefs:saveLanguagePrefs,onSources:()=>languageUI?.refresh(),
  onChange:()=>{if($('#word-dialog').open)void refreshWordGloss();if(!$('#words-view').hidden)renderWords()}
});
window.addEventListener('online',async()=>{
  if(lexicon)return;
  await lexiconPending;
  if(lexicon||!lexiconFailures||!Number.isFinite(lexiconRetryAt)||document.hidden)return;
  const visible=$('#word-dialog').open||(!$('#home').hidden&&['profile','words'].includes(homeView));
  if(visible){lexiconRetryAt=0;void dictUI.refresh({repaintWord:true})}
});
async function importDictionaryFile(){
  const input=$('#dict-file'),file=input.files[0];if(!file){dictUI.status('Выберите файл словаря.');return}
  if(dictUI.busy||importingDictionary)return;importingDictionary=true;$('#dictionary-import').disabled=true;dictUI.status('Читаем словарь…');
  try{const mod=await loadLexicon();if(!mod)throw new Error('Импорт словарей недоступен.');if(file.size>BACKUP_LIMIT)throw new Error('Файл словаря больше 50 МБ.');
    const opts={language:$('#dict-source-language').value,target:$('#dict-target-language').value,name:file.name.replace(/\.[^.]+$/,'')};
    const pack=/\.zip$/i.test(file.name)?await mod.importStarDictZip(await file.arrayBuffer(),opts):/\.(tei|xml)$/i.test(file.name)?await mod.importFreeDictTei(await file.text(),opts):await mod.importDictionaryTsv(await file.text(),opts);
    input.value='';dictUI.status('Словарь добавлен в общий поиск: '+pack.count.toLocaleString('ru-RU')+' статей.');
  }catch(e){dictUI.status(e.message||'Не удалось импортировать словарь.')}
  finally{importingDictionary=false;await dictUI.refresh({repaintWord:true})}
}
// A platform picker replaces FileList before validation. The accepted File
// remains authoritative so a rejected replacement cannot invalidate work.
const dropMotions=new Map(),acceptedImportFiles=new Map();
function fileTile(input,{dropped=false,animate=true}={}){
  const label=input.closest('.drop-field'),file=acceptedImportFiles.get(input),type=label.dataset.fileField,fx=dropMotions.get(input);
  label.toggleAttribute('data-filled',!!file);
  const name=file?.name||(type==='original'?'Перетащите книгу или снимок':'Файл той же книги');
  fx?.setText(name,animate);
  label.querySelector('.file-pick').textContent=file?'Заменить':'Выбрать';
  if(file)fx?.land(file,dropped);else fx?.reset();
}
function setBookTiles(kind){
  for(const [input,fx] of dropMotions)if(acceptedImportFiles.has(input))fx.state(kind);
}
function importStatus(text,state=''){
  const status=$('#import-status');status.textContent=text;if(state)status.dataset.state=state;else delete status.dataset.state;
}
let importJob=null;
const importRoles=['original','translation'];
const ocrLanguageChoices=[['eng','Английский'],['rus','Русский'],['kaz','Казахский'],['eng+rus','EN + RU'],['rus+kaz','RU + KK'],['eng+kaz','EN + KK'],['eng+rus+kaz','EN + RU + KK']];
const isPdf=file=>/\.pdf$/i.test(file?.name||'');
const isImage=file=>/\.(?:png|jpe?g|webp)$/i.test(file?.name||'');
const getFile=role=>acceptedImportFiles.get($('#'+role+'-file'));
const ocrRecovery=new Set(), parsedImport=new Map();
const preferredOcr=role=>[({en:'eng',ru:'rus',kk:'kaz'})[knownLanguage(role==='original'?state.prefs.readingLanguage:state.prefs.dictionaryTarget)]||(role==='original'?'eng':'rus')];
for(const role of importRoles){
  const select=$('#ocr-'+role),automatic=node('option','Автоматически');automatic.value='';select.append(automatic);
  for(const [code,label] of ocrLanguageChoices){const option=node('option',label);option.value=code;select.append(option)}
}
const importParseKey=(role,preferred=preferredOcr(role))=>[$('#ocr-'+role).value,ocrRecovery.has(role)?'thorough':'auto',...preferred].join(':');
function syncOcrControls(){
  $('#remove-translation-file').hidden=!getFile('translation');
  const hasSettings=role=>isImage(getFile(role))||(isPdf(getFile(role))&&ocrRecovery.has(role));
  const panel=$('#ocr-panel');
  panel.hidden=!importRoles.some(hasSettings);
  if(panel.hidden)panel.open=false;
  $('#ocr-pdf-limit').hidden=!importRoles.some(role=>isPdf(getFile(role))&&ocrRecovery.has(role));
  for(const role of importRoles)$('#ocr-'+role+'-field').hidden=!hasSettings(role);
}
function resetOcrSettings(role){
  if(!role)$('#ocr-panel').open=false;
  for(const item of role?[role]:importRoles){
    ocrRecovery.delete(item);parsedImport.delete(item);$('#ocr-'+item).value='';
  }
}
function finishImportJob(){
  importJob=null;$('#preview-import').disabled=false;$('#cancel-import').hidden=true;
  $('#import-progress').hidden=true;$('#import-preview').removeAttribute('aria-busy');
}
function invalidateImport(){
  importSequence++;importJob?.abort();finishImportJob();previewBook=null;
  $('#import-preview').hidden=true;$('#import-confirm').hidden=true;$('#retry-ocr').hidden=true;
  $('#alignment-check').checked=false;$('#import-file-warning').textContent='';importStatus('');syncOcrControls();
}
function cancelImport(){
  if(!importJob)return;
  invalidateImport();setBookTiles('selected');importStatus('Отменено. Книга не добавлена.');$('#preview-import').focus({preventScroll:true});
}
function showImportProgress(role,update){
  const {stage,page,total,progress}=update;
  const label=({text:'Извлекаем текст',render:'Готовим изображение',load:'Загружаем модель для распознавания на устройстве',recognize:'Распознаём текст'})[stage]||'Читаем файл';
  const pageLabel=Number.isInteger(page)&&page>0?' · стр. '+page+(Number.isInteger(total)&&total>0?' из '+total:''):'';
  const bar=$('#import-progress');bar.hidden=false;
  const p=Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):null;
  if(stage==='text'&&page>0&&total>0)bar.value=(page-1)/total;
  else if(p===null||stage==='render'||(stage==='load'&&p===0))bar.removeAttribute('value');
  else bar.value=p;
  const percentage=stage==='recognize'&&p!==null?' · '+(Math.floor(p*10)*10)+'%':'';
  const status=(role==='original'?'Оригинал':'Перевод')+': '+label.toLocaleLowerCase('ru')+pageLabel+percentage;
  if($('#import-status').textContent!==status)importStatus(status,'loading');
}
function appendOcrReview(box,parsed,role){
  const pages=parsed?.ocr?.pages;if(!Array.isArray(pages)||!pages.length)return;
  const available=pages.map(page=>({page,chapter:parsed.chapters.find(c=>c.title==='Страница '+page)})).filter(x=>x.chapter?.paragraphs?.length);
  if(!available.length)return;
  const review=node('section',null,'ocr-review'),uncertain=new Set(parsed.ocr.uncertain||[]),select=node('select'),sample=node('p');
  review.append(node('h4',role==='original'?'Распознанный оригинал':'Распознанный перевод'),node('p','Сверьте текст с изображением. Распознавание может перепутать буквы, цифры и порядок строк.','muted'));
  const label=node('label','Образец со страницы');label.append(select);review.append(label,sample);
  for(const {page} of available){const option=node('option','Страница '+page+(uncertain.has(page)?' · проверьте внимательно':''));option.value=String(page);select.append(option)}
  if(available.some(({page})=>uncertain.has(page)))select.value=String(available.find(({page})=>uncertain.has(page)).page);
  const draw=()=>{
    const {page,chapter}=available.find(({page})=>String(page)===select.value)||available[0];
    const excerpt=parsed.ocr.samples?.find(s=>s.page===page)?.text;
    if(typeof excerpt==='string'&&excerpt.trim()){sample.textContent=excerpt;return}
    const texts=chapter.paragraphs,clipped=texts.slice(0,5).map(x=>x.slice(0,700)).join('\n\n');
    sample.textContent=clipped.slice(0,1100)+(clipped.length>1100||texts.length>5||texts.slice(0,5).some(s=>s.length>700)?'…':'');
  };
  select.onchange=draw;draw();box.append(review);
}
function renderImportPreview(a,b,event,{originalLanguage}={}){
  previewBook=b?pairBooks(a,b):singleBook(a);
  const box=$('#import-preview'),unit=['PDF','PNG','JPEG','WEBP'].includes(a.format)?'Страниц':'Глав';
  const excerpts={language:[],translationLanguage:[]};
  const previewText=(tag,text,field,cls)=>{
    const el=node(tag,text,cls);el.dir='auto';
    el.lang=previewBook[field]||'und';excerpts[field].push(el);
    return el;
  };
  box.replaceChildren(previewText('h3',previewBook.title,'language'),node('p',`${previewBook.author||'Автор не указан'} · ${unit}: ${previewBook.chapters.length} · Абзацев: ${totalParagraphs(previewBook)}`,'muted'));
  for(const [field,label,choice,parsed] of [['language','Язык оригинала',state.prefs.readingLanguage,a],['translationLanguage','Язык парного файла',state.prefs.dictionaryTarget,b]]){
    if(!parsed)continue;
    const tag=parsed.language,known=knownLanguage(tag),choices=field==='language'?importSourceLanguages:languages;
    if(known){box.append(node('p',label+': '+(choices[known]||tag),'muted'));continue}
    const select=node('select'),wrapper=node('label',label+' (не указан в файле)','field');
    const inferred=resolveLanguage(tag,choice,parsed.chapters[0]?.paragraphs[0]||'');
    const selected=field==='language'&&originalLanguage!==undefined?originalLanguage:inferred;
    fillLanguages(select,Object.hasOwn(choices,selected)?selected:'',{unknown:true,choices});
    const book=previewBook;const commit=()=>{
      book[field]=select.value||tag||'und';
      for(const excerpt of excerpts[field])excerpt.lang=book[field];
    };
    select.onchange=commit;commit();wrapper.append(select);box.append(wrapper);
  }
  const warnings=[...new Set([...(a.warnings||[]),...(b?.warnings||[])])];
  if(b){
    const r=previewBook.alignmentReport,method=r.pdfPagesMatch===true?'По номерам страниц':'По порядку';
    warnings.unshift(`${method} сопоставлено ${r.matchedCount} из ${r.originalCount} абзацев оригинала. Без пары: ${r.unmatchedOriginal} в оригинале, ${r.unmatchedTranslation} в переводе. Смысл не проверен.`);
    if(r.pdfPagesMatch===false)warnings.unshift('У PDF разное число страниц. Файлы не сопоставлены. Выберите файлы одного издания.');
    else if(!r.paragraphCountsMatch||!r.chapterCountsMatch)warnings.unshift(r.pdfPagesMatch===true
      ?'Страницы без текста или с разным числом абзацев остались без пары.'
      :'Структуры файлов различаются. Несовпавшие главы останутся без перевода.');
  }
  else warnings.unshift('Готовый перевод не добавлен.');
  warnings.forEach(w=>box.append(node('p',w,'warning')));
  if(a.epubImages?.length)box.append(node('p','Встроенных изображений: '+a.epubImages.length+' · Хранятся на этом устройстве.','muted'));
  for(const [role,parsed] of [['original',a],['translation',b]]){
    if(!parsed||!['PDF','PNG','JPEG','WEBP'].includes(parsed.format))continue;
    const suffix=b?' ('+(role==='original'?'оригинал':'перевод')+')':'';
    const change=node('button',(parsed.format==='PDF'?'Дополнительное распознавание':'Изменить язык распознавания')+suffix+'…','quiet');
    change.type='button';change.onclick=()=>setupOcr(role);box.append(change);
  }
  appendOcrReview(box,a,'original');appendOcrReview(box,b,'translation');
  // Do not allocate a copy of a whole book to show three examples.
  if(b||!a.ocr?.pages?.length){let shown=0;outer:for(const [ci,c] of previewBook.chapters.entries())for(const [pi,p] of c.paragraphs.entries()){
    const div=node('div',null,'preview-pair'),where=['PDF','PNG','JPEG','WEBP'].includes(a.format)?c.title:'Глава '+(ci+1);
    // A paired import can mix directions without changing the Russian labels.
    div.append(node('small',where+', абзац '+(pi+1)),previewText('p',p.text.slice(0,600),'language'));
    if(b)div.append(p.translation?previewText('p',p.translation.slice(0,600),'translationLanguage','translation-preview'):
      node('p','Нет сопоставленного перевода','translation-preview'));
    box.append(div);if(++shown>=3)break outer;
  }}
  box.hidden=false;$('#import-confirm').hidden=false;$('#import-confirm .check-field').hidden=!b;$('#save-import').disabled=!!b;
  importStatus('Проверьте предпросмотр.','ready');setBookTiles('ready');revealMotion(box,'panel',{enabled:!!event?.detail});
}
$('#remove-translation-file').onclick=event=>{
  const input=$('#translation-file');
  if(!acceptedImportFiles.has(input)||$('#import-dialog').hasAttribute('data-saving'))return;
  const original=getFile('original'),cached=parsedImport.get('original'),originalLanguage=previewBook?.language;
  input.value='';acceptedImportFiles.delete(input);fileTile(input,{animate:false});resetOcrSettings('translation');invalidateImport();
  if(cached?.file===original&&cached?.key===importParseKey('original')){
    renderImportPreview(cached.parsed,null,event,{originalLanguage});
    importStatus('Файл перевода убран. Проверьте оригинал.','ready');
    if(event.detail===0)$('#save-import').focus();
  }else{
    setBookTiles('selected');
    importStatus('Файл перевода убран. Можно продолжить с оригиналом.');
    if(event.detail===0)$('#preview-import').focus();
  }
};
async function previewImport(event){
  const original=getFile('original'),translation=getFile('translation');invalidateImport();
  if(!original){importStatus('Выберите файл оригинала.','error');return}
  const sequence=importSequence,controller=new AbortController();importJob=controller;
  $('#preview-import').disabled=true;$('#cancel-import').hidden=false;$('#import-preview').setAttribute('aria-busy','true');
  importStatus('Читаем книгу…','loading');setBookTiles('reading');
  let role='original';
  const read=async(file,item)=>{
    const choice=$('#ocr-'+item).value,ocr=ocrRecovery.has(item)?'thorough':'auto',preferredLanguages=preferredOcr(item);
    const key=importParseKey(item,preferredLanguages);
    const cached=parsedImport.get(item);
    if(cached?.file===file&&cached.key===key)return cached.parsed;
    parsedImport.delete(item);
    let complete=true;
    const stillHere=()=>sequence===importSequence&&!controller.signal.aborted;
    const parsed=await parseBook(file,{ocr,languages:choice?choice.split('+'):undefined,preferredLanguages,includeIllustrations:item==='original',
      signal:controller.signal,onOcrUnavailable:()=>{complete=false},onProgress:update=>{
        if(stillHere())showImportProgress(item,update);
      }});
    // At most one result per selected slot while the dialog is open. A failed
    // or cancelled scan must never prevent the user from retrying the file.
    if(complete&&stillHere())parsedImport.set(item,{file,key,parsed});
    return parsed;
  };
  try{
    const a=await read(original,role);if(sequence!==importSequence)return;
    role='translation';const b=translation?await read(translation,role):null;if(sequence===importSequence)renderImportPreview(a,b,event);
  }catch(e){
    if(sequence!==importSequence)return;
    previewBook=null;setBookTiles('selected');dropMotions.get($('#'+role+'-file'))?.state('rejected');
    importStatus((translation?(role==='original'?'Оригинал: ':'Перевод: '):'')+(e.message||'Не удалось прочитать файл.'),'error');
    if((isPdf(getFile(role))||isImage(getFile(role)))&&['OCR_NO_TEXT','OCR_MODEL_UNAVAILABLE','OCR_WORKER_FAILURE','OCR_JOB_TIMEOUT'].includes(e.code)){$('#retry-ocr').hidden=false;$('#retry-ocr').dataset.role=role}
  }finally{if(sequence===importSequence)finishImportJob()}
}
$('#cancel-import').onclick=cancelImport;
for(const role of importRoles)$('#ocr-'+role).onchange=()=>{parsedImport.delete(role);invalidateImport();setBookTiles('selected')};
function setupOcr(role){
  if(!importRoles.includes(role)||importJob)return;
  if(isPdf(getFile(role)))ocrRecovery.add(role);
  parsedImport.delete(role);invalidateImport();setBookTiles('selected');$('#ocr-panel').open=true;
  importStatus('При необходимости выберите язык и повторите предпросмотр.');
  $('#ocr-'+role).focus();
}
$('#retry-ocr').onclick=()=>setupOcr($('#retry-ocr').dataset.role);
async function saveImport(event){if(!previewBook||$('#import-dialog').hasAttribute('data-saving'))return;if(previewBook.alignment==='positional-unverified'&&!$('#alignment-check').checked)return;$('#save-import').disabled=$('#remove-translation-file').disabled=true;$('#import-dialog').setAttribute('data-saving','');const {epubImages,...textBook}=previewBook;const book=stampTextBook({...textBook,id:'book-'+crypto.randomUUID(),createdAt:Date.now()});for(const key of ['ocr','translationOcr'])if(book[key])book[key]=sanitizeOcr(book[key]);try{await dbAction('readwrite',s=>{putIllustrations(s,book.id,epubImages);return s.add(book)});books.push(book);previewBook=null;$('#import-dialog').close();$('#original-file').value='';$('#translation-file').value='';acceptedImportFiles.clear();fileTile($('#original-file'));fileTile($('#translation-file'));resetOcrSettings();invalidateImport();toast('Книга добавлена.');openBook(book.id,undefined,{motion:!!event?.detail,focus:!event?.detail,trigger:'continue'})}catch(e){toast(e.name==='QuotaExceededError'?'Недостаточно памяти браузера для книги. Освободите место или выберите меньший файл.':e.message);$('#save-import').disabled=false}finally{$('#import-dialog').removeAttribute('data-saving');$('#remove-translation-file').disabled=false}}
// Touch pans are native. Only actual ribbon scrolling indicates exploration.
const ribbon=$('#translation-ribbon');
ribbon.addEventListener('pointerdown',e=>{
  if(!e.isPrimary&&e.pointerType==='touch')return;
  if(ribbon.scrollWidth<=ribbon.clientWidth)return;
  if(e.pointerType==='touch'){touchRibbon={id:e.pointerId,left:ribbon.scrollLeft,expires:Infinity};return}
  if(e.button!==0)return;
  drag={id:e.pointerId,x:e.clientX,left:ribbon.scrollLeft,moved:false};
  try{ribbon.setPointerCapture(e.pointerId)}catch{}
});
ribbon.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const delta=e.clientX-drag.x;
  if(!drag.moved&&Math.abs(delta)<4)return;
  drag.moved=true;ribbon.classList.add('dragging');
  const before=ribbon.scrollLeft;ribbon.scrollLeft=drag.left-delta;if(ribbon.scrollLeft!==before)markExploring()
});
function endDrag(e){
  if(touchRibbon&&e.pointerId===touchRibbon.id)touchRibbon.expires=performance.now()+550;
  if(!drag||e.pointerId!==drag.id)return;
  drag=null;ribbon.classList.remove('dragging')
}
for(const event of ['pointerup','pointercancel','lostpointercapture'])ribbon.addEventListener(event,endDrag);
ribbon.addEventListener('scroll',()=>{
  if(touchRibbon&&performance.now()<touchRibbon.expires&&Math.abs(ribbon.scrollLeft-touchRibbon.left)>2&&ribbon.scrollLeft!==programmaticRibbonLeft)markExploring()
},{passive:true});
ribbon.addEventListener('wheel',e=>{
  if(ribbon.scrollWidth>ribbon.clientWidth&&(Math.abs(e.deltaX)>0||e.shiftKey)){touchRibbon={id:null,left:ribbon.scrollLeft,expires:performance.now()+350}}
},{passive:true});
ribbon.addEventListener('keydown',e=>{
  if(e.key==='Home'){e.preventDefault();syncTranslation();return}
  if(!['ArrowLeft','ArrowRight','End'].includes(e.key)||ribbon.scrollWidth<=ribbon.clientWidth)return;
  e.preventDefault();const before=ribbon.scrollLeft;
  if(e.key==='End')ribbon.scrollLeft=ribbon.scrollWidth;
  else ribbon.scrollBy({left:e.key==='ArrowRight'?180:-180,behavior:'instant'});
  if(ribbon.scrollLeft!==before)markExploring()
});
function installFileTiles(){
  const hasFiles=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');
  for(const label of $$('.drop-field')){
    const input=label.querySelector('input'),role=label.dataset.fileField,fx=installDropMotion(label);dropMotions.set(input,fx);
    const reject=message=>{
      const retained=acceptedImportFiles.has(input);
      fx.leave();if(!retained)fx.state('rejected');
      $('#import-file-warning').textContent=message+(retained?' Прежний файл не изменён.':'');
    };
    const accept=(file,options)=>{
      acceptedImportFiles.set(input,file);fileTile(input,options);resetOcrSettings(role);invalidateImport();
    };
    input.onchange=e=>{
      const file=input.files[0],issue=bookFileError(file);
      if(!file||issue){
        const previous=acceptedImportFiles.get(input);
        input.value='';
        if(previous)try{
          const data=new DataTransfer();data.items.add(previous);input.files=data.files;
        }catch{/* The import still uses the previous accepted File. */}
        if(issue)reject(issue);
        return;
      }
      accept(file,{animate:!!(e.isTrusted&&lastPointerInput)});
    };
    label.addEventListener('pointerdown',()=>fx.press(),{passive:true});
    label.addEventListener('dragover',e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';fx.drag(e)});
    label.addEventListener('dragleave',e=>{if(!label.contains(e.relatedTarget))fx.leave()});
    label.addEventListener('drop',e=>{
      if(!hasFiles(e))return;e.preventDefault();const files=e.dataTransfer.files,file=files[0];
      const issue=files.length>1?'Добавьте по одному файлу.':bookFileError(file);
      if(issue||!file){reject(issue||'Не удалось прочитать файл. Нажмите «Выбрать».');return}
      try{const data=new DataTransfer();data.items.add(file);input.files=data.files}
      catch{reject('Нажмите «Выбрать», чтобы добавить файл.');return}
      accept(file,{dropped:true});
    })
  }
  $('#import-dialog').addEventListener('close',()=>{if($('#import-dialog').open)return;resetOcrSettings();invalidateImport();for(const fx of dropMotions.values())fx.settle()});
}
$('#reading-scroll').addEventListener('scroll',onReadingScroll,{passive:true});$('#sync-translation').onclick=syncTranslation;const passageEl=$('#passage');
function setReadingWordTabStop(button){
  const row=button.parentElement;
  if(!row?.classList.contains('reading-paragraph'))return;
  const previous=row.querySelector('[data-word][tabindex="0"]');
  if(previous&&previous!==button)previous.tabIndex=-1;
  button.tabIndex=0;
}
passageEl.addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  const button=e.target.closest('.reading-paragraph > button[data-word]'),row=button?.parentElement;
  if(!row)return; // Comic hotspots have their own navigation.
  const forward=(e.key==='ArrowRight')!==(getComputedStyle(row).direction==='rtl');
  const target=e.key==='Home'?row.firstElementChild:e.key==='End'?row.lastElementChild:
    forward?button.nextElementSibling:button.previousElementSibling;
  e.preventDefault();e.stopPropagation();
  if(target?.hasAttribute('data-word')){setReadingWordTabStop(target);target.focus()}
});
passageEl.onclick=e=>{
  const b=e.target.closest('[data-word]');
  if(b){setReadingWordTabStop(b);showWord(b,e)}
};
$('#reader-back').onclick=e=>{
  if($('#reader').hidden||readerBackPending)return;
  const options={motion:e.detail>0,focus:e.detail===0};
  if(history.state?.folioReaderShelfParent===true){
    // Checkpoint and cancel reader work now, but keep this entry available to Forward.
    readerBackPending=true;
    showHome(readerReturn,options);
    history.back();
  }else{
    // A direct (or old) link cannot assume what precedes it in browser history.
    history.replaceState(null,'','#'+readerReturn);
    showHome(readerReturn,options);
  }
};
$('#previous-chapter').onclick=e=>switchChapter(chapter-1,{focus:e.detail===0});$('#next-chapter').onclick=e=>switchChapter(chapter+1,{focus:e.detail===0});$('#chapter-open').onclick=openReaderContents;$('#reader-bookmark').onclick=()=>{capturePosition();const list=state.bookmarks[current.id]||[],key=chapter+'/'+paragraph;const rest=list.filter(p=>bookmarkLocation(p)!==key);if(rest.length<list.length){state.bookmarks[current.id]=rest;toast('Закладка удалена')}else{state.bookmarks[current.id]=[...list,{...state.positions[current.id]}];toast('Абзац сохранён в закладках')}saveState();updateBookmark()};$('#translation-full').onclick=()=>openLocalDialog(currentLocalTarget());$('#word-save').onclick=toggleWordSaved;
const wordSpeech=createWordSpeech({publish:({status,language,apple})=>{
  const button=$('#word-speech'),guide=$('#word-speech-guide'),notice=$('#word-speech-status');
  button.dataset.speechState=status;
  notice.textContent=wordSpeechMessage(status,language);
  guide.hidden=!['waiting','missing','unavailable'].includes(status);
  if(!guide.hidden){
    guide.querySelector('span').textContent=apple?'На iPhone: Настройки → Универсальный доступ → Чтение вслух (Устный контент) → Голоса. Safari показывает не все загруженные голоса. ':'Проверьте голос нужного языка в настройках устройства.';
    guide.querySelector('a').hidden=!apple;
  }
}});
const listenButton=$('#reader-listen');
let followingBook=false;
const bookSpeech=createBookSpeech({
  onPosition({book,chapter:ci,paragraph:pi}){
    if(book!==current||$('#reader').hidden){bookSpeech.stop();return}
    followingBook=true;
    try{
      const pos={chapter:ci,paragraph:pi,fraction:0};
      if(ci!==chapter){chapter=ci;paragraph=pi;renderChapter(pos)}
      else{setActiveParagraph(pi,true);restorePosition(pos)}
      state.positions[book.id]=pos;saveState();
    }finally{followingBook=false}
  },
  onState(status,lang){
    const running=status==='starting'||status==='speaking';
    readingHome.setNarrating(status==='speaking');
    if(running){pendingReadingScroll=null;markReadingScrollAnchor()}
    const label=running?'Приостановить чтение':status==='paused'?'Продолжить слушать':'Слушать книгу';
    listenButton.title=label;listenButton.setAttribute('aria-label',label);
    listenButton.firstElementChild.innerHTML=iconMarkup(running?'listenPause':'headphones');
    if(status==='ended'){
      // Finishing narration also reaches the end, even if the last paragraph
      // spans several viewports and narration initially aligned to its start.
      const last=current?.chapters.at(-1);
      if(last&&chapter===current.chapters.length-1&&paragraph===last.paragraphs.length-1&&!$('#reader').hidden){
        const sc=$('#reading-scroll');sc.scrollTop=sc.scrollHeight;markReadingScrollAnchor();capturePosition();
      }
      toast('Книга прослушана.');
    }else if(status==='unsupported')toast('Этот браузер не поддерживает чтение вслух.');
    else if(status==='unknown')toast('Укажите язык чтения в настройках Folio.');
    else if(status==='retry-voice')toast('Выбранный голос не запустился. Нажмите ещё раз, чтобы попробовать другой голос на устройстве.');
    else if(status==='missing'||status==='waiting')toast('Нет локального голоса для языка книги. Проверьте голоса в настройках устройства и нажмите ещё раз.');
    else if(['blocked','unavailable','interrupted'].includes(status))toast(wordSpeechMessage(status,lang));
  }
});
listenButton.onclick=event=>{
  if(!current||isComic(current)||$('#reader').hidden)return;
  const from=readingSourceLanguage(current,chapter),sample=current.chapters[chapter].paragraphs[paragraph]?.text||'';
  wordSpeech.reset();
  bookSpeech.toggle({event,source:current,chapter,paragraph,language:speechLanguage(from,sourceLanguage(sample,from))});
};
// Manual scrolling returns control to the reader. Ignore scroll events caused
// by following the speaking paragraph, including near the end of a short page.
const listenScroll=$('#reading-scroll');
for(const type of ['wheel','touchmove'])listenScroll.addEventListener(type,()=>bookSpeech.pause(),{passive:true});
listenScroll.addEventListener('pointerdown',e=>{if(e.target===listenScroll&&e.pointerType==='mouse')bookSpeech.pause()});
listenScroll.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key))bookSpeech.pause()});
$('#word-speech').onclick=sayWord;
// This is a navigation/disclosure action, never a provider request. The
// existing context pane has a separate, explicit and cancellable send button.
const returnFromAi=$('#byok-return-reader');
let aiReaderReturnPending=false;
function aiReaderEntry(){
  const entry=history.state?.folioAiReader;
  return location.hash==='#profile/ai'&&typeof entry?.hash==='string'&&entry.hash.startsWith('#read/')&&entry.hash.length<=512?entry:null;
}
function syncAiReaderReturn(){
  aiReaderReturnPending=false;
  const entry=aiReaderEntry();returnFromAi.hidden=!entry;
  if(entry)returnFromAi.href=entry.hash;else returnFromAi.removeAttribute('href');
}
window.addEventListener('hashchange',syncAiReaderReturn);
$('#profile-view').addEventListener('folio:profile-page',syncAiReaderReturn);
syncAiReaderReturn();
returnFromAi.addEventListener('click',event=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  if(aiReaderReturnPending){event.preventDefault();return}
  const entry=aiReaderEntry();
  if(!entry)return;
  window.addEventListener('hashchange',()=>{
    if(!$('#reader').hidden)$('#reading-scroll').focus({preventScroll:true});
  },{once:true});
  // Reuse the original book entry: it already remembers the originating shelf.
  if(entry.parent){event.preventDefault();aiReaderReturnPending=true;history.back()}
});
$('#word-ai-entry').onclick=event=>{
  if(!wordAnchor||!current||!$('#word-dialog').open)return;
  const connection=byokSession.snapshot();
  if(!connection?.model||!BYOK_PROVIDERS.some(provider=>provider.id===connection.provider)){
    const hash='#read/'+encodeURIComponent(current.id),parent=location.hash===hash;
    location.hash='profile/ai';
    history.replaceState({...history.state,folioAiReader:{hash,parent}},'');
    syncAiReaderReturn();showHome('profile');
    // profile-stack handles the route on hashchange; focus only afterwards.
    window.addEventListener('hashchange',()=>{
      if(location.hash==='#profile/ai')$('#byok-heading').focus({preventScroll:true});
    },{once:true});
    return;
  }
  // Keep the pane accessible if the selected word cannot be sent (unknown
  // source language, malformed token, or text without usable context).
  openWordContext(event);
  if(aiWordHint){aiWordHint.focus();return}
  const context=$('#word-context');
  let notice=context.querySelector('.word-ai-unavailable');
  if(!notice){
    notice=node('p','Для этого слова не удалось подготовить контекст.','word-ai-unavailable muted');
    notice.tabIndex=-1;notice.setAttribute('role','status');context.append(notice);
  }
  notice.focus();
};
document.addEventListener('visibilitychange',()=>{if(document.hidden){wordSpeech.reset();bookSpeech.pause()}else wordSpeech.warm()});
window.addEventListener('pagehide',cancelSpeech);
$('#word-context-toggle').onclick=toggleWordContext;
$('#word-dialog').addEventListener('close',()=>{
  if($('#word-dialog').open)return;
  const trigger=wordAnchor?.button;selectedWordSequence++;wordAnchor=null;dictUI.hideHint();resetWordContext();wordFlight.cancel();wordSpeech.reset();
  // A native dialog usually restores focus synchronously, before the close
  // event. Do not pull it back if Tab or an arrow already moved it elsewhere.
  const focused=document.activeElement;
  if(trigger?.isConnected&&!$('#reader').hidden&&(!focused||focused===document.body||$('#word-dialog').contains(focused)))
    trigger.focus({preventScroll:true});
  scheduleSeen();
});
for(const dialog of $$('#reader ~ dialog'))if(dialog.id!=='word-dialog')dialog.addEventListener('close',scheduleSeen);
$('#reading-auto-save').onchange=e=>{
  state.prefs.autoSaveWords=e.currentTarget.checked;
  saveState();
};
$('#reader-prefs').onclick=installSheet($('#preferences'),{opener:$('#reader-prefs')}).open;
for(const id of ['contents-dialog','word-dialog','translation-dialog','review-dialog'])installSheet($('#'+id));
installSheet($('#backup-dialog'),{canDismiss:()=>!restoring});
installSheet($('#import-dialog'),{canDismiss:()=>!$('#import-dialog').hasAttribute('data-saving')});$('#font-size').oninput=e=>prefsChanged({size:+e.target.value});$('#reading-theme').onchange=e=>prefsChanged({theme:e.target.value});$('#reading-font').onchange=e=>prefsChanged({font:e.target.value});$$('[data-view]').forEach(b=>b.onclick=e=>navigateHome(b.dataset.view,e));$('#import-open').onclick=()=>$('#import-dialog').showModal();$('#preview-import').onclick=previewImport;$('#alignment-check').onchange=e=>$('#save-import').disabled=!e.target.checked;$('#save-import').onclick=saveImport;
// The short series uses only saved records and their resolved local dictionary.
// Reading an existing source position for a cloze never records a new encounter.
const manualWords=new Set(),SERIES_LIMIT=PRACTICE_LIMITS.words;
let seriesToken=0,recentSeriesWords=[],pickerLimit=48,activeSeriesKeys=null;
const player=practicePlayer({game:$('#lesson-game'),feedback:actionFeedback,iconMarkup,allowNativeCheck,
  onExit:()=>{showPracticeMenu();$('#lesson-start').focus({preventScroll:true})},
  onAgain:e=>{const keys=activeSeriesKeys;showPracticeMenu();void startSeries(e,keys)}
});
function stopSeries(){
  seriesToken++;practiceAudio.stop();player.stop();$('#lesson-start').disabled=false;$('#lesson-start').removeAttribute('aria-busy');
}
function sourceExcerpt(record){
  for(const [loc,offsets] of Object.entries(record.seen||{}).slice(0,8)){
    const [id,chapter,paragraph]=loc.split('/'),p=books.find(b=>b.id===id)?.chapters?.[chapter]?.paragraphs?.[paragraph]?.text;
    if(!p)continue;
    for(const item of offsets.slice(0,4)){
      const offset=item<0?-item-1:item;
      // Require an original token at this exact recorded UTF-16 offset. Avoid
      // clozes based on guessed sentences when a book has changed/disappeared.
      const m=p.slice(offset,offset+140).match(/^[\p{L}][\p{L}\p{M}]*(?:['‘’ʼ‐‑\u00ad-][\p{L}][\p{L}\p{M}]*)*/u);
      if(!m||normalizeWord(m[0],record.language)!==record.word)continue;
      const start=Math.max(0,offset-310),end=Math.min(p.length,offset+m[0].length+310),before=p.slice(start,offset),after=p.slice(offset+m[0].length,end);
      const splitLeft=Array.from(before.matchAll(/[.!?…](?:[”’"»)]*)\s+|\n+/gu)).pop(),splitRight=/[.!?…](?:[”’"»)]*)(?=\s|$)|\n/u.exec(after);
      if((!splitLeft&&start!==0)||(!splitRight&&end!==p.length))continue;
      const excerpt=before.slice(splitLeft?splitLeft.index+splitLeft[0].length:0)+m[0]+after.slice(0,splitRight?splitRight.index+splitRight[0].length:after.length);
      if(excerpt.trim().length<=300)return excerpt.trim();
    }
  }
  return '';
}
function scopeLabel(){
  for(const id of manualWords)if(!Object.hasOwn(learning.words,id))manualWords.delete(id);
  $('#lesson-scope-label').textContent=manualWords.size?'Вы выбрали: '+wordCountText(manualWords.size):'Автоподбор слов';
  $('#lesson-scope-note').textContent=manualWords.size?'Только выбранные слова.':'Сначала трудные и те, которые пора повторить.';
  $('#lesson-pick-count').textContent='Выбрано: '+manualWords.size+(manualWords.size>SERIES_LIMIT?' · до '+SERIES_LIMIT+' за серию':' / '+SERIES_LIMIT);
  $('#lesson-clear').disabled=!manualWords.size;
}
function paintPicker(){
  scopeLabel();
  const box=$('#lesson-options'),query=searchKey($('#lesson-search').value),matches=Object.values(learning.words).filter(r=>!query||searchKey(r.word).includes(query));
  const frag=document.createDocumentFragment();
  for(const r of matches.slice(0,pickerLimit)){
    const label=node('label',null,'lesson-pick-item'),input=node('input'),word=node('span',r.word),lang=node('small',r.language.toUpperCase());
    word.lang=r.language;input.type='checkbox';input.value=r.key;input.checked=manualWords.has(r.key);input.disabled=!input.checked&&manualWords.size>=SERIES_LIMIT;
    input.onchange=()=>{
      if(input.checked&&manualWords.size<SERIES_LIMIT)manualWords.add(r.key);else manualWords.delete(r.key);
      scopeLabel();box.querySelectorAll('input').forEach(b=>{b.checked=manualWords.has(b.value);b.disabled=!b.checked&&manualWords.size>=SERIES_LIMIT});
      $('#lesson-status').textContent='';$('#lesson-library').hidden=true;
    };
    label.append(input,word,lang);frag.append(label);
  }
  if(!matches.length)frag.append(node('p',query?'Ничего не найдено.':'Нажмите на слово в книге, чтобы добавить его.','muted'));
  box.replaceChildren(frag);$('#lesson-more').hidden=pickerLimit>=matches.length;
}
$('#lesson-choose').onclick=()=>{
  const picker=$('#lesson-picker'),open=picker.hidden;picker.hidden=!open;$('#lesson-choose').setAttribute('aria-expanded',String(open));
  if(open){paintPicker();if(!lastPointerInput)$('#lesson-search').focus({preventScroll:true})}
};
$('#lesson-clear').onclick=()=>{manualWords.clear();paintPicker();$('#lesson-search').focus({preventScroll:true})};
$('#lesson-more').onclick=()=>{const n=pickerLimit;pickerLimit+=48;paintPicker();$('#lesson-options').querySelectorAll('input')[n]?.focus()};
$('#lesson-search').oninput=()=>{pickerLimit=48;paintPicker()};
async function resolveSeriesCard(record,packId,target){
  const hit=await lookupStudy(record,{packId,target}),card=makePracticeCard(record,hit);
  if(!card)return null;
  card.language=sourceLanguage(record.word,record.language);
  card.target=hit.entries.find(e=>e.translation?.trim()||e.definition?.trim())?.target||target;
  card.context=sourceExcerpt(record);return card;
}
async function startSeries(event,explicitKeys=null){
  if($('#lesson-start').disabled)return;
  // Invalidate a simultaneous old-style round too. Only the latest explicitly
  // requested activity can paint; hashing away/closing cancels late lookups.
  deactivatePractice();const token=++seriesToken;
  const alive=()=>token===seriesToken&&homeView==='practice'&&!$('#home').hidden&&location.hash==='#practice';
  const button=$('#lesson-start'),status=$('#lesson-status');
  scopeLabel();const selection=new Set(explicitKeys??manualWords),filtered=Object.values(learning.words).filter(r=>(!explicitKeys&&!selection.size)||selection.has(r.key));
  $('#match-menu-status').textContent='';$('#practice-view-words').hidden=true;$('#lesson-library').hidden=true;
  if(!filtered.length){status.textContent='Сначала нажмите на слово в книге. Для первой серии хватит и одного слова со значением.';$('#lesson-library').hidden=false;return}
  actionFeedback(event,'lesson');button.disabled=true;button.setAttribute('aria-busy','true');
  status.textContent='Подбираем задания по местным словарям…';
  if(!$('#lesson-picker').hidden){$('#lesson-picker').hidden=true;$('#lesson-choose').setAttribute('aria-expanded','false')}
  const {dictionaryPack:packId,dictionaryTarget:target}=state.prefs;
  const auto=!explicitKeys&&!selection.size;
  const ordered=auto?rankPracticeWords(filtered,{recent:recentSeriesWords,limit:MAX_CANDIDATES}):filtered.slice(0,MAX_CANDIDATES);
  try{
    const cards=[];let doc=null,failures=0;
    for(let i=0;i<ordered.length;i+=12){
      if(!alive())return;
      const got=await Promise.allSettled(ordered.slice(i,i+12).map(r=>resolveSeriesCard(r,packId,target)));
      for(const c of got){if(c.status==='rejected')failures++;else if(c.value)cards.push(c.value)}
      if(!alive())return;
      doc=buildPracticeLesson(cards,{preservePriority:auto});
      if(doc?.words.length>=SERIES_LIMIT)break;
    }
    if(!alive())return;
    if(!doc){status.textContent=failures===ordered.length?'Местный словарь недоступен. Проверьте словари в профиле и попробуйте ещё раз.':'Не нашлось слов с подходящими значениями. Выберите другие слова или установите словарь в профиле.';return}
    activeSeriesKeys=selection.size?[...selection]:null;
    if(auto)recentSeriesWords=rememberStudyWords(recentSeriesWords,doc.words.map(c=>c.id));
    const part='В этой серии '+doc.words.length+' из '+selection.size+' выбранных слов.';
    const scopeNote=selection.size>doc.words.length?part+(selection.size>SERIES_LIMIT?' Лимит серии: '+SERIES_LIMIT+'.':' Для заданий нужны различимые словарные значения.'):'';
    status.textContent='';$('#practice-menu').hidden=true;$('#match-game').hidden=true;
    player.start(doc,{scopeNote});
  }catch{if(alive())status.textContent='Не удалось собрать серию. Проверьте местные словари и попробуйте ещё раз.'}
  finally{if(token===seriesToken){button.disabled=false;button.removeAttribute('aria-busy')}}
}
$('#lesson-start').onclick=startSeries;
installCommandButton($('#lesson-start'));
installStorageMeter($('#profile-storage-meter'));
installTranslationStorage($('#profile-translation-storage'),localTranslator.modelStorage);

// Matching is a drill: no vocabulary status changes, review scoring, or unseen text scanning.
let matchRound=null,matchRun=0,matchBadTimer=0,recentMatchWords=[];
const matchButtons={words:new Map(),meanings:new Map()};
function deactivatePractice(){
  activeSeriesKeys=null;stopSeries();
  matchRun++;matchRound=null;clearTimeout(matchBadTimer);
  for(const b of [$('#match-start'),$('#match-next')]){b.removeAttribute('aria-busy');b.disabled=false}
  for(const map of Object.values(matchButtons))map.clear();
}
function showPracticeMenu({focus=false,clear=true}={}){
  deactivatePractice();
  $('#practice-menu').hidden=false;$('#match-game').hidden=true;
  if(clear){$('#match-menu-status').textContent='';$('#practice-view-words').hidden=true;$('#lesson-status').textContent='';$('#lesson-library').hidden=true}
  scopeLabel();if(!$('#lesson-picker').hidden)paintPicker();
  if(focus)$('#match-start').focus({preventScroll:true});
}
function announceMatch(text,kind=''){
  const notice=$('#match-feedback');
  notice.textContent=text;notice.dataset.kind=kind;
}
function clearWrongMatch(){
  clearTimeout(matchBadTimer);
  $$('.match-tile[data-miss]').forEach(b=>delete b.dataset.miss);
}
function paintMatch(){
  for(const side of ['words','meanings'])for(const [id,b] of matchButtons[side]){
    const paired=matchRound.matched.has(id),picked=matchRound.selected?.side===side&&matchRound.selected?.id===id;
    b.setAttribute('aria-pressed',String(picked));b.disabled=paired;b.toggleAttribute('data-matched',paired);
    b.querySelector('.match-tile-mark').hidden=!paired;
  }
  const matched=matchRound.matched.size,total=matchRound.words.length;
  $('#match-progress').textContent=`${matched} / ${total}`;
  $('#match-meter').max=total;$('#match-meter').value=matched;
}
function chooseMatch(side,id,event){
  if(!matchRound)return;
  const from=matchRound.selected?.side,outcome=matchChoice(matchRound,side,id);
  if(outcome.kind==='ignored')return;
  clearWrongMatch();paintMatch();
  if(outcome.kind==='hit'||outcome.kind==='complete'){
    for(const column of ['words','meanings'])outcomeCue(matchButtons[column].get(outcome.id)?.querySelector('.match-tile-mark'),'pair',420);
  }
  switch(outcome.kind){
    case 'selected':{
      actionFeedback(event,'lesson');const other=side==='words'?'значение':'слово';announceMatch(`Теперь выберите ${other}.`);
      break;
    }
    case 'cleared':announceMatch('Выбор снят.');break;
    case 'miss':{
      actionFeedback(event,'incorrect');const wrong=[outcome.first,outcome.second].map(p=>matchButtons[p.side].get(p.id)).filter(Boolean);
      wrong.forEach(b=>b.dataset.miss='');matchBadTimer=setTimeout(()=>wrong.forEach(b=>delete b.dataset.miss),600);
      announceMatch('Не пара. Попробуйте ещё раз.','miss');break;
    }
    case 'hit':{
      actionFeedback(event,'correct');announceMatch('Пара найдена.','hit');
      if(event.detail===0)[...matchButtons[from||'words'].values()].find(b=>!b.disabled)?.focus({preventScroll:true});
      break;
    }
    case 'complete':{
      actionFeedback(event,'complete');announceMatch('');
      const errors=matchRound.attempts-matchRound.matched.size;
      $('#match-result').textContent=errors?`Собрано: ${matchRound.matched.size}. ${ruCount(errors,['ошибка','ошибки','ошибок'])}.`:'Ни одной ошибки.';
      $('#match-done').hidden=false;$('#match-next').hidden=false;
      $('#match-done-heading').focus({preventScroll:true});
      break;
    }
  }
}
function launchMatch(cards,{motion=false}={}){
  clearWrongMatch();matchRound=createMatchRound(cards);
  for(const side of ['words','meanings']){
    const box=$('#match-'+side);box.replaceChildren();matchButtons[side].clear();
    for(const card of matchRound[side]){
      const b=node('button',null,'match-tile'),label=node('span',side==='words'?card.word:card.meaning,'match-tile-text');
      const mark=node('i',null,'icon-glyph match-tile-mark');mark.innerHTML=iconMarkup('check');mark.hidden=true;
      b.type='button';label.lang=side==='words'?card.language:card.target||state.prefs.dictionaryTarget;
      b.append(label,mark);b.setAttribute('aria-pressed','false');b.onclick=e=>chooseMatch(side,card.id,e);
      matchButtons[side].set(card.id,b);box.append(b);
    }
  }
  $('#practice-menu').hidden=true;$('#match-game').hidden=false;$('#match-done').hidden=true;$('#match-next').hidden=true;
  $('#match-next').disabled=false;$('#match-instructions').textContent='Выберите слово и его значение.';
  announceMatch('');paintMatch();window.scrollTo({top:0,behavior:'instant'});
  $('#match-game-title').focus({preventScroll:true});revealMotion($('#match-board'),'panel',{enabled:motion});
}
async function startMatch(event){
  stopSeries();$('#lesson-status').textContent='';$('#lesson-library').hidden=true;
  const run=++matchRun,fromRound=!!matchRound&&!$('#match-game').hidden,loadingControl=fromRound?$('#match-next'):$('#match-start');
  const notice=$('#match-menu-status'),motion=!!event?.detail;
  const records=Object.values(learning.words),eligible=records.length>=MIN_PAIRS;
  if(!eligible){
    showPracticeMenu({clear:false});
    notice.textContent='Сохраните хотя бы три слова, чтобы собрать первый раунд.';$('#practice-view-words').hidden=false;return;
  }
  loadingControl.disabled=true;loadingControl.setAttribute('aria-busy','true');
  if(fromRound){$('#match-instructions').textContent='Подбираем пары…'}else{notice.textContent='Подбираем пары…';$('#practice-view-words').hidden=true}
  try{
    const packId=state.prefs.dictionaryPack,target=state.prefs.dictionaryTarget;
    const ordered=rankPracticeWords(records,{recent:recentMatchWords,limit:MAX_CANDIDATES});
    const groups=new Map();let cards=[];
    for(let i=0;i<ordered.length&&cards.length<MAX_PAIRS;i+=16){
      if(run!==matchRun||homeView!=='practice')return;
      const slice=ordered.slice(i,i+16);
      const results=await Promise.allSettled(slice.map(async r=>{
        const result=await lookupStudy(r,{packId,target}),card=makePracticeCard(r,result);
        if(!card)return null;card.language=sourceLanguage(r.word,r.language);
        card.target=result.entries.find(e=>e.translation?.trim()||e.definition?.trim())?.target||target;
        return card;
      }));
      for(const {status,value:c} of results){if(status!=='fulfilled'||!c)continue;const k=c.language+':'+c.target;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c)}
      for(const group of groups.values()){const picks=distinctCards(group);if(picks.length>cards.length)cards=picks}
    }
    if(run!==matchRun||homeView!=='practice')return;
    if(cards.length<MIN_PAIRS){
      showPracticeMenu({clear:false});
      notice.textContent='Не нашлось трёх разных пар на одних языках. Добавьте слова в книге или установите словари в профиле.';
      $('#practice-view-words').hidden=false;return;
    }
    recentMatchWords=rememberStudyWords(recentMatchWords,cards.map(c=>c.id));
    launchMatch(cards,{motion});
  }catch(e){
    if(run!==matchRun||homeView!=='practice')return;
    showPracticeMenu({clear:false});notice.textContent='Не удалось собрать раунд. Попробуйте ещё раз.';
  }finally{
    if(run===matchRun){loadingControl.disabled=false;loadingControl.removeAttribute('aria-busy')}
  }
}
$('#match-start').onclick=startMatch;
$('#match-next').onclick=startMatch;
$('#match-exit').onclick=()=>showPracticeMenu({focus:true});
$('#match-reset').onclick=e=>{if(matchRound){matchRun++;$('#match-next').removeAttribute('aria-busy');launchMatch(matchRound.words,{motion:!!e.detail})}};

function prepareReview(){
  reviewSequence++;reviewCanGrade=false;
  const question=$('#review-question'),empty=$('#review-empty'),record=reviewQueue[reviewIndex];
  question.hidden=!record;empty.hidden=!!record;
  if(!record){
    $('#review-result').textContent=reviewed?'Повторено: '+wordCountText(reviewed)+'.':'Ни одна карточка не оценена.';
    const counts=[
      ['Вспомнили',reviewRecalled],
      ['Повторить позже',reviewed-reviewRecalled],
      ['Пропустили',reviewQueue.length-reviewed]
    ];
    $('#review-breakdown').replaceChildren(...counts.filter(([,n])=>n).map(([label,n])=>{
      const item=node('span',null,'review-stat');item.append(node('strong',String(n)),node('span',label));return item;
    }));
    return;
  }
  $('#review-meter').max=reviewQueue.length;$('#review-meter').value=reviewIndex;
  $('#review-position').textContent=(reviewIndex+1)+' / '+reviewQueue.length;
  $('#review-word').textContent=record.word;$('#review-word').lang=sourceLanguage(record.word,record.language);
  $('.review-card').removeAttribute('data-revealed');$('#review-prompt').hidden=false;
  $('#review-answer').hidden=true;$('#review-gloss').hidden=true;$('#review-gloss').textContent='';
  $('#review-gloss').removeAttribute('lang');$('#review-grade').hidden=true;
  $('#review-reveal').hidden=false;$('#review-reveal').disabled=false;
}
function startReview(keys=null,event){
  const dialog=$('#review-dialog');if(dialog.open||!canWriteWords(true))return;
  const records=keys?[...keys].map(key=>learning.words[key]):Object.values(learning.words);
  reviewQueue=recallQueue(records);
  if(!reviewQueue.length){renderHomePanel();return}
  reviewOpener=event?.currentTarget||null;
  reviewIndex=reviewed=reviewRecalled=0;prepareReview();dialog.showModal();
  $('#review-heading').focus({preventScroll:true});actionFeedback(event,'lesson');
}
async function revealReview(){
  const dialog=$('#review-dialog'),record=reviewQueue[reviewIndex],button=$('#review-reveal'),gloss=$('#review-gloss');
  if(!record||!dialog.open||button.disabled||button.hidden)return;
  const sequence=++reviewSequence;
  button.disabled=true;button.setAttribute('aria-busy','true');gloss.hidden=false;gloss.textContent='Ищем значение…';$('#review-answer').hidden=false;
  let hit=null;
  try{hit=await lookupStudy(record)}catch{}
  if(sequence!==reviewSequence||!dialog.open||dialog.hasAttribute('data-sheet-exiting'))return;
  const answer=firstGloss(hit);
  if(answer)gloss.lang=hit.entries.find(e=>e.translation?.trim()||e.definition?.trim())?.target||state.prefs.dictionaryTarget;
  gloss.textContent=answer||'В местных словарях значения нет.';
  reviewCanGrade=!!answer;
  button.removeAttribute('aria-busy');button.hidden=true;
  $('#review-grade').hidden=!reviewCanGrade;$('#review-prompt').hidden=true;
  $('.review-card').setAttribute('data-revealed','');
  // Focus the neutral heading, not a grade: Enter twice can never give a win.
  (reviewCanGrade?$('#review-word'):$('#review-skip')).focus({preventScroll:true});
}
function nextReview(){
  if(!$('#review-dialog').open||!reviewQueue[reviewIndex])return;
  reviewIndex++;$('#review-reveal').removeAttribute('aria-busy');prepareReview();
  (reviewQueue[reviewIndex]?$('#review-word'):$('#review-done-heading')).focus({preventScroll:true});
}
function gradeReview(recalled,event){
  const record=reviewQueue[reviewIndex],now=Date.now();
  if(!record||!reviewCanGrade||!$('#review-dialog').open)return;
  if(!canWriteWords(true))return;
  if(record===learning.words[record.key]&&due(record,now)){
    if(!changeScore(record,()=>review(record,{recalled,now})))return;
    reviewed++;if(recalled)reviewRecalled++;
    actionFeedback(event,recalled?'correct':'incorrect');
  }
  reviewCanGrade=false;nextReview();renderHomePanel();
}
$('#review-start').onclick=e=>{if(selectingWords)startReview(selectedWordKeys,e)};
$('#practice-review').onclick=e=>startReview(null,e);
$('#review-reveal').onclick=revealReview;
$('#review-yes').onclick=e=>gradeReview(true,e);
$('#review-no').onclick=e=>gradeReview(false,e);
$('#review-skip').onclick=nextReview;
$('#review-done').onclick=()=>$('#review-dialog').close('done');
window.addEventListener('hashchange',()=>{
  const dialog=$('#review-dialog');
  if(dialog.open&&location.hash!==(reviewOpener?.id==='review-start'?'#words':'#practice'))dialog.close('navigate');
});
$('#review-dialog').addEventListener('close',()=>{
  if($('#review-dialog').open)return;
  reviewSequence++;reviewCanGrade=false;$('#review-reveal').removeAttribute('aria-busy');
  renderHomePanel();
  const opener=reviewOpener;reviewOpener=null;
  if(opener?.isConnected&&!opener.closest('[hidden]')){
    (opener.disabled?(homeView==='practice'?$('#practice-title'):$('#words-title')):opener)?.focus({preventScroll:true});
  }
});
$('#word-search-toggle').onclick=()=>setWordSearch($('#word-search-panel').inert,{focus:true});
$('#word-search').oninput=()=>{wordLimit=48;renderWords()};
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape'||homeView!=='words'||$('#home').hidden||document.querySelector('dialog[open]'))return;
  if(!$('#word-search-panel').inert)setWordSearch(false,{focus:true});
  else if(selectingWords){exitWordSelection();renderWords();$('#word-selection-toggle').focus({preventScroll:true})}
  else return;
  e.preventDefault();
});
for(const b of wordStageButtons)b.onclick=e=>{
  wordFilter=b.dataset.stageFilter;wordLimit=48;renderWords({motion:e.detail>0});
  revealWordStageButton(b);
};
$('#words-more').onclick=()=>{const old=wordLimit;wordLimit+=48;renderWords({appendFrom:old});$$('#saved-list .saved-row')[old]?.querySelector('input,button')?.focus()};
$('#word-selection-toggle').onclick=()=>{
  if(selectingWords)exitWordSelection();else selectingWords=true;
  renderWords();
};
$('#word-selection-remove').onclick=e=>{
  if(!e.isTrusted||!selectingWords||!selectedWordKeys.size)return;
  const keys=[...selectedWordKeys];
  (wordDeleteDialog??=createWordDeleteDialog()).open({
    wordCount:wordCountText(keys.length),trigger:e.currentTarget,remove:()=>removeSelectedWords(keys),
    focusFallback:()=>$('#word-selection-toggle').disabled?$('#words-title'):$('#word-selection-toggle'),
  });
};
$('#words-to-practice').onclick=e=>{
  if(!selectingWords||!selectedWordKeys.size)return;
  // Use the same editable scope as the practice picker. A missing gloss or
  // backing out must not turn the user's next attempt into automatic selection.
  manualWords.clear();
  for(const key of selectedWordKeys)manualWords.add(key);
  navigateHome('practice',e);
  void startSeries(e);
};
$('#export-words').onclick=async()=>{
  const button=$('#export-words');button.disabled=true;
  try{
    const lines=[],records=Object.values(learning.words),opts={packId:state.prefs.dictionaryPack,target:state.prefs.dictionaryTarget};
    for(let at=0;at<records.length;at+=16){
      const batch=await Promise.all(records.slice(at,at+16).map(async r=>{
        let gloss='';try{const hit=await lookupStudy(r,opts);const e=hit?.entries?.find(e=>e.target===opts.target);gloss=e?.translation||e?.definition||''}catch{}
        return [r.word,gloss].map(s=>s.replace(/[\t\r\n]/g,' ')).join('\t');
      }));lines.push(...batch);
    }
    downloadText(lines.join('\n'),'text/tab-separated-values;charset=utf-8','folio-vocabulary.tsv');
  }finally{button.disabled=false}
};
for(const accent of ACCENTS){const b=node('button',null,'accent-swatch');b.type='button';b.dataset.accent=accent.value;b.style.setProperty('--swatch-color',accent.value);b.setAttribute('aria-label',accent.label);b.append(node('i'));b.onclick=()=>prefsChanged({accent:accent.value});$('#accent-swatches').append(b)}
$('#custom-accent').oninput=e=>prefsChanged({accent:e.target.value});
$('#pref-haptics').onchange=e=>prefsChanged({haptics:e.target.checked,...(supportsIphoneSwitch()?{iphoneCheckHaptic:e.target.checked}:{})});
for(const input of [$('#pref-sound'),$('#lesson-sound')])input.onchange=e=>prefsChanged({practiceSound:e.target.checked});
$('#pref-sound-test').onclick=e=>{
  if(!e.isTrusted||!state.prefs.practiceSound)return;
  const status=$('#pref-sound-test-status');
  status.textContent='Запускаем сигнал…';
  const ok=practiceAudio.play(e,'correct',result=>{
    status.textContent=result==='started'?'Если сигнал не слышен, проверьте громкость, беззвучный режим и Bluetooth.':
      'Не удалось запустить звук. Попробуйте ещё раз или откройте Folio в Safari.';
  });
  if(!ok&&status.textContent==='Запускаем сигнал…')status.textContent='Звук недоступен в этом браузере.';
};
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change',applyFeedbackPrefs);
$('#profile-size').oninput=e=>prefsChanged({size:+e.target.value});$('#profile-theme').onchange=e=>prefsChanged({theme:e.target.value});$('#profile-font').onchange=e=>prefsChanged({font:e.target.value});
const backupArtToggle=$('#backup-art'),backupExport=$('#export-backup'),backupReady=$('#backup-ready'),backupExportStatus=$('#backup-export-status');
let backupExportSequence=0,backupURL=null;
function resetBackupExport(){
  backupExportSequence++;backupExport.disabled=false;backupExportStatus.textContent='';
  backupReady.hidden=true;backupReady.removeAttribute('href');
  if(backupURL){URL.revokeObjectURL(backupURL);backupURL=null;}
  const label=backupArtToggle.checked?'Подготовить копию с иллюстрациями':'Скачать резервную копию';
  backupExport.setAttribute('aria-label',label);backupExport.title=label;
}
backupArtToggle.onchange=resetBackupExport;
$('#profile-view').addEventListener('folio:profile-page',()=>{
  if(location.hash!=='#profile/backups'){backupArtToggle.checked=false;resetBackupExport();}
});
backupExport.onclick=async()=>{
  resetBackupExport();const sequence=backupExportSequence;
  const active=()=>sequence===backupExportSequence&&location.hash==='#profile/backups';
  const includeArt=backupArtToggle.checked;
  try{
    const editions=books.slice();let art;
    if(includeArt){
      backupExport.disabled=true;backupExportStatus.textContent='Готовим локальную копию…';
      const {collectEpubBackup}=await import('./epub-art-backup.js');
      if(!active())return;
      art=await collectEpubBackup(editions,async(id,index)=>(await dbAction('readonly',s=>readIllustration(s,id,index)))?.blob,{active});
      if(!active())return;
    }
    const text=serializeBackup(editions,state,legacyWords(),packLearning(learning),art);
    const blob=new Blob([text],{type:'application/json;charset=utf-8'});
    if(blob.size>BACKUP_LIMIT)throw new Error(includeArt?'Копия больше 50 МБ. Скачайте копию без иллюстраций или сохраните исходные книги отдельно.':'Копия больше 50 МБ. Скачивание такой копии пока не поддерживается.');
    const file='folio-backup-'+new Date().toISOString().slice(0,10)+'.json';
    if(!includeArt){downloadBlob(blob,file);return;}
    // The download itself still gets a real user tap, including on mobile.
    backupURL=URL.createObjectURL(blob);backupReady.href=backupURL;backupReady.download=file;backupReady.hidden=false;
    backupExportStatus.textContent=art.length?'Файл готов. Иллюстрации включены.':'Файл готов. Сохранённых иллюстраций EPUB нет.';
  }catch(e){if(active()){
    const message=e?.message||'Не удалось создать резервную копию.';
    if(includeArt)backupExportStatus.textContent=message;else toast(message);
  }}
  finally{if(sequence===backupExportSequence)backupExport.disabled=false;}
};
$('#open-backup').onclick=()=>{$('#backup-file').value='';$('#backup-prefs').checked=false;arrangeBackup(null);$('#backup-dialog').showModal()};$('#backup-file').onchange=e=>arrangeBackup(e.target.files[0]);$('#restore-backup').onclick=restoreBackup;
$('#backup-dialog').addEventListener('close',()=>{
  if($('#backup-dialog').open)return;
  backupDraft=null;backupSequence++;$('#backup-file').value='';
});
window.addEventListener('pagehide',()=>{if(backupURL||backupExport.disabled)resetBackupExport()});
$('#dictionary-import').onclick=importDictionaryFile;
window.addEventListener('pagehide',()=>{practiceAudio.stop();suspendReading();if(learningDirty)saveState()});
document.addEventListener('visibilitychange',()=>{if(document.hidden){practiceAudio.stop();suspendReading();if(learningDirty)saveState()}else resumeReading()});
let syncEpoch=0,syncPanel=null;
async function showSyncPanel(){
  const epoch=++syncEpoch,host=$('#folio-sync-settings');
  if(location.hash!=='#profile/sync'){syncPanel?.dispose();syncPanel=null;return}
  if(syncPanel)return;
  try{
    const mod=await import('./sync-panel.js');
    if(epoch!==syncEpoch||location.hash!=='#profile/sync')return;
    if(wordDiskFault)throw Error('local-invalid');
    wordDisk??=mod.createWordStore(diskOptions());
    syncPanel=mod.openSyncPanel(host,{disk:wordDisk,liveWords:()=>{if(location.hash!=='#profile/sync')throw Object.assign(new Error(),{code:'local-changed'});return learning}});
  }catch{if(epoch===syncEpoch)host.textContent='Не удалось открыть перенос. Перезагрузите страницу и попробуйте снова.'}
}
$('#profile-view').addEventListener('folio:profile-page',showSyncPanel);
window.addEventListener('storage',e=>{
  if(e.key===SYNC_WORDS&&(!wordDisk?.held||e.newValue===null))wordStoreNotice('Другая вкладка изменила словарь. Перед редактированием слов перезагрузите Folio.');
});
window.addEventListener('pagehide',()=>{syncEpoch++;syncPanel?.dispose();syncPanel=null;wordDisk?.close()});
window.addEventListener('pageshow',e=>{if(e.persisted&&(wordDisk?.enrolled||storedValue(SYNC_WORDS)!==null)){location.reload();return}if(e.persisted){resumeReading();if(location.hash==='#profile/sync')void showSyncPanel()}});
function recoverCatalogLink(url,kind,intent){
  if(location.hash!==url||intent!==(kind==='books'?starterIntent:editorialIntent))return;
  // The reader never opened. Replace the failed deep link with a usable
  // shelf so refresh does not repeat the rejected request.
  history.replaceState(null,'','#library');
  setCatalogKind(kind);showHome('library',{focus:true});
  toast(kind==='books'?'Не удалось загрузить книгу. Попробуйте открыть её из каталога.':
    'Не удалось загрузить текст. Попробуйте открыть его из каталога.');
}
function readHash(){
  readerBackPending=false;
  if(!location.hash.startsWith('#read/')){starterIntent++;editorialIntent++;showHome(homeRoute());return}
  let id='';try{id=decodeURIComponent(location.hash.slice(6))}catch{/* Invalid links use the same shelf fallback. */}
  if(id==='demo')id=DEMO_ID; // Preserve old example links without accepting arbitrary IDs.
  if(current?.id===id&&!$('#reader').hidden)return;
  const saved=books.some(b=>b.id===id),editorial=editorialKind(id),starter=isStarterId(id);
  if(!saved&&!editorial&&!starter){
    starterIntent++;editorialIntent++;
    const route=returnRoute();
    history.replaceState(null,'','#'+route);showHome(route,{focus:true});
    toast('Этой книги нет на этом устройстве. Откройте её с полки или импортируйте файл снова.');
    return;
  }
  if(!saved&&(editorial||starter)){
    showHome(returnRoute());
    const url=location.hash,kind=editorial||'books';
    const request=editorial?openEditorialBook(id):openStarterBook(id);
    const intent=editorial?editorialIntent:starterIntent;
    void request.catch(()=>recoverCatalogLink(url,kind,intent));
  }else{starterIntent++;openBook(id)}
}
window.addEventListener('hashchange',readHash);
let previousWidth=window.innerWidth;
function readingResizeCurrent(resize,sc){
  return resize&&resize.width===previousWidth&&resize.epoch===renderEpoch&&resize.book===current&&
    resize.position===state.positions[current.id]&&resize.top===sc.scrollTop;
}
window.addEventListener('resize',()=>{
  const width=window.innerWidth,changed=previousWidth!==width;previousWidth=width;
  if(!changed||!current||$('#reader').hidden||suppressScroll)return;
  const position=state.positions[current.id],sc=$('#reading-scroll'),top=sc.scrollTop;
  if(!position)return;
  if(isComic(current)){
    if(readerSuspended||document.hidden)return;
    const anchor=comicResizeAnchor,geometry=comicPageGeometry(sc);
    // The browser may clamp the old pixel position to the new page end.
    // A real, newer swipe should not be reversed by the older art anchor.
    if(anchor?.epoch!==renderEpoch||anchor.position!==position||!geometry||
       Math.abs(top-Math.min(anchor.top,geometry.maxScroll))>1)return;
    const resize={width,book:current,epoch:renderEpoch,position,top};
    clearTimeout(saveTimer);
    requestAnimationFrame(()=>{
      if(!readingResizeCurrent(resize,sc)||$('#reader').hidden||suppressScroll||readerSuspended||document.hidden)return;
      restoreComicPosition(sc,position);rememberComicResizeAnchor(sc,position);
    });
    return;
  }
  if(deferHiddenReadingReflow(renderEpoch))return;
  // The saved fraction may already be obsolete before resize starts.
  if(readingScrollAnchor?.epoch===renderEpoch&&(readingScrollAnchor.dirty||Math.abs(top-readingScrollAnchor.top)>1))return;
  const resize=pendingReadingResize={width,book:current,epoch:renderEpoch,position,top};
  requestAnimationFrame(()=>{
    if(pendingReadingResize!==resize)return;
    pendingReadingResize=null;
    // A newer scroll or lifecycle checkpoint owns the position, not this stale reflow.
    if(!readingResizeCurrent(resize,sc)||$('#reader').hidden||suppressScroll||deferHiddenReadingReflow(renderEpoch))return;
    restorePosition(position);if(!ribbonManual)syncTranslation();
  });
});
for(const b of $$('[data-catalog]'))b.onclick=e=>setCatalogKind(b.dataset.catalog,{motion:e.detail>0});
for(const b of $$('[data-open-catalog]'))b.onclick=e=>{setCatalogKind(b.dataset.openCatalog);navigateHome('library',e)};
paintIcons();installFileTiles();bootMobileViewport();
for(const select of [$('#profile-font'),$('#reading-font')])populateReadingFontPicker(select);
if('switch' in document.createElement('input'))document.documentElement.dataset.nativeSwitch='';
applyPrefs();
languageUI=installLanguages({prefs:()=>state.prefs,save:saveLanguagePrefs,model:translationPack,runtime:localTranslator.capabilities,installed:()=>dictUI.installed,firstVisit:firstLanguageVisit});
if(learningDirty)saveState();void dictUI.refresh();
try{db=await openDB();const stored=await dbAction('readonly',s=>s.getAll(booksOnly()));books=[demo,...stored.filter(b=>b.id&&b.chapters?.length)];for(const b of books){if(!safePosition(state.positions[b.id],b))delete state.positions[b.id];if(Array.isArray(state.bookmarks[b.id]))state.bookmarks[b.id]=state.bookmarks[b.id].map(x=>safePosition(x,b)).filter(Boolean);else delete state.bookmarks[b.id]}if($('#home').dataset.ready==='true'&&!$('#home').hidden)renderHomePanel()}
catch{db=null;toast('Хранилище книг недоступно. Демо работает, но новые книги не сохранятся.')}
installVoiceControls({language:box=>box.closest('#preferences')&&current?
  speechLanguage(readingSourceLanguage(current,chapter),state.prefs.readingLanguage):state.prefs.readingLanguage,
  bookSample:box=>box.closest('#preferences')&&current&&!isComic(current)?current.chapters[chapter]?.paragraphs[paragraph]?.text:'',
  beforeSample:cancelSpeech});
readHash();if(location.hash==='#profile/sync')void showSyncPanel();
window.dispatchEvent(new Event('folio:ready'));
document.getElementById('folio-boot')?.remove();
