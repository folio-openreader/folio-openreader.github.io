import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {safePosition} from '../dist/release-core.js';
import {isComic} from '../dist/comic-storage.js';

const src=readFileSync(process.env.FOLIO_POSITION_TEST_APP || new URL('../dist/app.js',import.meta.url),'utf8');
function part(a,b){const i=src.indexOf(a),j=src.indexOf(b,i+a.length);assert.ok(i>=0&&j>i,a);return src.slice(i,j)}
const line=a=>part(a,'\n');
const noop=()=>{};
function session(disk=new Map(),step=100,rowHeight=step){
  const translations=[],frames=[],timers=new Map(),events={},nodes=new Map(),writes=[],focused=[];let serial=0,failWrites=0,resolveFonts;
  const node=()=>({dataset:{},style:{},classList:{add:noop,remove:noop,toggle:noop},children:[],append(...x){this.children.push(...x)},
    replaceChildren(fragment){this.children=fragment?.children||[]},setAttribute:noop,removeAttribute:noop,toggleAttribute:noop,addEventListener:noop,firstElementChild:{},hidden:false,
    querySelector(selector){return this.children.find(x=>x.className===selector.slice(1))||null},
    focus(options){focused.push({node:this,options});doc.activeElement=this;},
    getBoundingClientRect(){return {top:0,height:48}},scrollTop:0,clientHeight:240,
    showModal(){this.open=true;doc.activeElement=this;},
    close(){this.open=false},open:false});
  const $=id=>id.startsWith('#paragraph-')?$('#passage').children[Number(id.slice(11))]:
    (nodes.has(id)||nodes.set(id,node()),nodes.get(id));
  const sc=$('#reading-scroll');
  const doc={hidden:false,get visibilityState(){return this.hidden?'hidden':'visible'},querySelector:selector=>selector==='dialog[open]'?[...nodes].find(([id,el])=>id.endsWith('-dialog')&&el.open)?.[1]||null:null,body:node(),createDocumentFragment:node,getElementById:()=>null,addEventListener:(k,cb)=>(events[k]??=[]).push(cb)};
  doc.fonts={check:()=>false,load:()=>new Promise(resolve=>{resolveFonts=resolve})};
  const win={addEventListener:doc.addEventListener,scrollY:0,scrollTo:noop,innerWidth:800};
  const book={id:'test',alignment:'none',language:'en',chapters:[0,1].map(ch=>({title:'Chapter '+ch,
    paragraphs:Array.from({length:20},(_,i)=>({text:String(i+1)}))}))};
  const c={$,window:win,document:doc,node:(_tag,text,className)=>{const n=node();n.offsetHeight=rowHeight;n.className=className;n.textContent=text;
      n.getBoundingClientRect=()=>({top:40+Number(n.dataset.paragraph)*step-sc.scrollTop});return n},
    localStorage:{getItem:k=>disk.get(k),setItem(k,v){if(failWrites&&k==='folio-v2'){failWrites--;throw Error('storage blocked')}disk.set(k,String(v));writes.push([k,String(v)])}},
    state:JSON.parse(disk.get('folio-v2')||'{"positions":{}}'),safePosition,isComic,books:[book],current:null,chapter:0,paragraph:0,
    renderEpoch:0,suppressScroll:false,frame:0,seenTimer:0,saveTimer:0,paragraphObserver:null,activeComicPage:null,
    followingBook:false,bookSpeech:{stop(){this.playing=false},playing:false,pause(){this.playing=false}},wordSpeech:{reset:noop,warm:noop},practiceAudio:{stop:noop},
    homeView:'home',readerReturn:'home',readerBackPending:false,comicResizeAnchor:null,readerTrigger:'',homeLeaving:false,routeScroll:{},learningDirty:false,
    location:{hash:'#read/test'},returnRoute:()=>'home',listenButton:node(),storageWarning:'',DEMO_ID:'demo',IntersectionObserver:class{observe(){}disconnect(){}},
    requestAnimationFrame(cb){frames.push(cb);return ++serial},clearTimeout:id=>timers.delete(id),
    setTimeout(cb,ms){const id=++serial;timers.set(id,{cb,ms});return id},
    progress:()=>0,updateBookmark:noop,syncTranslation:()=>translations.push(c.paragraph),saveLearning:noop,updateStorageStatus:noop,
    toast:noop,applyPrefs:noop,READING_FONTS:{test:{label:'Test'},late:{label:'Late'}},readHash:noop,ribbonManual:false,readingHome:{enterReader:noop,leaveReader:noop,setNarrating:noop},resetWordView:noop,setChromeColor:noop,renderStarterEdition:noop,revealMotion:noop,
    cancelMotion:noop,dismissWord:noop,closeComicView:noop,cancelSpeech(){c.bookSpeech.stop()},isStarterId:()=>false,iconMarkup:()=>''};
  Object.assign(sc,{scrollTop:0,clientHeight:300,scrollHeight:step*20,getBoundingClientRect:()=>({top:40}),
    addEventListener:(k,cb)=>{events[k]=[cb]}});
  $('#reader').hidden=true;
  Object.assign(c,{renderRibbon:noop,cancelLocalQueue:noop,navMotion:{select:noop},HOME_ROUTES:['home','library','words','practice','profile'],
    $$:()=>[],renderHomePanel:noop,wordDisk:null,storedValue:()=>null,SYNC_WORDS:'words',
    learning:{},bookStats:()=>({words:0,encounters:0}),wordCountText:()=>'',encounterText:()=>'',outcomeCue:noop,
    history:{state:{},pushState(_s,_t,url){c.location.hash=url},replaceState(_s,_t,url){c.location.hash=url}}});
  c.state.bookmarks??={};
  c.prior={bookmarks:c.state.bookmarks};
  c.record=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
  // Load the real DOM listeners on A8 (both on one line) and on the candidate.
  const lifecycle=part("window.addEventListener('pagehide',()=>{practiceAudio.stop()", "let syncEpoch=");
  const handlers=[line("document.addEventListener('visibilitychange',()=>{if(document.hidden){wordSpeech.reset()"),
    line("window.addEventListener('pagehide',cancelSpeech);"),lifecycle,line("window.addEventListener('pageshow',e=>{if(e.persisted&&(wordDisk")];
  runInNewContext([part('let rememberedReadingPositions=','function escapeHTML('),part('function showHome(','let comicView='),
    part('function scheduleSeen(','function wordNodes('),part('function renderChapter(','let ribbonBook='),
    part('function comicPageGeometry(','function updateComicProgress('),
    part('let prefsLayoutEpoch=','function renderProfileStats('),part('function switchChapter(','function updateBookmark('),part('function openReaderContents(','function sourceLanguage('),
    part("$('#reading-scroll').addEventListener('scroll'", ";$('#sync-translation')"),
    part("$('#reader-back').onclick=e=>", "\n$('#previous-chapter')"),
    part("$('#previous-chapter').onclick=", ";$('#reader-bookmark')"),...handlers,
    part("window.addEventListener('hashchange',readHash)", "for(const b of $$('[data-catalog]'))"),
    'const speechHooks={'+part('onPosition({book,chapter:ci,paragraph:pi}){','\n});\nlistenButton.onclick=')+'};globalThis.speechHooks=speechHooks;'
    ].join('\n'),c);
  const one=()=>{assert.ok(frames.length);frames.shift()()};
  const drain=()=>{while(frames.length)one()};
  const read=()=>JSON.parse(disk.get('folio-v2')).positions.test;
  return {c,$,sc,disk,writes,book,frames,one,drain,read,translations,focused,doc,
    timerCount(ms){return [...timers.values()].filter(entry=>entry.ms===ms).length},
    reflow(newStep){step=newStep;for(const row of $('#passage').children)row.offsetHeight=step;sc.scrollHeight=step*20},
    resize(width,newStep=step){this.reflow(newStep);win.innerWidth=width;for(const cb of events.resize)cb()},
    resolveFonts(){resolveFonts([{}])},
    failNextWrite(){failWrites++},
    show(kind='visibilitychange'){doc.hidden=false;for(const cb of events[kind])cb({persisted:true})},
    open(p){c.openBook('test',p);drain()},
    scroll(y){sc.scrollTop=y;events.scroll[0]()},
    hide(kind){doc.hidden=true;for(const cb of events[kind])cb()},
    tick180(){const saves=[...timers.entries()].filter(([,v])=>v.ms===180);assert.ok(saves.length<=1);
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
  h.show();h.scroll(1200);h.c.switchChapter(1);h.hide('pagehide');assert.deepEqual(h.read(),pos(0,0,1));
  h.drain();h.tick180();assert.deepEqual(h.read(),pos(0,0,1)); // hidden timers cannot overwrite the seek
});
test('same-ID replacement keeps its explicit position despite old frames',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);
  const next={...h.book,chapters:h.book.chapters.map(ch=>({...ch,paragraphs:ch.paragraphs.slice(0,5)}))};
  h.c.books=[next];h.c.openBook('test',pos(3,.4));h.hide('pagehide');h.drain();
  assert.equal(h.c.current,next);assert.equal(h.c.paragraph,3);assert.equal(h.sc.scrollTop,318);
  assert.deepEqual(h.read(),pos(3,.4));h.tick180();assert.deepEqual(h.read(),pos(3,.4));
});
test('capture uses the same bottom-of-scroll anchor as the frame and skips suppressed jumps',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1700);h.hide('pagehide');assert.deepEqual(h.read(),{...pos(18,0),viewportDelta:-78});
  h.drain();h.show();h.scroll(500);h.c.suppressScroll=true;h.hide('pagehide');h.drain();assert.deepEqual(h.read(),{...pos(18,0),viewportDelta:-78});
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
test('comic page saves keep the artwork anchor without text-anchor work',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);
  // Comic renderer boundary. A text callback is still queued from the previous render.
  h.c.current={...h.book,kind:'comic',comicPages:[{},{}]};h.c.renderEpoch++;h.c.chapter=1;h.c.paragraph=0;
  h.c.activeComicPage={index:1};h.sc.querySelector=selector=>selector==='.comic-bar'
    ? {offsetHeight:40} : {getBoundingClientRect:()=>({top:80-h.sc.scrollTop,height:1960})};
  h.$('#passage').children=new Proxy([],{get(){throw Error('text geometry is unavailable in comic mode')}});
  h.scroll(850);h.hide('pagehide');
  const anchor={...pos(0,.5,1),comicImageOffset:850/1960};
  assert.deepEqual(h.read(),anchor);h.drain();h.tick180();
  assert.deepEqual(h.read(),anchor);
  h.show();h.c.activeComicPage=null;h.sc.scrollTop=0;h.hide('pagehide');
  assert.deepEqual(h.read(),anchor,'failed or unavailable layout may not overwrite the anchor');
});


