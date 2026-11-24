import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {safePosition} from '../dist/release-core.js';
import {isComic} from '../dist/comic-storage.js';
import {createLocalTranslator,translationPack,supportsTranslation} from '../dist/local-translation.js';

const src=readFileSync(process.env.FOLIO_POSITION_TEST_APP || new URL('../dist/app.js',import.meta.url),'utf8');
function part(a,b){const i=src.indexOf(a),j=src.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,a);return src.slice(i,j)}
const line=a=>part(a,'\n');
const noop=()=>{};
function session(disk=new Map(),step=100,{withTranslation=false}={}){
  const translations=[],frames=[],timers=new Map(),events={},nodes=new Map(),writes=[];let serial=0,translateCalls=0,panelOpens=0;
  const node=()=>({dataset:{},style:{},classList:{add:noop,remove:noop,toggle:noop},children:[],append(x){this.children.push(x)},
    replaceChildren(fragment){this.children=fragment.children},setAttribute:noop,removeAttribute:noop,toggleAttribute:noop,addEventListener:noop,firstElementChild:{},hidden:false,
    querySelector(selector){return this.children.find(x=>x.className===selector.slice(1))||null},
    showModal(){panelOpens++;this.open=true},open:false});
  const $=id=>id.startsWith('#paragraph-')?$('#passage').children[Number(id.slice(11))]:
    (nodes.has(id)||nodes.set(id,node()),nodes.get(id));
  const sc=$('#reading-scroll');
  const doc={hidden:false,body:node(),createDocumentFragment:node,getElementById:()=>null,addEventListener:(k,cb)=>(events[k]??=[]).push(cb)};
  const win={addEventListener:doc.addEventListener,scrollY:0};
  const book={id:'test',alignment:'none',language:'en',chapters:[0,1].map(ch=>({title:'Chapter '+ch,
    paragraphs:Array.from({length:20},(_,i)=>({text:String(i+1)}))}))};
  const c={$,window:win,document:doc,node:(_tag,text,className)=>{const n=node();n.offsetHeight=step;n.className=className;n.textContent=text;
      n.getBoundingClientRect=()=>({top:40+Number(n.dataset.paragraph)*step-sc.scrollTop});return n},
    localStorage:{getItem:k=>disk.get(k),setItem(k,v){disk.set(k,String(v));writes.push([k,String(v)])}},
    state:JSON.parse(disk.get('folio-v2')||'{"positions":{}}'),safePosition,isComic,books:[book],current:null,chapter:0,paragraph:0,
    renderEpoch:0,suppressScroll:false,frame:0,seenTimer:0,saveTimer:0,paragraphObserver:null,
    followingBook:false,bookSpeech:{stop:noop,playing:false,pause(){this.playing=false}},wordSpeech:{reset:noop,warm:noop},practiceAudio:{stop:noop},
    homeView:'home',readerReturn:'home',readerTrigger:'',homeLeaving:false,routeScroll:{},learningDirty:false,
    location:{hash:'#read/test'},returnRoute:()=>'home',listenButton:node(),storageWarning:'',DEMO_ID:'demo',IntersectionObserver:class{observe(){}disconnect(){}},
    requestAnimationFrame(cb){frames.push(cb);return ++serial},clearTimeout:id=>timers.delete(id),
    setTimeout(cb,ms){const id=++serial;timers.set(id,{cb,ms});return id},
    progress:()=>0,updateBookmark:noop,syncTranslation:()=>translations.push(c.paragraph),scheduleSeen:noop,saveLearning:noop,updateStorageStatus:noop,
    readingHome:{enterReader:noop},resetWordView:noop,setChromeColor:noop,renderStarterEdition:noop,revealMotion:noop,
    cancelMotion:noop,dismissWord:noop,closeComicView:noop,cancelSpeech:noop,isStarterId:()=>false,iconMarkup:()=>''};
  Object.assign(sc,{scrollTop:0,clientHeight:300,scrollHeight:step*20,getBoundingClientRect:()=>({top:40}),
    addEventListener:(k,cb)=>{events[k]=[cb]}});
  $('#reader').hidden=true;
  if(withTranslation){
    c.state.prefs={dictionaryTarget:'ru'};
    const translator=createLocalTranslator({storage:()=>c.localStorage});
    const translate=translator.translate;
    translator.capabilities=()=>true;
    translator.translate=(...args)=>{translateCalls++;return translate(...args)};
    Object.assign(c,{createLocalTranslator:()=>translator,translationPack,supportsTranslation,storedValue:k=>disk.get(k),
      readingSourceLanguage:()=> 'en',sourceLanguage:()=> 'en',ribbonManual:false,touchRibbon:null,programmaticRibbonLeft:0});
  }else c.renderRibbon=noop;

  const handlers=[line("document.addEventListener('visibilitychange',()=>{if(document.hidden){wordSpeech.reset()"),
    line("window.addEventListener('pagehide',cancelSpeech);"),line("window.addEventListener('pagehide',()=>{practiceAudio.stop()")];
  runInNewContext([part('function saveState(','function escapeHTML('),part('function openBook(','let comicView='),
    part('function renderChapter(','let ribbonBook='),
    ...(withTranslation?[part('let ribbonBook=','function markExploring(')]:[]),part('function switchChapter(','function updateBookmark('),
    part("$('#reading-scroll').addEventListener('scroll'", ";$('#sync-translation')"),...handlers,
    'const speechHooks={'+part('onPosition({book,chapter:ci,paragraph:pi}){','\n});\nlistenButton.onclick=')+'};globalThis.speechHooks=speechHooks;'
    ].join('\n'),c);
  const one=()=>{assert.ok(frames.length);frames.shift()()};
  const drain=()=>{while(frames.length)one()};
  const read=()=>JSON.parse(disk.get('folio-v2')).positions.test;
  return {c,$,sc,disk,writes,book,frames,one,drain,read,translations,
    translationStats:()=>({translateCalls,panelOpens}),
    runTranslationTimer(){for(const [id,{cb,ms}] of timers)if(ms===260){timers.delete(id);cb()}},
    show(){doc.hidden=false;for(const cb of events.visibilitychange)cb()},
    open(p){c.openBook('test',p);drain()},
    scroll(y){sc.scrollTop=y;events.scroll[0]()},
    hide(kind){doc.hidden=true;for(const cb of events[kind])cb()},
    tick180(){const saves=[...timers.entries()].filter(([,v])=>v.ms===180);assert.equal(saves.length,1);
      for(const [id,{cb}] of saves){timers.delete(id);cb()}}};
}
const pos=(paragraph,fraction,chapter=0)=>({chapter,paragraph,fraction});
for(const event of ['visibilitychange','pagehide'])for(const before of [false,true]){
  test(event+(before?' before':' after')+' scroll frame: serialized place cold-opens at the reached row',t=>{
    const h=session();h.open(pos(2,0));h.scroll(1000);if(!before)h.one();
    h.hide(event);const snapshot=h.read(),fresh=session(new Map(h.disk));fresh.open();
    t.diagnostic(JSON.stringify({snapshot,reopened:fresh.c.paragraph,scrollTop:fresh.sc.scrollTop}));
    assert.deepEqual(snapshot,pos(10,.22));assert.equal(fresh.c.paragraph,10);assert.equal(fresh.sc.scrollTop,1000);
    h.drain();h.tick180();assert.deepEqual(h.read(),snapshot);
  });
}
for(const event of ['visibilitychange','pagehide']){
  test(event+' without a delivered scroll event persists the visible paragraph and fraction',()=>{
    const h=session();h.open(pos(2,0));h.sc.scrollTop=1000;h.hide(event);
    assert.deepEqual(h.read(),pos(10,.22));
    const fresh=session(new Map(h.disk),150);fresh.open();
    assert.equal(fresh.c.paragraph,10);assert.equal(fresh.sc.scrollTop,1511);
  });
}
test('swipe just after initial layout is not suppressed, even on immediate hide',()=>{
  const h=session();h.c.openBook('test',pos(2,.4));h.one();
  h.sc.scrollTop=1000;h.hide('pagehide');assert.deepEqual(h.read(),pos(10,.22));
});
test('hide before first layout preserves exact intended anchor, not stale geometry',()=>{
  const h=session();h.c.openBook('test',pos(7,.4));h.sc.scrollTop=1000;
  h.hide('visibilitychange');assert.deepEqual(h.read(),pos(7,.4));h.drain();
  assert.equal(h.c.paragraph,7);assert.equal(h.sc.scrollTop,718);
});
test('background capture defers translation until warm resume and does not repeat it',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);
  h.hide('visibilitychange');h.drain();assert.deepEqual(h.read(),pos(10,.22));
  assert.deepEqual(h.translations,[2]);h.show();h.show();assert.deepEqual(h.translations,[2,10]);
});
test('normal scrolling only persists after the 180 ms timer',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);h.one();assert.deepEqual(h.read(),pos(2,0));
  h.tick180();assert.deepEqual(h.read(),pos(10,.22));
});
test('a consumed callback cannot steal a later scroll in the same render',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);h.c.capturePosition();assert.deepEqual(h.read(),pos(10,.22));
  h.scroll(500);assert.equal(h.frames.length,2);h.one();assert.equal(h.c.paragraph,10);
  h.one();h.tick180();assert.deepEqual(h.read(),pos(5,.22));
});
test('a pending scroll cannot replace an explicit paragraph or a chapter jump',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);h.c.setActiveParagraph(6,true);
  h.hide('visibilitychange');h.drain();assert.equal(h.c.paragraph,6);assert.deepEqual(h.read(),pos(6,.99));
  h.scroll(1200);h.c.switchChapter(1);h.hide('pagehide');assert.deepEqual(h.read(),pos(0,0,1));
  h.drain();h.tick180();assert.deepEqual(h.read(),pos(0,.22,1)); // the scroller clamps top to zero
});
test('same-ID replacement keeps its explicit position despite old frames',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);
  const next={...h.book,chapters:h.book.chapters.map(ch=>({...ch,paragraphs:ch.paragraphs.slice(0,5)}))};
  h.c.books=[next];h.c.openBook('test',pos(3,.4));h.hide('pagehide');h.drain();
  assert.equal(h.c.current,next);assert.equal(h.c.paragraph,3);assert.equal(h.sc.scrollTop,318);
  assert.deepEqual(h.read(),pos(3,.4));h.tick180();assert.deepEqual(h.read(),pos(3,.4));
});
test('capture uses the same bottom-of-scroll anchor as the frame and skips suppressed jumps',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1700);h.hide('pagehide');assert.deepEqual(h.read(),pos(18,0));
  h.drain();h.scroll(500);h.c.suppressScroll=true;h.hide('pagehide');h.drain();assert.deepEqual(h.read(),pos(18,0));
});
test('audio ownership survives a hide that pauses speech before capture',()=>{
  for(const follows of [false,true]){
    const h=session(new Map(),40);h.open(pos(2,0));h.scroll(200);
    h.c.bookSpeech.playing=true;h.c.speechHooks.onState('starting','en');
    if(follows)h.c.speechHooks.onPosition({book:h.book,chapter:0,paragraph:12});
    h.scroll(follows?458:200);h.hide('visibilitychange');assert.equal(h.c.bookSpeech.playing,false);
    h.drain();assert.deepEqual(h.read(),follows?pos(12,0):pos(2,.99));assert.equal(h.c.paragraph,follows?12:2);
  }
});
test('comic page saves keep their page fraction without text-anchor work',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);
  // Comic renderer boundary. A text callback is still queued from the previous render.
  h.c.current={...h.book,kind:'comic',comicPages:[{},{}]};h.c.renderEpoch++;h.c.chapter=1;h.c.paragraph=0;
  h.$('#passage').children=new Proxy([],{get(){throw Error('text geometry is unavailable in comic mode')}});
  h.scroll(850);h.hide('pagehide');assert.deepEqual(h.read(),pos(0,.5,1));h.drain();h.tick180();
  assert.deepEqual(h.read(),pos(0,.5,1));
});

