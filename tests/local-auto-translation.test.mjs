import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createAutoTranslationPreferences,supportsTranslation,translationPack} from '../dist/local-translation.js';

const app=readFileSync(process.env.FOLIO_AUTO_TEST_APP||new URL('../dist/app.js',import.meta.url),'utf8');
function part(left,right){
  const i=app.indexOf(left),j=app.indexOf(right,i+left.length);
  assert.ok(i>=0&&j>i,left);return app.slice(i,j);
}
const noop=()=>{};
const makeBook=(id,createdAt=12)=>({id,createdAt,title:'Test book',language:'en',chapters:[
  {paragraphs:[{text:'A river crossed the city.'},{text:'The boats waited in the harbour.'},{text:'The letter finally came.'}]}
]});
function session(disk=new Map(),models=new Set(),books=[makeBook('book-one'),makeBook('book-two')],cache=null){
  let dialogs=0,stops=0,pending=null;
  const nodes=new Map(),events={},winEvents={},docEvents={},calls=[],scheduled=new Map(),transient=new Map();
  const makeNode=(text='',className='')=>({
    textContent:text,className,children:[],classList:{add:noop,remove:noop,toggle:noop},
    hidden:false,open:false,dataset:{},style:{},setAttribute:noop,toggleAttribute:noop,removeAttribute:noop,
    replaceChildren(...children){this.children=children[0]?.fragment?children[0].children:children;},
    append(...children){this.children.push(...children);for(const child of children)child.remove=()=>{this.children=this.children.filter(el=>el!==child)};},
    querySelector(selector){return this.children.find(child=>child.className===selector.slice(1))||null;},
    get lastElementChild(){return this.children.at(-1);},addEventListener:(event,fn)=>{events[event]=fn;},
    showModal(){this.open=true;dialogs++;},close(){this.open=false;events.close?.();}
  });
  const $=sel=>{if(!nodes.has(sel))nodes.set(sel,makeNode());return nodes.get(sel);};
  $('#reader').hidden=true;
  const localStorage={getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)};
  const c={
    $,localStorage,createAutoTranslationPreferences,supportsTranslation,translationPack,current:null,books:[...books],
    chapter:0,paragraph:0,readerReturn:'home',homeView:'home',routeScroll:{},history:{state:{},pushState:noop},location:{hash:'#home'},
    state:{prefs:{readingLanguage:'en',dictionaryTarget:'ru'},positions:{},bookmarks:{}},
    node:(_tag,text,className)=>makeNode(text,className),
    document:{hidden:false,getElementById:()=>null,body:makeNode(),createDocumentFragment:()=>({...makeNode(),fragment:true}),
      addEventListener:(event,fn)=>{docEvents[event]=fn;}},
    window:{scrollY:0,addEventListener:(event,fn)=>{winEvents[event]=fn;}},
    queueMicrotask,
    createLocalTranslator:()=>({
      capabilities:()=>true, installed:async({source,target})=>models.has(source+'-'+target),
      modelStorage:async()=>({state:'missing'}), stop(){
        stops++;
        if(pending&&!c.keepStoppedResult){pending.reject(new DOMException('Aborted','AbortError'));pending=null;}
      },
      peek:(text,{target})=>transient.get(text+'-'+target),prime:(text,value,{target})=>transient.set(text+'-'+target,value),
      translate:async(text,{source,target,allowNetwork})=>{
        const pair=source+'-'+target;calls.push({text,pair,allowNetwork});
        if(c.deferNext){c.deferNext=false;await new Promise((resolve,reject)=>{pending={resolve,reject};});}
        if(c.fail===text)throw Error('length');
        if(allowNetwork)models.add(pair);
        if(!models.has(pair))throw Error('not-installed');
        const result='Translation ('+target+'): '+text;transient.set(text+'-'+target,result);return result;
      }
    }),
    formatBytes:()=> '15 МБ',modelDownloadLabel:()=> 'Скачать модель',
    sourceLanguage:(_text,language)=>language,readingSourceLanguage:book=>book.language,knownLanguage:x=>x,
    pairCode:(a,b)=>a+'-'+b, isComic:()=>false, returnRoute:()=>'home',resetWordView:noop,
    cancelMotion:noop, setChromeColor:noop, renderStarterEdition:noop, saveState:noop,
    readingHome:{enterReader:noop}, revealMotion:noop, dismissWord:noop,capturePosition:noop,closeComicView:noop,
    renderChapter(pos){c.chapter=pos.chapter;c.paragraph=pos.paragraph;c.syncTranslation()},
    safePosition:pos=>pos, clearTimeout:cb=>scheduled.delete(cb),
    setTimeout:(cb,ms)=>{const task=()=>cb();scheduled.set(task,ms);return task;},
    dictUI:{selectPair:noop},touchRibbon:null,programmaticRibbonLeft:0,toast:noop,
    DEMO_ID:'demo',db:cache,clearTextBookTranslations:noop,
    translationRevision:(_source,target)=>target,
    prepareParagraphCache:async(_db,loc,revision)=>({id:loc.book.id+'|'+loc.ci+'|'+loc.pi+'|'+revision,text:loc.p.text}),
    readParagraphCache:async(db,entry)=>db.get(entry.id),writeParagraphCache:async(db,entry,value)=>db.set(entry.id,value),
    dbAction:async(_mode,job)=>job({delete:noop}),renderPersonalShelf:noop
  };
  runInNewContext([
    part('async function deleteBook(book)', 'function renderPersonalShelf()'),
    part('function openBook(id,explicit', 'let comicView='),
    part('let ribbonBook=null', 'function markExploring()'),
    part('let languageUI=null;', 'const dictUI=dictionaryControls'),
    part("$('#translation-full').onclick=", ";$('#word-save').onclick=")
  ].join('\n'),c);
  return {c,$,disk,models,calls,get dialogs(){return dialogs;},get stops(){return stops;},
    rejectLate(e){pending?.reject(e);pending=null;},
    resolveLate(){pending?.resolve();pending=null;},
    hide(){c.document.hidden=true;docEvents.visibilitychange?.({});},
    show(){c.document.hidden=false;docEvents.visibilitychange?.({});},
    pagehide(){winEvents.pagehide?.({persisted:true});},
    pageshow(){winEvents.pageshow?.({persisted:true});},
    open(id='book-one',paragraph=0){c.openBook(id,{chapter:0,paragraph,fraction:0});},
    select(paragraph){c.paragraph=paragraph;c.syncTranslation();},
    async drain(){for(let task;scheduled.size;){task=[...scheduled.keys()][0];scheduled.delete(task);await task();}}
  };
}

