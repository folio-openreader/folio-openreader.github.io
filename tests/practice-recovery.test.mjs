import test from 'node:test';
import assert from 'node:assert/strict';
import {keepCorrectPairs,spellingClue,missedPracticePages,buildPracticeLesson,validatePracticeLesson,gradeLearningTask} from '../dist/practice-engine.js';

const pairs=[{id:'p1',left:'ferry',right:'паром'},{id:'p2',left:'lantern',right:'фонарь'},{id:'p3',left:'ink',right:'чернила'}];
const slots=new Map(pairs.map(p=>[p.left,p.right]));
const stable=()=>.999;
const cards=pairs.map(p=>({id:'en:'+p.left,word:p.left,language:'en',target:'ru',meaning:p.right,context:'The '+p.left+' made him smile.'}));

test('matching repair locks only previously correct pairs and never modifies the inputs',()=>{
  const task=Object.freeze({kind:'match',pairs:Object.freeze(pairs)});
  const wrong=Object.freeze({p1:'p1',p2:'p3',p3:'p2'});
  const retained=keepCorrectPairs(task,wrong);
  assert.deepEqual(retained,{p1:'p1'});
  assert.equal(gradeLearningTask(task,retained).score,1/3);
  assert.deepEqual(gradeLearningTask(task,{...retained,p2:'p2',p3:'p3'}),{correct:true,score:1});
  for(const v of [undefined,null,'p1',Object.create({p1:'p1'}),{p1:'p2',stranger:'stranger'}])assert.deepEqual(keepCorrectPairs(task,v),{});
  assert.deepEqual(wrong,{p1:'p1',p2:'p3',p3:'p2'});
});

test('spelling hints preserve letters and accents without giving away a single-letter answer',()=>{
  assert.deepEqual(spellingClue('café','fr'),{initial:'c',letters:4});
  assert.deepEqual(spellingClue('e\u0301te\u0301','fr'),{initial:'é',letters:3});
  assert.deepEqual(spellingClue("l’été",'fr'),{initial:'l',letters:4});
  assert.deepEqual(spellingClue('a-ha','en'),{initial:'a',letters:3});
  assert.deepEqual(spellingClue('ёжи','ru'),{initial:'ё',letters:3});
  assert.equal(spellingClue('a','en'),null);assert.equal(spellingClue(null,'en'),null);
});

test('focused replay keeps only missed steps and changes position without changing valid answers',()=>{
  const doc=buildPracticeLesson(cards,{random:stable});
  const indices=doc.pages.flatMap((p,i)=>p.task.kind==='typed'?[]:[i]);
  const before=JSON.stringify(doc);
  const replay=missedPracticePages(doc.pages,new Set([...indices].reverse()),stable);
  assert.deepEqual(replay.map(p=>p.id),indices.map(i=>doc.pages[i].id));
  assert.deepEqual(missedPracticePages(doc.pages,new Set(),stable),[]);
  validatePracticeLesson({...doc,pages:replay});
  for(const page of replay){
    const old=doc.pages[Number(page.id.split('-').pop())-1].task, t=page.task;
    if(t.kind==='match'){
      assert.notDeepEqual(t.pairs,old.pairs);
      assert.ok(t.pairs.every(p=>slots.get(p.left)===p.right));
      assert.equal(gradeLearningTask(t,Object.fromEntries(t.pairs.map(p=>[p.id,p.id]))).correct,true);
    }else{
      assert.notEqual(t.options.findIndex(o=>o.id===t.correctId),old.options.findIndex(o=>o.id===old.correctId));
      assert.equal(gradeLearningTask(t,t.correctId).correct,true);
    }
  }
  assert.equal(JSON.stringify(doc),before);
});