for(const event of ['visibilitychange','pagehide'])test(event+' replay and stale queued frame cannot clobber a newer tab save',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);const n=h.writes.length;
  h.hide(event);assert.deepEqual(h.read(),pos(10,.22));assert.equal(h.writes.length,n+1);
  // Another tab now edits the same position plus independent book/prefs.
  const newer={...JSON.parse(h.disk.get('folio-v2')),positions:{test:pos(16,.3),another:pos(4,.4)},prefs:{size:21}};
  h.disk.set('folio-v2',JSON.stringify(newer));
  h.hide('pagehide');h.drain();h.tick180();h.hide('visibilitychange');
  assert.deepEqual(JSON.parse(h.disk.get('folio-v2')),newer);assert.equal(h.writes.length,n+1);
  h.show('pageshow');h.show();assert.deepEqual(h.translations,[2,10]);
  h.scroll(500);h.hide('pagehide');assert.deepEqual(h.read(),pos(5,.22));
});
test('a stale active tab preserves changed or deleted positions belonging to other books',()=>{
  const disk=new Map([['folio-v2',JSON.stringify({positions:{test:pos(1,.1),other:pos(2,.2),removed:pos(3,.3)}})]]);
  const h=session(disk);h.open(pos(1,.1));
  disk.set('folio-v2',JSON.stringify({positions:{test:pos(1,.1),other:pos(8,.3)}}));
  h.scroll(500);h.hide('visibilitychange');
  assert.deepEqual(JSON.parse(disk.get('folio-v2')).positions,{test:pos(5,.22),other:pos(8,.3)});
});
test('non-reading save preserves a newer same-book checkpoint when its local position is unchanged',()=>{
  const disk=new Map([['folio-v2',JSON.stringify({positions:{test:pos(1,.1)}})]]);
  const h=session(disk);
  disk.set('folio-v2',JSON.stringify({positions:{test:pos(15,.4)}}));
  h.c.saveState();
  assert.deepEqual(h.read(),pos(15,.4));
});
test('failed lifecycle write is retried at pagehide',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);h.failNextWrite();h.hide('visibilitychange');
  assert.deepEqual(h.read(),pos(2,0));h.hide('pagehide');assert.deepEqual(h.read(),pos(10,.22));
});
test('bookmark click, immediate back before layout, then reopen use the explicit seek',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);
  h.c.state.bookmarks.test=[pos(7,.4,1)];h.c.renderReaderBookmarks();h.$('#bookmarks-list').children[0].children[0].onclick();
  h.$('#reader-back').onclick({detail:1});h.drain();h.tick180();assert.equal(h.$('#reader').hidden,true);
  assert.deepEqual(h.read(),pos(7,.4,1));
  const fresh=session(new Map(h.disk));fresh.open();assert.deepEqual(fresh.read(),pos(7,.4,1));assert.equal(fresh.sc.scrollTop,718);
});
test('switch book with pending scroll, then hide before its layout, preserves both matching positions',()=>{
  const h=session();h.open(pos(2,0));h.scroll(1000);
  const next={...h.book,id:'other'};h.c.books.push(next);h.c.openBook(next.id,pos(4,.6,1));
  h.hide('pagehide');h.drain();h.tick180();
  const state=JSON.parse(h.disk.get('folio-v2'));assert.equal(state.lastBook,'other');
  assert.deepEqual(state.positions.test,pos(10,.22));assert.deepEqual(state.positions.other,pos(4,.6,1));
});

