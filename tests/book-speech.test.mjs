import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookSpeech,nextChunk} from '../dist/book-speech.js';

const voice={lang:'en-GB',localService:true,name:'English'};
const remote={lang:'en',localService:false,name:'Network'};
function fixture(voices=[voice],nav={}){
 const heard=[],events=[],moves=[],timers=new Map();let next=0,cancels=0;
 const host={document:{hidden:false},navigator:nav,SpeechSynthesisUtterance:class{constructor(text){this.text=text}},
  speechSynthesis:{getVoices:()=>voices,speak:u=>heard.push(u),cancel(){cancels++;heard.at(-1)?.onerror({error:'canceled'})}},
  setTimeout(f){timers.set(++next,f);return next},clearTimeout(k){timers.delete(k)}};
 const engine=createBookSpeech({host,onState:s=>events.push(s),onPosition:x=>moves.push([x.chapter,x.paragraph])});
 const book={chapters:[['Skip this','Hello there','  ','Next.'],[],['Final.']].map(v=>({paragraphs:v.map(text=>({text}))}))};
 const toggle=(opts={})=>engine.toggle({source:book,event:{isTrusted:true},chapter:0,paragraph:1,language:'en',...opts});
 const done=()=>{const u=heard.at(-1);u.onstart();u.onend()};
 return {engine,host,events,heard,moves,book,timers,toggle,done,cancels:()=>cancels};
}
test('synchronous trusted start from current paragraph, skips blanks, advances through chapters and ends',()=>{
 const f=fixture();assert.equal(f.toggle(),true);assert.equal(f.heard[0].voice,voice);assert.equal(f.heard[0].text,'Hello there');
 f.done();f.done();f.done();assert.deepEqual(f.heard.map(u=>u.text),['Hello there','Next.','Final.']);
 assert.deepEqual(f.moves,[[0,3],[2,0]]);assert.equal(f.events.at(-1),'ended');assert.equal(f.engine.playing,false);assert.equal(f.timers.size,0);
});
test('pause and retry from last known boundary; stale callbacks are inert; leaving stops native speech',()=>{
 const f=fixture();f.toggle();const first=f.heard[0];first.onboundary({charIndex:6});
 f.toggle();assert.equal(f.events.at(-1),'paused');assert.equal(f.cancels(),1);
 first.onend();first.onstart();assert.equal(f.heard.length,1);
 f.toggle();assert.equal(f.heard[1].text,'there');f.engine.stop();f.heard[1].onend();
 assert.equal(f.events.at(-1),'idle');assert.equal(f.heard.length,2);assert.equal(f.timers.size,0);
});
test('changed paragraph resets resume offset, and hidden documents cannot autoplay',()=>{
 const f=fixture();f.toggle();f.heard[0].onboundary({charIndex:6});f.engine.pause();
 f.toggle({paragraph:3});assert.equal(f.heard[1].text,'Next.');
 f.host.document.hidden=true;f.done();assert.equal(f.events.at(-1),'paused');assert.equal(f.heard.length,2);
 assert.equal(f.toggle(),false);
});
test('untrusted event, remote-only voice, rejected playback and silent engines never report successful listening',()=>{
 const f=fixture([remote]);assert.equal(f.toggle({event:{isTrusted:false}}),false);assert.equal(f.heard.length,0);
 assert.equal(f.toggle(),false);assert.equal(f.events.at(-1),'missing');
 const g=fixture();g.toggle();g.heard[0].onend();assert.equal(g.events.at(-1),'unavailable');
 g.toggle();g.heard[1].onerror({error:'not-allowed'});assert.equal(g.events.at(-1),'blocked');
 g.toggle();[...g.timers.values()][0]();assert.equal(g.events.at(-1),'unavailable');
 const h=fixture([],{userAgent:'Mozilla/5.0 (iPhone) AppleWebKit/605 Version/26.0 Mobile Safari/605',vendor:'Apple Computer, Inc.',platform:'iPhone'});
 h.toggle();assert.equal(h.heard[0].lang,'en-US');assert.equal(h.heard[0].voice,undefined);
});
test('utterances stay bounded, preserve text content, break naturally and avoid splitting surrogate pairs',()=>{
 const text='One short sentence. '+('😀'.repeat(99)+' overflow. ').repeat(5);let offset=0;const pieces=[];
 for(let c;(c=nextChunk(text,offset));offset=c.end){assert.ok(c.text.length<=160&&c.end>offset);assert.ok(c.text.isWellFormed());pieces.push(c.text)}
 assert.equal(pieces[0],'One short sentence.');assert.equal(pieces.join('').replaceAll(' ',''),text.replaceAll(' ',''));
});

test('unavailable native voice rotates only on explicit retry and never selects a remote fallback',()=>{
 const alternate={lang:'en-US',localService:true,name:'Alternate'};
 const otherLanguage={lang:'ru',localService:true,name:'Russian'};
 const f=fixture([voice,remote,otherLanguage,alternate]);
 f.toggle();f.heard[0].onerror({error:'voice-unavailable'});
 assert.equal(f.events.at(-1),'retry-voice');
 assert.equal(f.heard.length,1);
 assert.equal(f.toggle({event:{isTrusted:false}}),false);
 assert.equal(f.heard.length,1);
 f.toggle();assert.equal(f.heard[1].voice,alternate);
 f.heard[1].onerror({error:'not-allowed'});assert.equal(f.events.at(-1),'blocked');
 f.toggle();assert.equal(f.heard[2].voice,alternate);
 f.heard[2].onerror({error:'language-unavailable'});assert.equal(f.events.at(-1),'missing');
 f.toggle();assert.equal(f.heard[3].voice,voice);
 f.engine.stop();
 assert.equal(f.timers.size,0);
});
