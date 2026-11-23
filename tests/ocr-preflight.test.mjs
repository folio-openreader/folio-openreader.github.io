import test from 'node:test';
import assert from 'node:assert/strict';
import {hasPageMarks} from '../dist/ocr-engine.js';

// The thumbnail is always white here: model the hard case where downsampling
// erases a mark. The real-browser suite covers rendering, decoding and OCR.
function page(t,{different=false,broken=false,onRead}={}){
  const w=2500,h=2000,reads=[];
  const thumb={width:1,height:1,getContext(){return {
    drawImage(){},getImageData(){return {data:new Uint8ClampedArray(thumb.width*thumb.height*4).fill(255)}}};}};
  const old=globalThis.document;
  t.after(()=>old===undefined?delete globalThis.document:globalThis.document=old);
  globalThis.document={createElement(){return thumb;}};
  const canvas={width:w,height:h,getContext(){return {getImageData(x,y,width,height){
    if(broken)throw new Error('readback is not available');
    onRead?.();reads.push(width*height*4);
    const data=new Uint8ClampedArray(width*height*4).fill(255);
    if(different && y+height===h)data[data.length-4]=254;
    return {data};
  }}}};
  return {canvas,reads,thumb};
}
test('verify uniform full raster in bounded bands, release the thumbnail',async t=>{
  const {canvas,reads,thumb}=page(t);
  assert.equal(await hasPageMarks(canvas),false);
  assert.ok(reads.length>1 && Math.max(...reads)<=256*1024);
  assert.equal(reads.reduce((a,b)=>a+b,0),2500*2000*4);
  assert.equal(thumb.width*thumb.height,0);
});
test('last faint pixel survives thumbnail, regardless of threshold',async t=>{
  assert.equal(await hasPageMarks(page(t,{different:true}).canvas),true);
});
test('unavailable exact readback sends page to OCR instead of dropping text',async t=>{
  assert.equal(await hasPageMarks(page(t,{broken:true}).canvas),true);
});
test('abort takes precedence, even while inspecting an all-white raster',async t=>{
  const ac=new AbortController();
  const {canvas,reads}=page(t,{onRead(){if(!ac.signal.aborted)ac.abort()}});
  await assert.rejects(hasPageMarks(canvas,ac.signal),{name:'AbortError'});
  assert.ok(reads.length>0);
});