test('a delayed programmatic scroll event after restore keeps one visible-word exposure timer',()=>{
  const h=session();h.open(pos(5,.4));assert.equal(h.timerCount(650),1);
  h.scroll(h.sc.scrollTop);h.drain();assert.equal(h.timerCount(650),1);
  h.hide('visibilitychange');assert.equal(h.timerCount(650),0);
  h.show();assert.equal(h.timerCount(650),1);
});

test('resize frame queued before a swipe cannot roll back the lifecycle checkpoint on warm return',()=>{
  const h=session();h.open(pos(2,0));h.tick180();h.resize(600);h.scroll(930.5);
  h.hide('visibilitychange');assert.deepEqual(h.read(),pos(9,.525));
  h.show();h.drain();assert.equal(h.sc.scrollTop,930.5);
  h.hide('visibilitychange');assert.deepEqual(h.read(),pos(9,.525));
});
test('resize frame never restores or synchronizes the ribbon while hidden',()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.resize(600,140);
  h.hide('visibilitychange');const y=h.sc.scrollTop;
  h.drain();assert.equal(h.sc.scrollTop,y);assert.deepEqual(h.translations,[2]);
});
test('visible resize still restores the unchanged relative anchor after reflow',()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.resize(600,140);h.drain();
  assert.equal(h.sc.scrollTop,314);
  assert.deepEqual(h.translations,[2,2]);
});
test('resize frame does not overwrite a visible swipe even before the scroll event',()=>{
  const h=session();h.open(pos(2,0));h.tick180();h.resize(600);h.sc.scrollTop=930.5;
  h.drain();assert.equal(h.sc.scrollTop,930.5);
  h.hide('pagehide');assert.deepEqual(h.read(),pos(9,.525));
});

