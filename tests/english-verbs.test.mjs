import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupWord} from '../dist/lexicon.js';
import {commonEnglishBaseForms} from '../dist/english-verbs.js';

test('common forms resolve to curated offline glosses with no dictionary installation',async()=>{
  for(const [form,head,gloss] of [['Been','be','быть'],['went','go','идти'],['written','write','писать'],['bought','buy','покупать'],['took','take','брать']]){
    const r=await lookupWord(form,{language:'en',target:'ru'});
    assert.equal(r.headword,head);assert.equal(r.matchType,'alias');
    assert.equal(r.matchedForm,form.toLowerCase());
    assert.ok(r.entries[0].translation.includes(gloss));
    assert.equal(r.entries[0].lemmaSource.packId,'builtin-en-forms');
  }
});

test('keeps exact homographs as well as verb senses without pretending to disambiguate a sentence',async()=>{
  for(const [form,verb] of [['saw','see'],['found','find'],['left','leave']]){
    const {entries}=await lookupWord(form,{language:'en',target:'ru'});
    assert.ok(entries.some(e=>e.matchType==='exact'&&e.headword===form));
    assert.ok(entries.some(e=>e.matchType==='alias'&&e.headword===verb&&e.pos==='verb'));
  }
});

test('also works for English definitions, without touching other languages or explicit packs',async()=>{
  assert.deepEqual(commonEnglishBaseForms('unseen'),[]);
  assert.ok((await lookupWord('spoke',{target:'en'})).entries[0].definition);
  await assert.rejects(lookupWord('spoke',{language:'de',target:'ru'}),/локальное хранилище/);
  await assert.rejects(lookupWord('spoke',{packId:'manual-dictionary'}),/локальное хранилище/);
});
