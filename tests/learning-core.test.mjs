import test from 'node:test';
import assert from 'node:assert/strict';
import {bookStats, due, encounterCount, getWord, LEARNING_LIMITS as LIM, loadLearning, markKnown, mergeLearning,
  detachWord,normalizeWord,noteLookup,packLearning,passageCount,recordEncounter,removeWord,resumeLearning,review,stage,stats,trackWord,wordKey} from '../dist/learning-core.js';

const T=1700000000000,D=86400000,M=600000;
const place=(paragraph=0,offset=0,bookId='folio-secret-garden',chapter=0)=>({bookId,chapter,paragraph,offset});
const setup=()=>{const state=loadLearning(null,[],T);return [state,trackWord(state,'Garden','en',T)]};
const copy=(s,t=T)=>loadLearning(JSON.parse(JSON.stringify(packLearning(s))),[],t);
const hit=(r,t,correct=true)=>review(r,{recalled:correct,now:t});

test('identity: locale, scripts, punctuation and accents; no guessing or stemming',()=>{
  assert.equal(wordKey(' «L’Été!» ','fr-CA'),"fr:l'été");
  assert.equal(wordKey('«I»','tr'),'tr:ı');
  assert.equal(normalizeWord('İ','tr'),'i');
  assert.equal(normalizeWord('Cafe\u0301','en'),'café');
  assert.equal(normalizeWord('mother‑in‑law','en'),'mother-in-law');
  assert.equal(normalizeWord('a–b','en'),'');
  for(const s of ['x y','___','3','<script>','a'.repeat(129),'a\u0000b',undefined,{},42])assert.equal(normalizeWord(s,'en'),'');
  assert.notEqual(wordKey('всё','ru'),wordKey('все','ru'));assert.notEqual(wordKey('gift','en'),wordKey('gift','de'));
  assert.notEqual(wordKey('walked','en'),wordKey('walk','en'));assert.equal(wordKey('Tree','und-Latn'),'und-Latn:tree');
  assert.equal(wordKey('Tree','not/a-language'),'und:tree');
  assert.notEqual(wordKey('Ақ','kk'),wordKey('Ақ','ru'));assert.equal(wordKey('','en'),'');
});

test('tracking stores only tapped words and actual source token addresses',()=>{
  const [s,r]=setup();assert.equal(trackWord(s,'GARDEN!','en-US',T),r);
  assert.equal(getWord(s,'garden','de'),null);
  assert.equal(stage(r),'new');assert.equal(encounterCount(r),0);
  assert.equal(noteLookup(r,place(0,4),T),true);
  assert.equal(recordEncounter(r,place(0,4),T),false);
  assert.equal(noteLookup(r,place(0,4),T),false);
  recordEncounter(r,place(0,27),T);assert.equal(encounterCount(r),2);assert.equal(passageCount(r),1);assert.equal(stage(r),'new');
  recordEncounter(r,place(0,4,'book-second'),T);assert.equal(stage(r),'learning');
  recordEncounter(r,place(0,4,'folio-secret-garden',2),T);
  assert.deepEqual(bookStats(s,'folio-secret-garden'),{words:1,encounters:3,passages:2});
  const r2=trackWord(s,'rose','en',T);recordEncounter(r2,place(0,17),T);
  assert.deepEqual(bookStats(s,'folio-secret-garden'),{words:2,encounters:4,passages:3});
  const s2=copy(s);assert.equal(recordEncounter(getWord(s2,'garden','en'),place(0,27),T+D),false);
  assert.equal(noteLookup(getWord(s2,'garden','en'),place(0,4),T+D),false);
  for(const p of [{...place(),chapter:-1},{...place(),offset:NaN},{...place(),bookId:'a/b'},null]){
    assert.equal(recordEncounter(r,p,T),false);assert.equal(noteLookup(r,p,T),false);
  }
  assert.equal(getWord(s,'never-read','en'),null);
});