test('a swipe after the text-size layout is committed survives an immediate cold reopen',()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.c.state.prefs={font:'test'};
  h.c.prefsChanged({size:26});h.one();h.sc.scrollTop=930.5;
  h.hide('visibilitychange');assert.deepEqual(h.read(),pos(9,.525));
  const fresh=session(new Map(h.disk));fresh.open();assert.equal(fresh.sc.scrollTop,930.5);
});
test('hide before the text-size layout keeps the intended anchor instead of stale geometry',()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.c.state.prefs={font:'test'};
  h.c.prefsChanged({size:26});h.sc.scrollTop=930.5;h.hide('visibilitychange');
  assert.deepEqual(h.read(),pos(2,.4));h.drain();assert.equal(h.sc.scrollTop,218);
  assert.deepEqual(h.translations,[2]);h.show();assert.deepEqual(h.translations,[2,2]);
});
test('late font reflow restores the same relative anchor, then permits immediate checkpoint',async()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.c.state.prefs={font:'test'};
  h.c.prefsChanged({font:'late'});h.drain();h.reflow(140);h.resolveFonts();await new Promise(setImmediate);
  assert.equal(h.sc.scrollTop,314);h.scroll(888);h.hide('pagehide');assert.deepEqual(h.read(),pos(6,.5));
});
test('late font reflow cannot replay an obsolete anchor after a swipe and hide',async()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.c.state.prefs={font:'test'};
  h.c.prefsChanged({font:'late'});h.drain();h.scroll(930.5);h.hide('visibilitychange');
  h.reflow(140);h.resolveFonts();await new Promise(setImmediate);h.drain();
  assert.equal(h.sc.scrollTop,930.5);assert.deepEqual(h.read(),pos(9,.525));assert.deepEqual(h.translations,[2,2]);
});