test('reader opt-in survives a cold open: no popup and no download until a tap',async()=>{
  const h=session();h.open();await h.drain();
  assert.equal(h.dialogs,0);assert.deepEqual(h.calls,[]);
  h.$('#translation-full').onclick();
  assert.equal(h.dialogs,1);assert.deepEqual(h.calls,[]);
  h.$('#local-translation-start').onclick();await h.drain();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].allowNetwork,true);
  const fresh=session(h.disk,h.models);
  fresh.open('book-one',1);await fresh.drain();
  assert.equal(fresh.dialogs,0);
  assert.deepEqual(fresh.calls,[{text:'The boats waited in the harbour.',pair:'en-ru',allowNetwork:false}]);
  assert.match(fresh.$('#translation-track').querySelector('.translation-empty').textContent,/Translation \(ru\)/u);
  assert.equal(fresh.$('#local-translation-open').textContent,'Пауза');
  fresh.$('#local-translation-open').onclick();
  const paused=session(h.disk,h.models);paused.open('book-one',2);await paused.drain();
  assert.equal(paused.dialogs,0);assert.deepEqual(paused.calls,[]);
});

test('reader remembers independent permissions by book and normalized language pair',async()=>{
  const h=session();h.open();h.$('#local-translation-open').onclick();h.$('#local-translation-start').onclick();await h.drain();
  const fresh=session(h.disk,h.models);fresh.open('book-two');await fresh.drain();
  assert.deepEqual(fresh.calls,[]);
  fresh.open();fresh.c.saveLanguagePrefs({dictionaryTarget:'hi'});fresh.select(0);await fresh.drain();
  assert.deepEqual(fresh.calls,[]);assert.equal(fresh.dialogs,0);
  fresh.c.saveLanguagePrefs({dictionaryTarget:'ru'});fresh.select(0);await fresh.drain();
  assert.equal(fresh.calls.length,1);assert.equal(fresh.calls[0].pair,'en-ru');
  const replacement=session(h.disk,h.models,[makeBook('book-one',13)]);
  replacement.open();await replacement.drain();assert.deepEqual(replacement.calls,[]);
  await fresh.c.deleteBook(fresh.c.books[0]);
  const reAdded=session(h.disk,h.models);reAdded.open();await reAdded.drain();assert.deepEqual(reAdded.calls,[]);
});