test('spaced active recall gates, not repeated taps or passive exposures, unlock mastery',()=>{
  const [s,r]=setup();for(let p=0;p<12;p++)recordEncounter(r,place(p),T);
  assert.equal(stage(r),'learning');assert.equal(due(r,T),true);assert.equal(hit(r,T),true);
  assert.equal(stage(r),'almost');assert.equal(hit(r,T),false);assert.equal(hit(r,T+D-1),false);assert.equal(hit(r,T+D),true);
  assert.equal(hit(r,T+2*D),false);assert.equal(stage(r),'almost');assert.equal(hit(r,T+4*D),true);assert.equal(stage(r),'known');
  assert.equal(due(r,T+17*D),false);assert.equal(due(r,T+18*D),true);
  assert.deepEqual(stats(s,T+4*D),{total:1,new:0,learning:0,almost:0,known:1,due:0});
});

test('sparse readers also advance with spaced recalls alone; failed recall regresses and schedules a retry',()=>{
  const [,r]=setup();assert.ok(hit(r,T));assert.equal(stage(r),'learning');assert.ok(hit(r,T+D));assert.equal(stage(r),'almost');
  assert.ok(hit(r,T+4*D));assert.equal(stage(r),'known');assert.ok(hit(r,T+4*D+1,false));
  assert.equal(stage(r),'learning');assert.equal(r.wins,0);assert.equal(due(r,T+4*D+M),false);
  assert.ok(hit(r,T+4*D+M+1));assert.equal(r.wins,1);
  assert.equal(hit(r,T,false),false);assert.equal(review(r,{recalled:'yes',now:T}),false);
});

test('repeated lookups: same position/restored tabs do not farm or reset evidence; fresh uncertainty can regress',()=>{
  const [s,r]=setup();noteLookup(r,place(0,4),T);
  hit(r,T);assert.ok(noteLookup(r,place(1,8),T+5));assert.equal(r.wins,1);
  hit(r,T+D);assert.equal(stage(r),'almost');
  assert.equal(noteLookup(r,place(1,8),T+D+M),false);assert.equal(stage(r),'almost');
  const s2=copy(s,T+2*D),r2=getWord(s2,'garden','en');
  recordEncounter(r2,place(4,2),T+2*D);assert.ok(noteLookup(r2,place(4,2),T+2*D));
  assert.equal(encounterCount(r2),3);assert.equal(stage(r2),'learning');
});

test('manual known is reversible, protects against incidental taps and is not due',()=>{
  const [,r]=setup();assert.ok(markKnown(r,T));assert.equal(markKnown(r,T),false);
  assert.equal(stage(r),'known');assert.equal(due(r,T+90*D),false);assert.equal(hit(r,T+D),false);
  noteLookup(r,place(),T+2*D);assert.equal(stage(r),'known');
  assert.ok(resumeLearning(r,T+4*D));assert.equal(stage(r),'learning');assert.ok(due(r,T+4*D));
  markKnown(r,T+4*D);assert.ok(hit(r,T+5*D,false));assert.equal(stage(r),'learning');
});

test('legacy migration, language mirrors, explicit removal, and roundtrip immutability',()=>{
  const s=loadLearning(null,['Garden','garden','ёлка',42,'','АПЕЛЬСИН'],T);
  assert.equal(stats(s,T).total,3);assert.equal(stage(getWord(s,'ёлка','ru')),'new');
  assert.equal(getWord(s,'garden','en').nextReviewAt,T);trackWord(s,'gift','de',T);
  const snap=packLearning(s),a=getWord(s,'garden','en');recordEncounter(a,place(),T);
  assert.equal(encounterCount(getWord(loadLearning(snap,[],T),'garden','en')),0);
  const remap=loadLearning(packLearning(s),['gift'],T);assert.equal(getWord(remap,'gift','en'),null);
  assert.ok(removeWord(s,'Garden','en'));assert.equal(removeWord(s,'Garden','en'),false);
  assert.equal(recordEncounter(a,place(2),T),false);
  assert.equal(getWord(copy(s),'garden','en'),null);assert.equal(stats(s,T).total,3);
});

test('backup merge unions token addresses, coalesces tapped/read duplicates; newer lapse beats older Known',()=>{
  const [left,l]=setup();recordEncounter(l,place(2,4),T);markKnown(l,T+D);
  const right=copy(left,T+D),r=getWord(right,'garden','en');
  noteLookup(r,place(2,4),T+2*D);recordEncounter(r,place(2,20),T+2*D);hit(r,T+2*D,false);
  recordEncounter(l,place(4,7),T+2*D);
  const result=mergeLearning(left,packLearning(right),T+3*D),rr=getWord(result,'garden','en');
  assert.equal(stage(rr),'learning');assert.equal(stage(l),'known');assert.equal(encounterCount(rr),3);assert.equal(passageCount(rr),2);
  assert.equal(noteLookup(rr,place(2,4),T+4*D),false);
  const again=mergeLearning(result,right,T+3*D);assert.deepEqual(packLearning(again),packLearning(result));
  const reverse=mergeLearning(right,left,T+3*D);assert.equal(encounterCount(getWord(reverse,'garden','en')),3);
  assert.equal(stage(getWord(reverse,'garden','en')),'learning');
});

