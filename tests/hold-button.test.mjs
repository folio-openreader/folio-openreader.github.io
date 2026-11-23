import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHoldGate,HOLD_MS} from '../dist/hold-button.js';

test('a primary hold must release inside after 1200 ms; click or near miss never commits',()=>{
  const gate=createHoldGate();assert.equal(HOLD_MS,1200);
  assert.equal(gate.begin(7,10),true);assert.equal(gate.progress(610),.5);
  assert.equal(gate.release(7,1209,true),false);
  assert.equal(gate.begin(7,2000),true);assert.equal(gate.progress(3200),1);
  assert.equal(gate.release(7,3200,true),true);
  assert.equal(gate.release(7,3300,true),false);
});
test('leaving at full fill cancels and earlier progress is never carried',()=>{
  const gate=createHoldGate();
  gate.begin(1,12);assert.equal(gate.release(1,2000,false),false);
  gate.begin(1,2100);assert.equal(gate.progress(2100),0);assert.equal(gate.release(1,2200,true),false);
});
test('pointer cancellation, duplicate starts, late releases and mismatched pointers',()=>{
  const gate=createHoldGate();
  assert.equal(gate.begin(1,0),true);assert.equal(gate.begin(2,10),false);
  assert.equal(gate.cancel(2),false);assert.equal(gate.release(2,2000,true),false);
  assert.equal(gate.pointer,1);assert.equal(gate.cancel(1),true);
  assert.equal(gate.release(1,2100,true),false);
  gate.begin(3,2200);assert.equal(gate.cancel(),true);assert.equal(gate.pointer,null);
});
test('invalid or out-of-order event times cannot validate a release',()=>{
  const gate=createHoldGate();
  assert.equal(gate.begin(1,NaN),false);gate.begin(1,2000);
  assert.equal(gate.release(1,NaN,true),false);gate.begin(1,2000);
  assert.equal(gate.release(1,1999,true),false);
});
