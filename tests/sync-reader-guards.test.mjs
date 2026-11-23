import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const file=new URL('../dist/app.js',import.meta.url),source=await readFile(file,'utf8');
function fn(name){
  const m=new RegExp('^(?:async )?function '+name+'\\(', 'm').exec(source);
  assert.ok(m,name);const end=source.indexOf('\n}',m.index);return source.slice(m.index,end+2);
}
const node=text=>({textContent:text,open:true});
test('actual ordinary add, grade, study, and backup handlers return before mutating a nonholder',async()=>{
  const nodes=new Map(),$=s=>{if(!nodes.has(s))nodes.set(s,node(''));return nodes.get(s)};
  const context={$,canWriteWords:()=>false,selectedRecord:()=>null,wordAnchor:{},backupDraft:{},restoring:false,
    record:{},reviewQueue:[{}],reviewIndex:0,reviewCanGrade:true,learning:{words:{}},
    stage:()=>{throw Error('status path must call canWriteWords before changing a score')},
    changed:false,confirm:()=>{throw Error('not before write access')}};
  // studyStatus checks old stage before changeScore; stage is non-mutating.
  context.stage=()=>'new';context.changeScore=()=>false;
  runInNewContext([fn('toggleWordSaved'),fn('gradeReview'),fn('restoreBackup'),fn('studyStatus'),fn('removeStudy')].join('\n'),context);
  context.toggleWordSaved({});assert.match($('#word-save-status').textContent,/не изменён/);
  context.gradeReview(true,{});assert.equal(context.reviewCanGrade,true);
  context.studyStatus(context.record,{});context.removeStudy(context.record,{});
  await context.restoreBackup();assert.equal(context.restoring,false);assert.match($('#backup-preview').textContent,/не начато/);
});
test('score writes restore all previous recall fields on quota failure; never acknowledge stale or failed scores',()=>{
  const rec={key:'en:river',wins:0,manual:false,lapsed:false,lastActionAt:1,nextReviewAt:1},before={...rec};
  const ctx={learning:{words:{'en:river':rec}},canWriteWords:()=>true,persistWordRows:()=>{throw Error('quota')},
    packLearning:()=>null,failedWordSave:()=>{},wordSaved:()=>{throw Error('not successful')}};
  runInNewContext(fn('changeScore'),ctx);
  assert.equal(ctx.changeScore(rec,()=>{rec.manual=true;rec.wins=2;rec.lastActionAt=99;return true}),false);
  assert.deepEqual(rec,before);ctx.canWriteWords=()=>false;
  assert.equal(ctx.changeScore(rec,()=>{throw Error('read-only editor was mutated')}),false);
});
test('ordinary reader uses the durable v2 validated ceiling; read-only lookups and observations do not count encounters',()=>{
  assert.match(source,/loadLearning\(learningSnapshot,[^\n]*wordDisk\?\.enrolled\?8640000000000000:Date\.now\(\)/);
  const shown=fn('showWord'),seen=fn('scheduleSeen');
  assert.match(shown,/writable&&state\.prefs\.autoSaveWords\?trackWord/);
  assert.ok(shown.indexOf('if(record&&writable)')<shown.indexOf('noteLookup(record'));
  assert.ok(seen.indexOf('if(!canWriteWords())return;')>=0&&seen.indexOf('if(!canWriteWords())return;')<seen.indexOf('recordEncounter('));
});