for(const delivered of [false,true])test('resize after an unsaved in-paragraph swipe '+(delivered?'with':'without')+' a scroll frame keeps its new place',()=>{
  const h=session(new Map(),2000);h.open(pos(2,0));h.tick180();
  if(delivered){h.scroll(5350.5);h.drain()}else h.sc.scrollTop=5350.5;
  assert.deepEqual(h.read(),pos(2,0));
  h.resize(600);h.drain();assert.equal(h.sc.scrollTop,5350.5);
  h.hide('pagehide');assert.deepEqual(h.read(),pos(2,.68625));
});

test('hidden orientation reflow preserves the frozen position on warm return',()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.hide('visibilitychange');
  h.resize(600,140);h.drain();assert.equal(h.sc.scrollTop,218);assert.deepEqual(h.read(),pos(2,.4));
  h.show();h.drain();assert.equal(h.sc.scrollTop,314);
  h.hide('visibilitychange');assert.deepEqual(h.read(),pos(2,.4));
});
test('resize just before hiding preserves its intended fraction if no newer scroll owns it',()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.resize(600,140);h.hide('visibilitychange');
  assert.deepEqual(h.read(),pos(2,.4));h.show();h.drain();assert.equal(h.sc.scrollTop,314);
  h.hide('visibilitychange');assert.deepEqual(h.read(),pos(2,.4));
});
test('late font reflow in background realigns only on wake to the frozen position',async()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.c.state.prefs={font:'test'};
  h.c.prefsChanged({font:'late'});h.drain();h.hide('visibilitychange');
  h.reflow(140);h.resolveFonts();await new Promise(setImmediate);h.drain();assert.equal(h.sc.scrollTop,218);
  h.show();h.drain();assert.equal(h.sc.scrollTop,314);
  h.hide('visibilitychange');assert.deepEqual(h.read(),pos(2,.4));
});
test('orientation while hidden realigns to the new swipe, never the pre-swipe position',()=>{
  const h=session();h.open(pos(2,.4));h.tick180();h.scroll(930.5);h.hide('visibilitychange');
  h.resize(600,140);h.drain();assert.equal(h.sc.scrollTop,930.5);
  h.show();h.drain();assert.equal(h.sc.scrollTop,1311.5);
  h.hide('visibilitychange');assert.deepEqual(h.read(),pos(9,.525));
});

for(const event of ['visibilitychange','pagehide'])for(const raf of [false,true]){
  test('fast jump across a paragraph boundary restores the exact viewport: '+event+' / RAF '+raf,()=>{
    const h=session();h.open(pos(0,0));h.scroll(943.5);if(raf)h.one();h.hide(event);
    // At the 65px selection line, row 10 is active, but it is still 56.5px below the viewport top.
    assert.equal(h.c.paragraph,10);
    const fresh=session(new Map(h.disk));fresh.open();
    assert.equal(fresh.c.paragraph,10);assert.equal(fresh.sc.scrollTop,943.5);
    fresh.hide('pagehide');const again=session(new Map(fresh.disk));again.open();
    assert.equal(again.sc.scrollTop,943.5);
  });
}
test('short paragraphs at the scroll limit do not shift past the original viewport on reopen',()=>{
  const h=session();h.open(pos(3,.2));h.scroll(1700);h.hide('pagehide');
  const fresh=session(new Map(h.disk));fresh.open();
  assert.equal(fresh.c.paragraph,18);assert.equal(fresh.sc.scrollTop,1700);
});

test('a viewport in the inter-paragraph margin reopens in the margin, not on the last line',()=>{
  const h=session(new Map(),100,40);h.open(pos(0,0));h.scroll(923);h.hide('pagehide');
  const fresh=session(new Map(h.disk),100,40);fresh.open();
  assert.equal(fresh.c.paragraph,9);assert.equal(fresh.sc.scrollTop,923);
});
test('corrupt viewport metadata cannot override a valid portable paragraph position',()=>{
  const h=session(),p=pos(2,.4);
  for(const delta of [null,'10',Infinity,-513,513])assert.deepEqual(safePosition({...p,viewportDelta:delta},h.book),p);
});


