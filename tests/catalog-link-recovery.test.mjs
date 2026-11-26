import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
const create=app.indexOf('function readHash()');
const stop=app.indexOf("window.addEventListener('hashchange',readHash);",create);
const maybeHelper=app.lastIndexOf('function recoverCatalogLink(',create);
assert.ok(create>=0&&stop>create);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const kinds={starter:'starter-peter-rabbit',research:'research-fixture',news:'news-fixture'};

function fixture(kind,{cached=false}={}){
  const id=kinds[kind],hash='#read/'+id,nav=[],hints=[],calls=[],categories=[],replacements=[];
  const requests=[];
  const env={location:{hash},history:{replaceState(_state,_title,next){env.location.hash=next;replacements.push(next)}},
    current:null,readerBackPending:false,books:cached?[{id}]:[],starterIntent:0,editorialIntent:0,DEMO_ID:'folio-night-ferry',
    $:()=>({hidden:true}),isStarterId:s=>s.startsWith('starter-'),
    editorialKind:s=>s.startsWith('research-')?'research':s.startsWith('news-')?'news':null,
    showHome:(route,options)=>nav.push([route,Boolean(options?.focus)]),homeRoute:()=>env.location.hash.slice(1),
    setCatalogKind:kind=>categories.push(kind),openBook:book=>calls.push(['open',book]),
    toast:msg=>hints.push(msg),returnRoute:()=>'home'};
  function load(book,family){
    env.starterIntent++;env.editorialIntent++;calls.push([family,book]);
    return new Promise((_resolve,reject)=>requests.push(reject));
  }
  env.openStarterBook=book=>load(book,'starter');env.openEditorialBook=book=>load(book,'editorial');
  runInNewContext(app.slice(maybeHelper>=0?maybeHelper:create,stop),env);
  return {id,env,nav,hints,categories,replacements,calls,requests,hash};
}

for(const kind of ['starter','research','news'])test('failed catalog deep link lands on the correct retryable shelf: '+kind,async()=>{
  const f=fixture(kind);f.env.readHash();assert.equal(f.env.location.hash,f.hash);
  f.requests[0](Error('network unavailable'));await tick();
  assert.equal(f.env.location.hash,'#library');
  assert.deepEqual(f.replacements,['#library']);assert.deepEqual(f.categories,[kind==='starter'?'books':kind]);
  assert.deepEqual(f.nav,[['home',false],['library',true]]);
  assert.match(f.hints[0],/Не удалось загрузить/);
  f.env.readHash(); // A refresh/route restoration now opens the shelf, not the failed ebook.
  assert.equal(f.calls.length,1);
});

test('late catalog rejection never overrides a different page or a newer reader intent',async()=>{
  const f=fixture('starter');f.env.readHash();
  f.env.location.hash='#profile';f.requests[0](Error('old link'));await tick();
  assert.deepEqual(f.replacements,[]);assert.deepEqual(f.hints,[]);
  const g=fixture('research');g.env.readHash();
  g.env.openEditorialBook('news-newer');g.requests[0](Error('old request, same hash'));await tick();
  assert.equal(g.env.location.hash,g.hash);assert.deepEqual(g.replacements,[]);assert.deepEqual(g.hints,[]);
});

test('a downloaded edition still opens locally without taking the catalog path',()=>{
  const f=fixture('starter',{cached:true});f.env.readHash();
  assert.deepEqual(f.calls,[['open',f.id]]);assert.deepEqual(f.replacements,[]);
  assert.equal(f.env.location.hash,f.hash);
});
