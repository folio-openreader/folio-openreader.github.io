import test from 'node:test';
import assert from 'node:assert/strict';
import {searchKey} from '../dist/release-core.js';

test('vocabulary search folds in-word typography without collapsing real dashes',()=>{
  for(const raw of ['don’t','DON‘T','donʼt','don＇t'])assert.equal(searchKey(raw),"don't");
  assert.equal(searchKey('long‑term'),'long-term');
  assert.equal(searchKey('long‐term'),'long-term');
  assert.equal(searchKey('lan\u00adtern'),'lantern');
  assert.notEqual(searchKey('long—term'),searchKey('long-term'));
  assert.notEqual(searchKey('long–term'),searchKey('long-term'));
  assert.equal(searchKey('  Ёж  '),'еж');
});
