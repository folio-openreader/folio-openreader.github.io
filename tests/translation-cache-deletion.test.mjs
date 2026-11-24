import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalTranslator} from '../dist/local-translation.js';
const legacy='folio-local-paragraphs-v1', durable='folio-local-paragraphs-v2', anchor='folio-local-paragraphs-generation-v2';
const options=disk=>{let tail=Promise.resolve(),id=0;return {uuid:()=>String(++id),
  locks:()=>({request(_name,fn){const work=tail.then(fn);tail=work.catch(()=>{});return work}}),
  storage:()=>({getItem:k=>disk.get(k),setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)})}};
const pack='folio-bergamot-en-ru-2.1-packed';
const key=(scope,text)=>JSON.stringify([scope,pack,text]);
test('two separately hydrated tabs do not resurrect either removed book',async()=>{
  const disk=new Map([[anchor,'0'],[durable,JSON.stringify({generation:'0',deleted:[],rows:[[key('A','original A'),'translation A'],[key('B','original B'),'translation B'],[key('C','keep C'),'safe C']]})]]);
  const opts=options(disk),a=createLocalTranslator(opts),b=createLocalTranslator(opts);
  assert.equal(a.peek('original A',{scope:'A'}),'translation A');
  assert.equal(b.peek('original B',{scope:'B'}),'translation B');
  await Promise.all([a.forgetScope('A'),b.forgetScope('B')]);
  assert.equal(a.peek('original B',{scope:'B'}),undefined);
  assert.equal(b.peek('original A',{scope:'A'}),undefined);
  assert.doesNotMatch([...disk.values()].join(),/original A|translation A|original B|translation B/);
  assert.equal(createLocalTranslator(opts).peek('keep C',{scope:'C'}),'safe C');
});

test('legacy snapshot is purged rather than migrated and stale v2 rows need a present generation',()=>{
  const row=[[key('A','original A'),'translation A']];
  const disk=new Map([[legacy,JSON.stringify(row)],[durable,JSON.stringify({generation:'old',deleted:[],rows:row})]]);
  const translator=createLocalTranslator(options(disk));
  assert.equal(translator.peek('original A',{scope:'A'}),undefined);
  assert.equal(disk.has(legacy),false);
});
test('quota failure while deleting fails closed and drops rather than retaining the stale persistent cache',async()=>{
  const row=[[key('A','original A'),'translation A']];
  const disk=new Map([[anchor,'g'],[durable,JSON.stringify({generation:'g',deleted:[],rows:row})]]);
  const opts=options(disk),base=opts.storage;
  opts.storage=()=>({...base(),setItem(){throw new DOMException('quota','QuotaExceededError')}});
  const a=createLocalTranslator(opts);assert.equal(a.peek('original A',{scope:'A'}),'translation A');
  await a.forgetScope('A');
  assert.equal(a.peek('original A',{scope:'A'}),undefined);
  assert.equal(disk.has(anchor),false);assert.equal(disk.has(durable),false);
});

test('deletion without a lock manager clears a prior durable cache rather than leaving deleted content',async()=>{
  const row=[[key('A','original A'),'translation A']];
  const disk=new Map([[anchor,'g'],[durable,JSON.stringify({generation:'g',deleted:[],rows:row})]]);
  const opts=options(disk);opts.locks=()=>null;
  const a=createLocalTranslator(opts);
  assert.equal(a.peek('original A',{scope:'A'}),'translation A');
  await a.forgetScope('A');
  assert.equal(a.peek('original A',{scope:'A'}),undefined);
  assert.equal(disk.has(anchor),false);assert.equal(disk.has(durable),false);
});