test('keyboard chapter buttons focus the newly rendered chapter without changing its scroll anchor',()=>{
  const h=session();h.open(pos(6,.5));assert.equal(h.focused.length,0);
  h.$('#next-chapter').onclick({detail:0});
  assert.equal(h.focused.length,0);
  h.drain();assert.equal(h.doc.activeElement,h.$('#chapter-heading'));
  assert.equal(h.$('#chapter-heading').textContent,'Chapter 1');
  assert.equal(h.focused.at(-1).options.preventScroll,true);assert.equal(h.sc.scrollTop,0);
  h.$('#previous-chapter').onclick({detail:0});h.drain();
  assert.equal(h.$('#chapter-heading').textContent,'Chapter 0');
  assert.equal(h.focused.length,2);assert.equal(h.sc.scrollTop,0);
});

test('keyboard selection in the contents sheet hands focus to the chosen chapter after closing',()=>{
  const h=session();h.open(pos(4,.2));h.$('#chapter-open').onclick();
  assert.equal(h.$('#contents-dialog').open,true);
  h.$('#chapter-list').children[1].onclick({detail:0});
  assert.equal(h.$('#contents-dialog').open,false);
  h.drain();assert.equal(h.doc.activeElement,h.$('#chapter-heading'));
  assert.equal(h.$('#chapter-heading').textContent,'Chapter 1');
});

test('pointer changes do not steal focus and an older focus request cannot override a newer chapter',()=>{
  const h=session();h.open(pos(4,.2));
  h.$('#next-chapter').onclick({detail:0});
  h.$('#previous-chapter').onclick({detail:1});
  h.drain();assert.equal(h.focused.length,0);
  h.$('#chapter-open').onclick();
  assert.equal(h.doc.activeElement,h.$('#chapter-list').children[0]);h.focused.length=0;
  h.$('#chapter-list').children[1].onclick({detail:1});h.drain();
  assert.equal(h.focused.length,0);
});

test('an intervening open sheet or hidden reader prevents a delayed chapter focus',()=>{
  const h=session();h.open(pos(0,0));h.$('#next-chapter').onclick({detail:0});
  h.$('#word-dialog').showModal();h.drain();
  assert.equal(h.doc.activeElement,h.$('#word-dialog'));
  h.$('#word-dialog').close();h.$('#previous-chapter').onclick({detail:0});
  h.hide('visibilitychange');h.drain();assert.equal(h.focused.length,0);
});

test('bookmark persistence combines independent edits and a stale checkpoint preserves removals',()=>{
  const disk=new Map([['folio-v2',JSON.stringify({positions:{},bookmarks:{}})]]);
  const left=session(disk),right=session(disk);
  const first=pos(2,.2,0),second=pos(4,.4,1);
  const marks=()=>JSON.parse(disk.get('folio-v2')).bookmarks;
  left.c.state.bookmarks.test=[first];left.c.saveState();
  right.c.state.bookmarks.test=[second];right.c.saveState();
  assert.deepEqual(marks().test,[first,second]);
  left.c.state.bookmarks.test=[];left.c.saveState();
  right.c.saveState();
  assert.deepEqual(marks().test,[second]);
  left.c.saveState({deletedBook:'test'});
  assert.equal(marks().test,undefined);
});

test('leaving the reader dismisses its stacked sheets without losing the current place',()=>{
  const h=session();h.open(pos(6,.35));
  h.c.dismissWord=()=>h.$('#word-dialog').close();
  const sheets=['#word-dialog','#translation-dialog','#contents-dialog','#preferences'];
  for(const id of sheets)h.$(id).showModal();
  h.c.showHome('home');
  assert.equal(h.$('#reader').hidden,true);
  for(const id of sheets)assert.equal(h.$(id).open,false,id+' must not cover the shelf');
  assert.equal(h.read().paragraph,6);
  h.c.openBook('test');h.drain();
  assert.equal(h.c.paragraph,6);
});

test('verify single-paragraph scroll progress independently of a portable text anchor',()=>{
  const book={chapters:[{paragraphs:[{text:'A long note.'}]}]};
  const anchor={chapter:0,paragraph:0,fraction:.42},enriched={...anchor,soloScrollProgress:.55};
  assert.deepEqual(safePosition(enriched,book),enriched);
  for(const invalid of [null,'0.55',true,Infinity,-.01,1.01])
    assert.deepEqual(safePosition({...anchor,soloScrollProgress:invalid},book),anchor);
  assert.deepEqual(safePosition({...anchor,soloScrollProgress:1},book),{...anchor,soloScrollProgress:1});
  assert.deepEqual(safePosition(enriched,{kind:'comic',chapters:book.chapters}),anchor);
  assert.deepEqual(safePosition(enriched,{chapters:[...book.chapters,...book.chapters]}),anchor);
});