test('cold reopen after an undelivered swipe shows the correct persisted translation, with no further translation or setup',()=>{
  const mode=JSON.stringify(['test','en','ru']);
  const key=original=>JSON.stringify(['test','folio-bergamot-en-ru-2.1-packed',original]);
  const disk=new Map([
    ['folio-local-translation-mode-v1',JSON.stringify([mode])],
    ['folio-local-paragraphs-generation-v2','g'],
    ['folio-local-paragraphs-v2',JSON.stringify({generation:'g',deleted:[],rows:[[key('3'),'Wrong anchor'],[key('11'),'Correct resumed translation']]})],
  ]);
  const old=session(disk,100,{withTranslation:true});
  old.open(pos(2,0));
  assert.equal(old.$('#translation-track').querySelector('.translation-empty').textContent,'Wrong anchor');
  old.sc.scrollTop=1000;
  old.hide('pagehide');
  assert.deepEqual(old.read(),pos(10,.22));

  const reopened=session(new Map(disk),150,{withTranslation:true});
  reopened.open();
  assert.equal(reopened.c.paragraph,10);
  assert.equal(reopened.sc.scrollTop,1511);
  const line=reopened.$('#translation-track').querySelector('.translation-empty');
  assert.equal(line.textContent,'Correct resumed translation');
  assert.equal(line.lang,'ru');
  assert.equal(reopened.$('#local-translation-open').textContent,'Пауза');
  reopened.runTranslationTimer();
  assert.deepEqual(reopened.translationStats(),{translateCalls:0,panelOpens:0});
  assert.equal(reopened.$('#translation-dialog').open,false);
});
