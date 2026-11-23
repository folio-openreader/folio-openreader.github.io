import test from 'node:test';import assert from 'node:assert/strict';
import {localVoice,voicePreference,createWordSpeech} from '../dist/word-speech.js';
import {createBookSpeech} from '../dist/book-speech.js';
const a={name:'A',voiceURI:'a',lang:'en-US',localService:true,default:true},b={...a,name:'B',voiceURI:'b',default:false},net={...a,localService:false,voiceURI:'network'};
test('saved language and rate validated, scoped by script and survive restart',()=>{
 const s=new Map(),localStorage={getItem:k=>s.get(k),setItem:(k,v)=>s.set(k,v)},h={localStorage};
 voicePreference(h,'en-US',{voice:'b',rate:.9});assert.deepEqual(voicePreference({localStorage},'en-GB'),{voice:'b',rate:.9});assert.equal(voicePreference(h,'ru').rate,1);
 voicePreference(h,'sr-Latn',{rate:2});assert.equal(voicePreference(h,'sr-Cyrl').rate,1);
 assert.equal(voicePreference(h,'en',{rate:100}).rate,1);
 assert.equal(localVoice([net,a,b],'en',new Set(),'network'),a);assert.equal(localVoice([a,b],'en',new Set(['b']),'b'),a)
});
test('sample/word and book both honor the chosen available local voice and speed',()=>{
 const out=[],h={navigator:{},document:{hidden:false},speechSynthesis:{getVoices:()=>[net,a,b],speak:u=>out.push(u)},setTimeout(){},clearTimeout(){},SpeechSynthesisUtterance:class{constructor(t){this.text=t}}},event={isTrusted:true};
 voicePreference(h,'en',{voice:'b',rate:.9});createWordSpeech({host:h}).speak({text:'test',language:'en',event});
 createBookSpeech({host:h}).toggle({source:{chapters:[{paragraphs:[{text:'test book'}]}]},chapter:0,paragraph:0,event,language:'en-US'});
 assert.equal(out.length,2);assert.ok(out.every(u=>u.voice===b&&u.rate===.9));
});
