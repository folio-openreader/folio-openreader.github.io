import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPracticeLesson as build,validatePracticeLesson as validate,gradeLearningTask as grade,taskLanguages,
  linkedLeftId,selectMatchTile,orderMatchTiles,contextBlank,PRACTICE_LIMITS as L} from '../dist/practice-engine.js';
import {makePracticeCard} from '../dist/practice-core.js';
import {loadLearning,trackWord,packLearning} from '../dist/learning-core.js';

const seed = s => () => ((s=(1664525*s+1013904223)>>>0)/2**32);
const card=(word,meaning,overrides={}) => ({
  ...makePracticeCard({key:'en:'+word,word,language:'en'}, {headword:word,entries:[{translation:meaning}]}),
  target:'ru',...overrides
});
const cards=()=>[card('fern','папоротник',{context:'A fern grew under the window.'}),card('pebble','камешек'),
  card('candle','свеча'),card('bridge','мост'),card('harbor','гавань'),card('orchard','фруктовый сад'),
  card('porch','крыльцо'),card('ink','чернила')];
const docFor=(items=cards(),n=3)=>build(items,{random:seed(n)});
const tasks=(d,k)=>d.pages.map(p=>p.task).filter(t=>!k||t.kind===k);
const answer=t=>t.kind==='match'?Object.fromEntries(t.pairs.map(p=>[p.id,p.id])):t.kind==='typed'?t.expected:t.correctId;

test('real Folio cards produce a strict practice-only JSON lesson; every shown word is tested, not just an option',()=>{
  const d=docFor(); assert.equal(d.schemaVersion,1);assert.equal(d.format,'folio.practice');
  const round=JSON.parse(JSON.stringify(d));assert.deepEqual(validate(round),d);
  assert.equal(d.words.length,8);assert.ok(d.pages.every(p=>p.kind==='practice'));
  assert.deepEqual(new Set(tasks(d).map(t=>t.kind)),new Set(['choice','cloze','match','typed']));
  const covered=new Set();
  for(const t of tasks(d)){
    assert.deepEqual(grade(t,answer(t),taskLanguages(d,t)),{correct:true,score:1});
    if(t.kind==='match') t.pairs.forEach(p=>covered.add(p.left));
    else covered.add(d.words[Number(t.id.match(/^w(\d+)-/)[1])-1].word);
  }
  assert.deepEqual(covered,new Set(d.words.map(w=>w.word)));
});

test('selected IDs are a hard allowlist even for foils, cloze and metadata; empty/unresolved yields no lesson',()=>{
  const items=cards(), sel=[items[0].id,items[3].id];
  const d=build(items,{selectedIds:sel,random:seed(4)});
  assert.deepEqual(new Set(d.words.map(w=>w.id)),new Set(sel));
  const content=JSON.stringify(d);
  for(const other of items.filter(c=>!sel.includes(c.id))) {
    assert.equal(content.includes(other.word),false); assert.equal(content.includes(other.meaning),false);
  }
  assert.equal(build(items,{selectedIds:[]}),null); assert.equal(build(items,{selectedIds:new Set(['absent'])}),null);
  for (const invalid of [null,[],[null],[{id:'en:q',word:'q',meaning:''}],[{...items[0],target:'garbled!!!'}]]) assert.equal(build(invalid),null);
  const one=docFor([items[0]]); assert.deepEqual(tasks(one).map(t=>t.kind),['typed']);
  const without=docFor(items.map(c=>({...c,context:undefined}))); assert.equal(tasks(without,'cloze').length,0);
});

