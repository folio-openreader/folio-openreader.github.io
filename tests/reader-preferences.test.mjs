import {test} from 'node:test';
import assert from 'node:assert/strict';
import {outsideSheet,isDismissSwipe} from '../dist/reader-preferences.js';
const p=(x,y,time)=>({x,y,time});
test('backdrop classification excludes dialog padding, content, scrollbar and borders',()=>{
  const r={left:10,right:150,top:20,bottom:220};
  for(const [x,y] of [[10,20],[150,220],[22,21],[149,149]])assert.equal(outsideSheet(r,x,y),false);
  for(const [x,y] of [[9,30],[151,30],[22,19],[22,221]])assert.equal(outsideSheet(r,x,y),true);
});
test('only sufficient, predominantly downward movement can qualify',()=>{
  const start=p(100,120,10);
  for(const end of [p(100,184,80),p(120,260,155)])assert.equal(isDismissSwipe(start,end),true);
  for(const end of [p(100,183,95),p(99,20,85),p(200,184,85),p(100,190,9),p(100,190,NaN)])assert.equal(isDismissSwipe(start,end),false);
});
