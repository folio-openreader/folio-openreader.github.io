import test from 'node:test';
import assert from 'node:assert/strict';
import {createBookSpeech} from '../dist/book-speech.js';
import {voicePreference} from '../dist/word-speech.js';
import {uri} from '../dist/neural-voices.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('pause resumes the exact audio, preserves bounded lookahead, and never revives stale work',async t=>{
  // Only the runtime's idle resource timer uses global time. Do not let fake
  // workers delay the test process, and do not short-circuit Promise ordering.
  t.mock.method(globalThis,'setTimeout',()=>0);
  t.mock.method(globalThis,'clearTimeout',()=>{});
  const said=[],tasks=[],finished=[],contexts=[],moves=[],states=[],workers=[],native=[];
  const mark=new Float32Array(8);
  class Worker {
    constructor(){workers.push(this)}
    terminate(){this.stopped=true}
    postMessage(job){tasks.push({job,worker:this})}
  }
  class AudioContext {
    constructor(){this.state='suspended';this.currentTime=0;contexts.push(this)}
    async resume(){this.state='running'}
    async close(){this.state='closed'}
    createBuffer(ch,length,sampleRate){return {duration:4,copyToChannel(){}}}
    createBufferSource(){
      return {connect(){},disconnect(){},stop(){},start(at,offset){said.push({buffer:this.buffer,at,offset});finished.push(this.onended)}};
    }
  }
  const en={localService:true,voiceURI:'native',lang:'en-US'};
  const host={navigator:{},document:{hidden:false},AudioContext,Worker,URL,
    SpeechSynthesisUtterance:class{constructor(s){this.text=s}},
    speechSynthesis:{getVoices:()=>[en],speak:u=>native.push(u),cancel(){}},setTimeout(){},clearTimeout(){}};
  const source={chapters:[{paragraphs:[{text:'An easy sentence.'},{text:'A second sentence.'}]}]};
  const b=createBookSpeech({host,onPosition:x=>moves.push(x.paragraph),onState:x=>states.push(x)});
  const play=(paragraph=0)=>b.toggle({event:{isTrusted:true},source,chapter:0,paragraph,language:'en-US'});
  const data=t=>t.worker.onmessage({data:{id:t.job.id,pcm:mark,rate:24000}});
  voicePreference(host,'en',{voice:uri('Bella')});
  assert.equal(play(),true);const job0=tasks[0];
  b.pause();assert.equal(states.at(-1),'paused');assert.equal(job0.worker.stopped,true);
  data(job0);await flush();assert.equal(said.length,0,'generated voice must not start after pause');
  play();data(tasks.at(-1));await flush();
  assert.equal(said.length,1);assert.equal(said[0].offset,0);assert.equal(tasks.at(-1).job.text,'A second sentence.');
  let lookahead=tasks.at(-1),before=tasks.length;
  contexts.at(-1).currentTime=1.625;b.pause();assert.equal(lookahead.worker.stopped,true);
  finished[0]();data(lookahead);await flush();assert.deepEqual(moves,[]);
  play();await flush();
  assert.equal(said.length,2);assert.equal(said[1].buffer,said[0].buffer);assert.equal(said[1].offset,1.625);
  assert.deepEqual(tasks.slice(before).map(t=>t.job.text),['A second sentence.']);
  // A second pause adds elapsed playback to the previous seek, not wall time.
  contexts.at(-1).currentTime=0.375;b.pause();play();await flush();assert.equal(said.at(-1).offset,2);
  lookahead=tasks.at(-1);data(lookahead);await flush();finished.at(-1)();await flush();
  assert.deepEqual(moves,[1]);assert.equal(said.at(-1).offset,0);
  b.stop();assert.equal(states.at(-1),'idle');
  voicePreference(host,'en',{voice:'native'});play();
  assert.equal(native.at(-1).text,'An easy sentence.');
  b.stop();
});
