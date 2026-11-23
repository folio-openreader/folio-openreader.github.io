import test from 'node:test';
import assert from 'node:assert/strict';
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