test('evicted model never downloads or reopens the dialog automatically; an explicit retry works',async()=>{
  const h=session();h.open();h.$('#local-translation-open').onclick();h.$('#local-translation-start').onclick();await h.drain();
  const fresh=session(h.disk,new Set());fresh.open('book-one',1);await fresh.drain();
  assert.equal(fresh.dialogs,0);
  assert.deepEqual(fresh.calls,[{text:'The boats waited in the harbour.',pair:'en-ru',allowNetwork:false}]);
  assert.equal(fresh.$('#local-translation-open').textContent,'Повторить');
  fresh.select(2);await fresh.drain();assert.equal(fresh.calls.length,1);
  fresh.$('#local-translation-open').onclick();fresh.$('#local-translation-start').onclick();await fresh.drain();
  assert.equal(fresh.dialogs,1);assert.equal(fresh.calls.at(-1).allowNetwork,true);
  assert.match(fresh.$('#translation-track').querySelector('.translation-empty').textContent,/Translation \(ru\)/u);
});

test('an overlong paragraph does not turn off autotranslate or create a retry loop',async()=>{
  const h=session();h.open();h.$('#local-translation-open').onclick();h.$('#local-translation-start').onclick();await h.drain();
  const fresh=session(h.disk,h.models);fresh.c.fail='The boats waited in the harbour.';fresh.open('book-one',1);await fresh.drain();
  assert.equal(fresh.calls.length,1);assert.equal(fresh.dialogs,0);
  fresh.select(2);await fresh.drain();assert.equal(fresh.calls.length,2);
  assert.equal(fresh.calls[1].allowNetwork,false);
});

test('dirty, oversized or unavailable preference storage never implicitly grants translation',()=>{
  const book=makeBook('book-one');
  const storage={getItem:()=>JSON.stringify([['book-one',12,['en-ru']],['book-one',-1,'en-ru'],['book-one',12,'__proto__']]),setItem(){throw Error('quota');}};
  const pref=createAutoTranslationPreferences(()=>storage);
  assert.equal(pref.has(book,'en','ru'),false);
  assert.equal(pref.set(book,'EN-US','ru',true),false);
  assert.equal(pref.has(book,'en','ru'),true);
  assert.equal(pref.has(book,'en','hi'),false);
  assert.equal(createAutoTranslationPreferences(()=>storage).has(book,'en','ru'),false);
  assert.equal(createAutoTranslationPreferences(()=>({getItem:()=> ' '.repeat(66_000)+JSON.stringify([['book-one',12,'en-ru']])})).has(book,'en','ru'),false);
});


const turn=()=>new Promise(setImmediate);
async function optedIn(){
  const h=session();h.open();h.$('#translation-full').onclick();h.$('#local-translation-start').onclick();await h.drain();return h;
}

test('backgrounding never starts a queued paragraph; returning translates only the newest position offline',async()=>{
  const h=await optedIn(),fresh=session(h.disk,h.models);
  fresh.open();fresh.hide();fresh.select(1);
  await fresh.drain();assert.deepEqual(fresh.calls,[]);
  fresh.show();await turn();await fresh.drain();
  assert.deepEqual(fresh.calls,[{text:'The boats waited in the harbour.',pair:'en-ru',allowNetwork:false}]);
  assert.equal(fresh.dialogs,0);
});

test('pagehide aborts the running paragraph and prevents its completion from starting work until pageshow',async()=>{
  const h=await optedIn(),fresh=session(h.disk,h.models);
  fresh.c.deferNext=true;fresh.open();
  const first=fresh.drain();await turn();assert.equal(fresh.calls.length,1);
  // Safari may deliver pagehide without a preceding visibilitychange.
  fresh.pagehide();await first;await fresh.drain();
  assert.equal(fresh.stops,1);assert.equal(fresh.calls.length,1);
  fresh.pageshow();await turn();await fresh.drain();
  assert.equal(fresh.calls.length,2);assert.ok(fresh.calls.every(x=>x.allowNetwork===false));
  assert.equal(fresh.dialogs,0);
});

test('a late result from the suspended worker cannot overwrite a failure for the resumed paragraph',async()=>{
  const h=await optedIn(),fresh=session(h.disk,new Set());
  fresh.c.keepStoppedResult=true;fresh.c.deferNext=true;fresh.open();
  const first=fresh.drain();await turn();assert.equal(fresh.calls.length,1);
  fresh.pagehide();fresh.select(1);fresh.pageshow();await turn();await fresh.drain();
  assert.equal(fresh.calls.length,2);
  assert.equal(fresh.$('#local-translation-open').textContent,'Повторить');
  fresh.rejectLate(Error('length'));await first;await turn();await fresh.drain();
  assert.equal(fresh.calls.length,2);assert.equal(fresh.$('#local-translation-open').textContent,'Повторить');
  assert.equal(fresh.dialogs,0);
});