test('no alias collisions in choices or pairs, even with a hidden shared dictionary sense or common lemma',()=>{
  const items=[card('shore','берег',{meaningKeys:new Set(['берег','отмель'])}),
    card('bank','банк',{meaningKeys:new Set(['банк','берег'])}),card('banks','банки',{head:'bank'}),
    card('shoal','мель / отмель'),card('pan','сковорода')];
  const conflicts=[['shore','bank'],['bank','banks'],['shore','shoal']];
  for(let n=1;n<=16;n++) {
    const d=docFor(items,n);
    for(const t of tasks(d).filter(t=>t.kind==='choice'||t.kind==='match')) {
      const shown=t.kind==='match'?t.pairs.map(p=>p.left):t.options.map(o=>items.find(c=>c.meaning===o.label).word);
      for(const [a,b] of conflicts) assert.ok(!(shown.includes(a)&&shown.includes(b)),a+' / '+b);
    }
  }
});
test('ambiguous single-gloss synonyms never become distractors; typed task identifies the stored form',()=>{
  const d=docFor([card('road','дорога'),card('way','дорога')]);
  assert.ok(tasks(d).every(t=>t.kind==='typed'&&t.prompt.includes('Форма из книги:')));
  const inflected=docFor([card('went','идти',{head:'go'})]);assert.match(tasks(inflected)[0].prompt,/Форма из книги:/);
  assert.equal(build([card('a','буква'),card('b','буква')]),null);
  assert.equal(build([card('bloom','bloom means to flower',{target:'en'})]),null);
});

test('context cloze uses an exact single token from a real sentence, preserves case, and never invents one',()=>{
  assert.deepEqual(contextBlank('Done. Under the arch, Fern grew.','fern','en'),
    {before:'Under the arch, ',surface:'Fern',after:' grew.'});
  assert.deepEqual(contextBlank('Look: l’été est proche.','l\'été','fr'),{before:'Look: ',surface:'l’été',after:' est proche.'});
  for(const c of ['An inferno is hot.','The fern-like shape.','A fern near a fern.','fern.','x'.repeat(8500)]) assert.equal(contextBlank(c,'fern','en'),null);
  const c=tasks(docFor(),'cloze')[0];
  assert.equal(c.before+c.options.find(o=>o.id===c.correctId).label+c.after,'A fern grew under the window.');
});

test('mixed-language/grouped sessions never mix language pairs inside a task',()=>{
  const items=[...cards().slice(0,3),card('сад','garden',{language:'ru',target:'en',id:'ru:сад'}),
    card('мост','bridge',{language:'ru',target:'en',id:'ru:мост'}),card('sun','the star that lights Earth',{target:'en'})];
  const d=docFor(items);
  for(const t of tasks(d)){
    const {source,target}=taskLanguages(d,t),group=d.words.filter(w=>w.language===source&&w.target===target);
    if(t.kind==='choice')assert.ok(t.options.every(o=>group.some(w=>o.label===w.meaning)));
    if(t.kind==='match')assert.ok(t.pairs.every(p=>group.some(w=>w.word===p.left&&w.meaning===p.right)));
    if(t.kind==='typed')assert.ok(group.some(w=>w.word===t.expected));
  }
  assert.equal(d.words.length,6);
});

test('typed grading respects NFC, case, local keyboards and language, not accents, homophones or substrings',()=>{
  const t={kind:'typed',expected:'café'}; assert.equal(grade(t,'  CAFE\u0301 ').correct,true);
  for(const wrong of ['cafe','café!','café au lait','the café',null,42,['café'],'']) assert.equal(grade(t,wrong).correct,false);
  assert.equal(grade({kind:'typed',expected:"l'été"},'L’ÉTÉ').correct,true);
  assert.equal(grade({kind:'typed',expected:'a-ha'},'a‑ha').correct,true);
  assert.equal(grade({kind:'typed',expected:'всё'},'все').correct,false);
  assert.equal(grade({kind:'typed',expected:'ışık'},'IŞIK',{source:'tr'}).correct,true);
});

