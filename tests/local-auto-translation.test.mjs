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
function session(disk=new Map(),models=new Set(),books=[makeBook('book-one'),makeBook('book-two')]){
  let dialogs=0;
  const nodes=new Map(),events={},calls=[],scheduled=new Map(),transient=new Map();
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
    document:{getElementById:()=>null,body:makeNode(),createDocumentFragment:()=>({...makeNode(),fragment:true})},
    window:{scrollY:0,addEventListener:(event,fn)=>{events[event]=fn;}},
    createLocalTranslator:()=>({
      capabilities:()=>true, installed:async({source,target})=>models.has(source+'-'+target),
      modelStorage:async()=>({state:'missing'}), stop:noop,
      peek:(text,{target})=>transient.get(text+'-'+target),
      translate:async(text,{source,target,allowNetwork})=>{
        const pair=source+'-'+target;calls.push({text,pair,allowNetwork});
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
    DEMO_ID:'demo',dbAction:async(_mode,job)=>job({delete:noop}),renderPersonalShelf:noop
  };
  runInNewContext([
    part('async function deleteBook(book)', 'function renderPersonalShelf()'),
    part('function openBook(id,explicit', 'let comicView='),
    part('let ribbonBook=null', 'function markExploring()'),
    part('let languageUI=null;', 'const dictUI=dictionaryControls'),
    part("$('#translation-full').onclick=", ";$('#word-save').onclick=")
  ].join('\n'),c);
  return {c,$,disk,models,calls,get dialogs(){return dialogs;},
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
