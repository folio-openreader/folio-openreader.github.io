import test from 'node:test';
import assert from 'node:assert/strict';
import {loadLearning,trackWord,review,markKnown,packLearning} from '../dist/learning-core.js';
import {rankPracticeWords as rank,rememberStudyWords as remember,recallQueue} from '../dist/practice-planning.js';
import {buildPracticeLesson as build} from '../dist/practice-engine.js';
const NOW=1710000000000, DAY=86400000, m=60000;
const words=(state,n)=>Array.from({length:n},(_,i)=>trackWord(state,'word'+String.fromCharCode(97+i),'en',NOW-3*DAY+i));
const keys=list=>list.map(r=>r.key);

test('adaptive ranking starts with due lapses, then due words, cooldowns, learning and known',()=>{
  const state=loadLearning(null,[]),[lapsed,due,cooling,learning,known]=words(state,5);
  review(lapsed,{recalled:false,now:NOW-20*m});
  review(cooling,{recalled:false,now:NOW-m});
  review(learning,{recalled:true,now:NOW-m});
  markKnown(known,NOW-m);
  const before=JSON.stringify(packLearning(state));
  assert.deepEqual(rank([known,learning,cooling,due,lapsed],{now:NOW,recent:[lapsed.key]}),[lapsed,due,cooling,learning,known]);
  assert.equal(JSON.stringify(packLearning(state)),before);
  assert.deepEqual(recallQueue([known,learning,cooling,lapsed,due],{now:NOW}),[lapsed,due]);
  assert.deepEqual(recallQueue([undefined,cooling,due],{now:NOW,limit:1}),[due]);
});

test('repeat practice rotates equally urgent words and caps recent history, not the ledger',()=>{
  const records=words(loadLearning(null,[]),12),first=rank(records,{now:NOW,limit:8});
  const recent=remember([],keys(first)),next=rank(records,{now:NOW,recent,limit:8});
  assert.equal(next.filter(r=>!recent.includes(r.key)).length,4);
  assert.deepEqual(rank(records,{now:NOW,recent,limit:8}),next);
  assert.equal(remember(Array.from({length:40},(_,n)=>'x'+n),[first[0].key]).length,32);
  assert.deepEqual(remember(['a','b','c'],['a','a','c']),['b','a','c']);
});

test('at most one fresh slot displaces an already drilled urgent card in an eight-word series',()=>{
  const [fresh,...urgent]=words(loadLearning(null,[]),10);
  urgent.forEach(r=>review(r,{recalled:false,now:NOW-40*m}));
  const ranked=rank([fresh,...urgent],{now:NOW,recent:keys(urgent),limit:8});
  assert.ok(ranked.slice(0,7).every(r=>r.lapsed));
  assert.equal(ranked[7],fresh);
});

test('engine respects automatic candidate membership while allowing option order to change, and leaves manual selection intact',()=>{
  const cards=words(loadLearning(null,[]),12).map((r,i)=>({...r,id:r.key,meaning:'значение '+i,target:'ru'}));
  const all=build(cards,{random:()=>0,preservePriority:true});
  assert.deepEqual(new Set(keys(all.words.map(w=>({key:w.id})))),new Set(keys(cards.slice(0,8))));
  const explicit=build(cards,{selectedIds:[cards[11].id],preservePriority:true});
  assert.deepEqual(explicit.words.map(w=>w.id),[cards[11].id]);
});