test('a queued explicit click waits while hidden and resumes once on an ordinary tab switch',async()=>{
  const h=session();h.open();h.$('#translation-full').onclick();h.$('#local-translation-start').onclick();
  h.hide();await h.drain();assert.deepEqual(h.calls,[]);
  h.show();await turn();await h.drain();
  assert.deepEqual(h.calls,[{text:'A river crossed the city.',pair:'en-ru',allowNetwork:true}]);
  assert.equal(h.dialogs,1);
});

test('an interrupted model download is not silently restarted after pagehide',async()=>{
  const h=session();h.open();h.$('#translation-full').onclick();h.$('#local-translation-start').onclick();
  h.c.deferNext=true;const first=h.drain();await turn();
  assert.equal(h.calls[0].allowNetwork,true);
  h.pagehide();await first;await h.drain();
  assert.deepEqual(h.calls.map(x=>x.allowNetwork),[true],'no job restarted while the page was away');
  h.$('#translation-dialog').close();
  h.pageshow();await turn();await h.drain();
  assert.deepEqual(h.calls.map(x=>x.allowNetwork),[true,false]);
  assert.equal(h.$('#local-translation-open').textContent,'Повторить');
  assert.equal(h.dialogs,1,'return did not open the download panel again');
});

// Only app routing and model calls are exercised here; the separate Playwright
// harness is the gate for the real IndexedDB write/delete/restore transaction.
test('a cold-open reader puts cached paragraph text in the ribbon without fetching a model',async()=>{
  const books=[makeBook('book-one')],cache=new Map();
  const first=session(new Map(),new Set(),books,cache);
  first.open();first.$('#translation-full').onclick();first.$('#local-translation-start').onclick();await first.drain();
  assert.equal(first.calls.length,1);assert.equal(cache.size,1);
  const fresh=session(first.disk,new Set(),books,cache);
  fresh.open();await fresh.drain();
  assert.deepEqual(fresh.calls,[]);assert.equal(fresh.dialogs,0);
  assert.match(fresh.$('#translation-track').querySelector('.translation-empty').textContent,/Translation/);
});
test('switching paragraphs during a slow cache lookup does not translate the obsolete paragraph',async()=>{
  const books=[makeBook('book-one')],cache=new Map();
  const first=session(new Map(),new Set(),books,cache);
  first.open();first.$('#translation-full').onclick();first.$('#local-translation-start').onclick();await first.drain();
  const fresh=session(first.disk,first.models,books,cache);
  let done;
  fresh.c.readParagraphCache=async (_db,entry)=>{
    if(entry.id==='book-one|0|0|ru')return new Promise(resolve=>{done=resolve;});
    return null;
  };
  fresh.open();
  const work=fresh.drain();
  while(!done)await new Promise(setImmediate);
  fresh.select(1);done('old cached value');await work;await new Promise(setImmediate);
  assert.deepEqual(fresh.calls,[{text:'The boats waited in the harbour.',pair:'en-ru',allowNetwork:false}]);
  assert.match(fresh.$('#translation-track').querySelector('.translation-empty').textContent,/The boats/);
});


test('Pause stops an already-running automatic paragraph without painting the canceled result',async()=>{
  const h=await optedIn(),fresh=session(h.disk,h.models);
  fresh.c.deferNext=true;fresh.open('book-one',1);
  const work=fresh.drain();await turn();
  assert.deepEqual(fresh.calls,[{text:'The boats waited in the harbour.',pair:'en-ru',allowNetwork:false}]);
  const toggle=fresh.$('#local-translation-open');
  assert.equal(toggle.textContent,'Пауза');
  toggle.onclick();
  assert.equal(fresh.stops,1,'actively cancel the paused worker, not just its future schedule');
  await work;
  assert.equal(toggle.textContent,'Перевести');
  assert.equal(fresh.$('#translation-track').querySelector('.translation-empty').textContent,'Нет готового перевода.');
  fresh.select(2);await fresh.drain();
  assert.equal(fresh.calls.length,1,'no new automatic work after pause');
  fresh.$('#translation-full').onclick();fresh.$('#local-translation-start').onclick();await fresh.drain();
  assert.equal(fresh.calls.at(-1).text,'The letter finally came.');
  assert.equal(fresh.calls.at(-1).allowNetwork,true);
});

test('Pause does not abort a separate explicit translation already requested by the reader',async()=>{
  const h=session();h.open();h.$('#translation-full').onclick();h.$('#local-translation-start').onclick();
  h.c.deferNext=true;const work=h.drain();await turn();
  assert.equal(h.calls[0].allowNetwork,true);
  h.$('#translation-dialog').close();h.c.syncTranslation();
  h.$('#local-translation-open').onclick();
  assert.equal(h.stops,0);
  h.resolveLate();await work;
  assert.equal(h.$('#local-translation-open').textContent,'Продолжить');
  h.select(1);await h.drain();assert.equal(h.calls.length,1);
});