test('Gradelyy linked tile behavior: bidirectional, editable, cancellable; Check only grades the final mapping',()=>{
  const t=tasks(docFor(),'match')[0], [a,b,c,d]=t.pairs.map(p=>p.id);
  const left=id=>({side:'left',id}), right=id=>({side:'right',id});
  const run=(...tiles)=>tiles.reduce((s,t)=>selectMatchTile(s.value,s.pending,t),{value:{},pending:null});
  const linked=run(right(b),left(a));assert.deepEqual(linked,{value:{[a]:b},pending:null});
  assert.deepEqual(run(left(a),left(a)),{value:{},pending:null});
  assert.deepEqual(run(left(a),left(b)),{value:{},pending:left(b)});
  assert.equal(linkedLeftId(linked.value,right(b)),a);
  assert.deepEqual(selectMatchTile(Object.freeze(linked.value),left(c),right(b)),{value:{},pending:right(b)});
  assert.deepEqual(grade(t,{[a]:a,[b]:b,[c]:d,[d]:c}),{correct:false,score:.5});
  assert.deepEqual(grade(t,{...answer(t),bogus:'x'}),{correct:false,score:1}); // upstream rule
  assert.equal(grade(t,Object.create(answer(t))).correct,false);
  const sorted=orderMatchTiles(t.pairs);assert.deepEqual(sorted,orderMatchTiles(t.pairs));
  assert.notDeepEqual(sorted,t.pairs);assert.deepEqual(new Set(sorted),new Set(t.pairs));
  const positions=n=>{const ps=tasks(docFor(cards(),n),'match')[0].pairs;return orderMatchTiles(ps).map(p=>ps.indexOf(p)).join('');};
  assert.ok(new Set([1,2,3,4,5,6,7,8,9,10].map(positions)).size>1,'a learner cannot use the same index permutation each session');
});

test('validator rejects unknown behavior, extra fields, invalid focus/keys, lookalike options and fake/ambiguous gaps',()=>{
  const good=docFor();
  const edits=[d=>{d.schemaVersion=7},d=>{d.format='gradelyy.course'},d=>{d.pages[0].kind='teach'},d=>{d.pages[0].task.url='http://unused'},
    d=>{d.pages[0].task.kind='html'},d=>{d.pages[0].task.id='__proto__'},d=>{d.pages[0].id=d.pages[1].id},
    d=>{tasks(d,'typed')[0].expected='not in bank'},d=>{tasks(d,'choice')[0].correctId='missing'},
    d=>{const t=tasks(d,'choice')[0];t.correctId=t.options.find(o=>o.id!==t.correctId).id},
    d=>{const t=tasks(d,'choice')[0];t.options[0].label=t.options[1].label},
    d=>{const t=tasks(d,'match')[0];t.pairs[0].right=t.pairs[1].right},
    d=>{const t=tasks(d,'cloze')[0];t.before='infer';t.after='no is here but a fern grew.'},
    d=>{d.words.push(...Array(10).fill(d.words[0]))},d=>{d.words[0].meaning='\u202eabc'},d=>{delete d.pages[0]}];
  for(const op of edits){const d=structuredClone(good);op(d);assert.throws(()=>validate(d),/Invalid practice lesson/);}
  const max240={...cards()[0],meaning:'ю'.repeat(240)};
  assert.doesNotThrow(()=>validate(docFor([max240])));assert.equal(docFor([{...max240,meaning:'ю'.repeat(241)}]),null);
});

test('planner scales within budgets and produces reproducible, diverse, round-trippable lessons under varying samples',()=>{
  for(let n=0;n<100;n++){
    const items=cards().slice(0,1+n%8).map((c,i)=>({...c,target:n%3===0&&i%3===0?'en':c.target,context:n%2===0?'':c.context}));
    const d=docFor(items,n);assert.deepEqual(d,docFor(items,n));assert.equal(validate(JSON.parse(JSON.stringify(d))).pages.length,d.pages.length);
    assert.ok(d.pages.length>=1&&d.pages.length<=L.pages&&d.words.length<=L.words);
  }
  assert.equal(docFor(Array.from({length:50},(_,i)=>({...cards()[0],id:'w'+i,word:'fern'+String.fromCharCode(97+i%26)}))).words.length,8);
});
test('building and scoring every type has no side effects on the saved spaced-recall evidence',()=>{
  const state=loadLearning(null,[],1700000000), picked=cards();
  for(const c of picked)trackWord(state,c.word,c.language,1700000000);
  const before=JSON.stringify(packLearning(state)), d=docFor(picked), json=JSON.stringify(d);
  for(const t of tasks(d)) {grade(t,answer(t));grade(t,null);}
  assert.equal(JSON.stringify(packLearning(state)),before);assert.equal(JSON.stringify(d),json);
  assert.ok(!/nextReviewAt|lastActionAt|wins|createdAt|meaningKeys|bookId/u.test(json));
});
