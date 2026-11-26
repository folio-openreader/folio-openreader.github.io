import test from 'node:test';
import assert from 'node:assert/strict';
import {bookVoiceSample} from '../dist/voice-controls.js';

test('book voice preview prefers a short complete sentence and normalizes spacing',()=>{
  assert.equal(bookVoiceSample('  A raposa correu pelo\n bosque em silêncio. A cauda balançava atrás dela.'),'A raposa correu pelo bosque em silêncio.');
  assert.equal(bookVoiceSample('   2026   … → 📚   '),'');
});

test('book voice preview bounds long excerpts and avoids breaking a surrogate pair',()=>{
  const tok='palavra';
  const result=bookVoiceSample((tok+' ').repeat(30));
  assert.equal(result,Array(9).fill(tok).join(' '));
  const nonspacing='č'.repeat(71)+'📚'+'č';
  assert.equal(bookVoiceSample(nonspacing),'č'.repeat(71));
});
