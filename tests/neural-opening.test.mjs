import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {firstNarrationChunk,nextChunk,createBookSpeech} from '../dist/book-speech.js';
import {voicePreference} from '../dist/word-speech.js';
import {uri} from '../dist/neural-voices.js';

const opener='The second bell echoed across the quiet harbor.';
const str=opener+' Mina stopped on the narrow bridge.';
test('first complete sentence may start narration sooner without losing original punctuation or character offsets',()=>{
  for(const lead of [opener,'“The north trail is closed after sunset!”','“Can they hear us all the way from here?”']){
    const text='   '+lead+' Mina stopped on the narrow bridge.';
    const chunk=nextChunk(text,0,92),first=firstNarrationChunk(chunk),next=nextChunk(text,first.end,92);
    assert.deepEqual(first,{start:3,end:3+lead.length,text:lead});
    assert.equal(next.text,'Mina stopped on the narrow bridge.');
    assert.equal((first.text+' '+next.text),text.trim());
  }
});
test('long, short, abbreviated, ellipsized and incomplete first sentences keep normal segmentation',()=>{
  for(const t of [
    'She stared at the flickering lamps behind the harbor wall, wondering whether she might have enough time to cross before the storm arrived. Then the rain began.',
    'Hello! Another unusually long sound echoed all across the narrow valley.',
    'We had almost reached the far mountains when Dr. Ames pointed toward the harbor.',
    'They were the three editors of that journal, P. Lewis, Mai, and Farid. It was 1962.',
    'The light was almost gone in the harbor... Mina stopped on the narrow bridge.',
    '“Can they hear us all the way from here?” she asked Mina with a small smile.',
    'The second bell echoed across the quiet harbor. Yes.'
  ]){
    const chunk=nextChunk(t,0,92);assert.equal(firstNarrationChunk(chunk),chunk,t);
  }
});
test('only initial neural book segment uses the shorter sentence, with exact pause/resume and unchanged native text',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>0);t.mock.method(globalThis,'clearTimeout',()=>{});
  const jobs=[],audio=[],ends=[],native=[];
  class Worker{
    postMessage(payload){jobs.push({worker:this,payload})}
    terminate(){}
  }
  class AudioContext{
    constructor(){this.state='running';this.currentTime=0;host.context=this}
    async close(){this.state='closed'}
    createBuffer(){return {duration:4,copyToChannel(){}}}
    createBufferSource(){return {connect(){},disconnect(){},stop(){},start(at,offset){audio.push(offset);ends.push(this.onended)}}}
  }
  const v={localService:true,lang:'en-US'};
  const host={AudioContext,Worker,URL,document:{hidden:false},navigator:{},setTimeout(){},clearTimeout(){},
    SpeechSynthesisUtterance:class{constructor(x){this.text=x}},speechSynthesis:{getVoices:()=>[v],speak:x=>native.push(x),cancel(){}}};
  const source={chapters:[{paragraphs:[{text:str},{text:str}]}]};
  const engine=createBookSpeech({host});const play=()=>engine.toggle({event:{isTrusted:true},source,chapter:0,paragraph:0,language:'en'});
  const reply=job=>job.worker.onmessage({data:{id:job.payload.id,pcm:new Float32Array(2),rate:24000}});
  const flush=()=>new Promise(r=>setImmediate(r));
  voicePreference(host,'en',{voice:uri('Bella')});play();assert.equal(jobs[0].payload.text,opener);
  reply(jobs[0]);await flush();
  host.context.currentTime=.5;engine.pause();play();await flush();assert.deepEqual(audio,[0,.5]);
  assert.deepEqual(jobs.map(j=>j.payload.text),[opener,'Mina stopped on the narrow bridge.','Mina stopped on the narrow bridge.']);
  reply(jobs.at(-1));ends.at(-1)();await flush();assert.equal(jobs.at(-1).payload.text,str);
  engine.stop();voicePreference(host,'en',{voice:''});play();assert.equal(native[0].text,str);engine.stop()
});

test('local neural narration warms exactly one next segment across a chapter boundary and blank paragraphs',async t=>{
  t.mock.method(globalThis,'setTimeout',()=>0);t.mock.method(globalThis,'clearTimeout',()=>{});
  const jobs=[],audio=[],positions=[];
  class Worker{
    postMessage(payload){jobs.push({worker:this,payload});}
    terminate(){}
  }
  class AudioContext{
    state='running';currentTime=0;
    async close(){this.state='closed';}
    createBuffer(){return {duration:1,copyToChannel(){}};}
    createBufferSource(){
      return {connect(){},disconnect(){},stop(){},start(){audio.push(this.onended);}};
    }
  }
  const host={document:{hidden:false},navigator:{},AudioContext,Worker,URL,setTimeout(){},clearTimeout(){}};
  const first='The final boat crossed the canal.',next='Morning came before the ferry returned.',after='The passengers hurried off the pier.';
  const source={chapters:[{paragraphs:[{text:first},{text:'  '}]},{paragraphs:[]},
    {paragraphs:[{text:''},{text:next},{text:after}]}]};
  const flush=()=>new Promise(setImmediate);
  const reply=job=>job.worker.onmessage({data:{id:job.payload.id,pcm:new Float32Array(2),rate:24000}});
  const engine=createBookSpeech({host,onPosition:({chapter,paragraph})=>positions.push([chapter,paragraph])});
  t.after(()=>engine.stop());
  voicePreference(host,'en',{voice:uri('Bella')});
  // Drive the actual reader's headphone-button handler; only the browser audio
  // stack and page elements are small deterministic fixtures.
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const marker='listenButton.onclick=event=>{',start=app.indexOf(marker),end=app.indexOf('\n};',start)+3;
  assert.ok(start>=0&&end>start);
  const button={};
  runInNewContext(app.slice(start,end),{listenButton:button,current:source,chapter:0,paragraph:0,$:()=>({hidden:false}),
    isComic:()=>false,readingSourceLanguage:()=> 'en',sourceLanguage:()=> 'en',speechLanguage:x=>x,
    wordSpeech:{reset(){}},bookSpeech:engine});
  button.onclick({isTrusted:true});
  assert.equal(engine.playing,true);
  assert.deepEqual(jobs.map(x=>x.payload.text),[first]);
  reply(jobs[0]);await flush();
  assert.equal(audio.length,1);assert.deepEqual(positions,[]);
  assert.deepEqual(jobs.map(x=>x.payload.text),[first,next], 'the next chapter is generated while the current audio plays');
  reply(jobs[1]);await flush();
  assert.equal(audio.length,1,'lookahead is buffered, not spoken early');
  audio[0]();await flush();
  assert.equal(audio.length,2,'the next chapter starts without submitting its text a second time');
  assert.deepEqual(positions,[[2,1]]);
  assert.deepEqual(jobs.map(x=>x.payload.text),[first,next,after],'lookahead remains a single segment');
});
