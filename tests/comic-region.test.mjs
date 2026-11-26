import test from 'node:test';
import assert from 'node:assert/strict';
import {comicRegionPixels,comicRegionWord,fromCorners,mergeComicRegion} from '../dist/comic-region.js';

test('comic crop respects normalized image space and remaps selected coordinates to the full page',()=>{
  const region=fromCorners({x:.75,y:.875},{x:.125,y:.8125});
  assert.deepEqual(region,{x:.125,y:.8125,w:.625,h:.0625});
  const pixels=comicRegionPixels(region,800,4800);
  assert.deepEqual(pixels,{x:100,y:3900,w:500,h:300});
  assert.deepEqual(comicRegionWord({text:'word',x:.2,y:.25,w:.2,h:.5},pixels,800,4800),
    {text:'word',x:.25,y:.828125,w:.125,h:.03125});
  assert.equal(comicRegionPixels({x:.2,y:.3,w:.001,h:.1},800,4800),null);
  assert.equal(comicRegionPixels({x:.9,y:.2,w:.2,h:.1},800,4800),null);
});
test('a region replaces only intersecting word ranges, retaining outside and unlocated text',()=>{
  const previous={paragraphs:[{text:'first misspelled third'},{text:'unlocated caption'},{text:'other bubble'}],words:[
    {text:'first',offset:0,paragraphIndex:0,x:.1,y:.5,w:.1,h:.05},
    {text:'misspelled',offset:6,paragraphIndex:0,x:.3,y:.5,w:.1,h:.05},
    {text:'third',offset:17,paragraphIndex:0,x:.6,y:.5,w:.1,h:.05},
    {text:'bubble',offset:6,paragraphIndex:2,x:.5,y:.8,w:.2,h:.05},
  ]};
  const next={paragraphs:[{text:'corrected'}],words:[{text:'corrected',offset:0,paragraphIndex:0,x:.3,y:.5,w:.1,h:.05}]};
  const merged=mergeComicRegion(previous,next,{x:.24,y:.44,w:.3,h:.14});
  assert.deepEqual(merged.paragraphs.map(p=>p.text),['first','corrected','third','unlocated caption','other bubble']);
  assert.deepEqual(merged.words.map(w=>[w.text,w.paragraphIndex,w.offset]),[
    ['first',0,0],['corrected',1,0],['third',2,0],['bubble',4,6],
  ]);
  assert.equal(previous.paragraphs[0].text,'first misspelled third');
});

const asPage=rows=>({status:'ready',paragraphs:rows.map(([text])=>({text})),words:rows.map(([text,x,y,w=.08,h=.04],paragraphIndex)=>
  ({text,x,y,w,h,paragraphIndex,offset:0}))});
const tallLeft={x:.10,y:.10,w:.28,h:.50};
const interleaved=()=>asPage([['topLeft',.15,.20],['topRight',.70,.20],['lowerLeft',.15,.45],['lowerRight',.70,.45]]);
test('a tall region keeps interleaved unaffected dialogue and exact word hotspots in their original reading order',()=>{
  const previous=interleaved(),next=asPage([['lowerFixed',.15,.452],['topFixed',.15,.202]]);
  const merged=mergeComicRegion(previous,next,tallLeft);
  assert.equal(merged.status,'ready');
  assert.deepEqual(merged.paragraphs.map(p=>p.text),['topFixed','topRight','lowerFixed','lowerRight']);
  assert.deepEqual(merged.words,[{...next.words[1],paragraphIndex:0},previous.words[1],{...next.words[0],paragraphIndex:2},previous.words[3]]);
  assert.equal(merged.paragraphs[1],previous.paragraphs[1]);
  assert.equal(merged.paragraphs[3],previous.paragraphs[3]);
});

test('one slot can split into several nearby results without moving a later untouched bubble',()=>{
  const prior=interleaved(),next=asPage([
    ['lowerFixed',.15,.452],['top',.15,.20,.038,.04],['fixed',.191,.20,.039,.04]
  ]);
  assert.deepEqual(
    mergeComicRegion(prior,next,tallLeft).paragraphs.map(p=>p.text),
    ['top','fixed','topRight','lowerFixed','lowerRight']
  );
});

test('ambiguous and unmatched interleaved slots retain every prior paragraph and hotspot',()=>{
  const previous=interleaved();
  for(const next of [
    {paragraphs:[{text:'top and lower'}],words:[
      {text:'top',offset:0,paragraphIndex:0,x:.15,y:.20,w:.08,h:.04},
      {text:'lower',offset:8,paragraphIndex:0,x:.15,y:.45,w:.08,h:.04}
    ]},
    asPage([['oneUpdated',.15,.20]]),
    asPage([['oneUpdated',.15,.20],['notMatched',.30,.34]]),
    {paragraphs:[{text:'unlocated replacement'}],words:[]},
  ]){
    const merged=mergeComicRegion(previous,next,tallLeft);
    assert.equal(merged.status,'ambiguous');
    assert.equal(merged.paragraphs,previous.paragraphs);
    assert.equal(merged.words,previous.words);
  }
});