test('caps freeze additional provenance instead of evicting and counting rereads',()=>{
  const [,r]=setup();
  for(let i=0;i<LIM.perWord;i++)assert.ok(recordEncounter(r,place(i,1),T));
  assert.equal(recordEncounter(r,place(999),T),false);assert.equal(recordEncounter(r,place(0,1),T),false);assert.equal(noteLookup(r,place(0,1),T),true);
  assert.equal(encounterCount(r),LIM.perWord);assert.equal(stage(r),'learning');
  const s=loadLearning(),n=Math.ceil(LIM.tokens/LIM.perWord)+1;
  let last;
  for(let i=0;i<n;i++){
    last=trackWord(s,'w'+String.fromCodePoint(0x4e00+i),'en',T);
    for(let p=0;p<LIM.perWord;p++)recordEncounter(last,place(0,p),T);
  }
  assert.equal(bookStats(s,'folio-secret-garden').encounters,LIM.tokens);
  assert.equal(encounterCount(last),0);
  removeWord(s,'w'+String.fromCodePoint(0x4e00),'en');
  assert.equal(recordEncounter(last,place(1),T),true);
});

test('non-data, unknown versions, invalid offsets, prototype keys and huge stored timers are bounded',()=>{
  for(const raw of [null,{},[],{version:8,rows:[]},42])assert.equal(stats(loadLearning(raw,[],T),T).total,0);
  const bad=JSON.parse('{"__proto__":[0],"book-safe/0/0":[0,-1,3,"5",false,2.5,-99999999999,{"toString":1,"valueOf":1}],"constructor":[3],"evil/01/0":[3]}');
  const x=loadLearning({version:1,rows:[['Tree','en',Infinity,99,0,0,NaN,8.64e15,bad],[{},'en',0,0,0,0,0,0,{}]]},[],T);
  const r=getWord(x,'tree','en');assert.equal(encounterCount(r),2);assert.equal(r.nextReviewAt<=T+14*D,true);
  assert.equal({}.polluted,undefined);assert.equal(bookStats(x,'evil').encounters,0);assert.equal(stage(r),'new');
});

test('bulk removal snapshot excludes exact language-scoped keys without changing live state',()=>{
  const [state,garden]=setup();
  const sibling=trackWord(state,'Garden','de',T),other=trackWord(state,'Gate','en',T);
  recordEncounter(sibling,place(1,2),T);recordEncounter(other,place(2,3),T);
  const before=packLearning(state), filtered=packLearning(state,{excludeKeys:new Set([garden.key,other.key,'missing:id'])});
  assert.deepEqual(packLearning(state),before);
  const restored=loadLearning(filtered,[],T);
  assert.deepEqual(Object.keys(restored.words),[sibling.key]);
  assert.equal(encounterCount(restored.words[sibling.key]),1);
  assert.deepEqual(packLearning(state,{excludeKeys:new Set(Object.keys(state.words))}),{version:1,rows:[]});
});

test('the word card can restore the removed exact record and its study progress once',()=>{
  const [state,garden]=setup();
  const sibling=trackWord(state,'Garden','de',T);
  assert.ok(recordEncounter(garden,place(),T));
  assert.ok(markKnown(garden,T));
  const undo=detachWord(state,'Garden','en');
  assert.equal(getWord(state,'Garden','en'),null);
  assert.equal(getWord(state,'Garden','de'),sibling);
  assert.equal(undo(loadLearning(null,[],T)),null);
  assert.equal(undo(state),garden);
  assert.equal(encounterCount(garden),1);assert.equal(stage(garden),'known');
  assert.equal(undo(state),null);
  const stale=detachWord(state,'Garden','en');
  const replacement=trackWord(state,'Garden','en',T+1);
  assert.equal(stale(state),null);assert.equal(getWord(state,'Garden','en'),replacement);
});
