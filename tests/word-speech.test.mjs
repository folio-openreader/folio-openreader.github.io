import test from 'node:test';
import assert from 'node:assert/strict';
import {createWordSpeech,localVoice,speechLanguage,appleSpeechPlatform,wordSpeechMessage} from '../dist/word-speech.js';
const uk={lang:'en-GB',localService:true,voiceURI:'uk'},us={lang:'en-US',localService:true,voiceURI:'us',default:true};
const ru={lang:'ru-RU',localService:true,voiceURI:'ru'},remote={lang:'en-GB',localService:false,default:true,voiceURI:'remote'};
const apple={userAgent:'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1',vendor:'Apple Computer, Inc.',platform:'iPhone'};
const trusted={isTrusted:true};
function fixture({navigator={},provided=[]}={}){
  let list=provided,id=0,cancels=0,resumes=0,warm=0;const pending=new Map(),played=[],events=[];
  const synth=new EventTarget();
  Object.assign(synth,{getVoices(){warm++;return list},speak(utterance){played.push(utterance)},cancel(){cancels++;played.at(-1)?.onerror?.({error:'canceled'})},
    resume(){resumes++;synth.paused=false}});
  const document={hidden:false};
  const host={document,navigator,speechSynthesis:synth,SpeechSynthesisUtterance:class{constructor(text){this.text=text}},
    setTimeout(f){pending.set(++id,f);return id},clearTimeout(i){pending.delete(i)}};
  const speech=createWordSpeech({host,publish:e=>events.push(e)});
  return {speech,host,document,synth,pending,played,events,state:()=>events.at(-1)?.status,
    setVoices(v,signal=true){list=v;if(signal)synth.dispatchEvent(new Event('voiceschanged'))},
    cancelCount:()=>cancels,resumeCount:()=>resumes,warmCount:()=>warm,
    fire:()=>{const item=pending.entries().next().value;if(item){pending.delete(item[0]);item[1]()}}};
}

test('uses exact trusted offline locale before default, never remote or wrong language/script',()=>{
  assert.equal(localVoice([ru,us,remote,uk],'en-GB'),uk);
  assert.equal(localVoice([ru,us,remote],'en-GB'),us);
  assert.equal(localVoice([ru,remote],'en-GB'),null);
  assert.equal(localVoice([{lang:'zh-CN',localService:true}],'zh-Hant-TW'),null);
  assert.equal(speechLanguage('pt_BR','en'),'pt-BR');
  assert.equal(speechLanguage('und-Cyrl','kk'),'kk');
  assert.equal(speechLanguage('und','und'),'');
});

test('asynchronous voices never play without another user gesture; first invocation does not cancel',()=>{
  const f=fixture();assert.ok(f.warmCount()>0);
  assert.equal(f.speech.speak({text:'Manor',language:'en-GB',event:trusted}),false);
  assert.equal(f.state(),'waiting');assert.equal(f.played.length,0);
  f.setVoices([remote,uk]);assert.equal(f.state(),'ready');assert.equal(f.played.length,0);
  assert.equal(f.speech.speak({text:'Manor',language:'en-GB',event:trusted}),true);
  assert.equal(f.played.length,1);assert.equal(f.played[0].text,'Manor');assert.equal(f.played[0].voice,uk);
  assert.equal(f.played[0].lang,'en-GB');assert.equal(f.state(),'starting');assert.equal(f.cancelCount(),0);
  f.played[0].onstart();assert.equal(f.state(),'speaking');
  f.played[0].onend();assert.equal(f.state(),'idle');assert.equal(f.pending.size,0);
});

test('only Apple Safari may attempt a native default, only for known English',()=>{
  const f=fixture({navigator:apple});
  assert.ok(appleSpeechPlatform(apple).systemSafari);
  assert.ok(!appleSpeechPlatform({...apple,userAgent:apple.userAgent.replace('Version/26.0','CriOS/130.0')}).systemSafari);
  assert.ok(f.speech.speak({text:'Manor',language:'en-GB',event:trusted}));
  assert.equal(f.played[0].lang,'en-GB');assert.ok(!Object.hasOwn(f.played[0],'voice'));
  assert.equal(f.speech.speak({text:'кітап',language:'kk',event:trusted}),false);
  assert.equal(f.played.length,1);
  const g=fixture({provided:[ru,remote]});
  assert.equal(g.speech.speak({text:'Manor',language:'en',event:trusted}),false);
  assert.equal(g.state(),'missing');assert.equal(g.played.length,0);
});

test('alternate same-language voice needs a fresh gesture after start timeout',()=>{
  const f=fixture({provided:[uk,us,ru]});f.synth.paused=true;
  f.speech.speak({text:'Manor',language:'en-GB',event:trusted});
  assert.equal(f.resumeCount(),1);assert.equal(f.played[0].voice,uk);
  f.fire();assert.equal(f.state(),'unavailable');assert.equal(f.played.length,1);
  f.speech.speak({text:'Manor',language:'en-GB',event:trusted});
  assert.equal(f.played.length,2);assert.equal(f.played[1].voice,us);
  f.played[0].onend();assert.equal(f.state(),'starting');
  f.played[1].onboundary();assert.equal(f.state(),'speaking');
  f.speech.reset();assert.equal(f.state(),'idle');assert.equal(f.pending.size,0);
  f.played[1].onerror({error:'voice-unavailable'});assert.equal(f.state(),'idle');
});

test('unsupported, rejected, hidden, unknown, and no voiced playback have honest feedback',()=>{
  const f=fixture({provided:[uk]});
  assert.equal(f.speech.speak({text:'Manor',language:'en',event:{isTrusted:false}}),false);
  f.document.hidden=true;assert.equal(f.speech.speak({text:'Manor',language:'en',event:trusted}),false);
  f.document.hidden=false;
  assert.equal(f.speech.speak({text:'Manor',language:'',event:trusted}),false);assert.equal(f.state(),'unknown');
  f.speech.speak({text:'Manor',language:'en',event:trusted});f.played[0].onerror({error:'not-allowed'});
  assert.equal(f.state(),'blocked');
  f.speech.speak({text:'Manor',language:'en',event:trusted});f.played[1].onend();assert.equal(f.state(),'unavailable');
  let state;
  const unsupported=createWordSpeech({host:{},publish:e=>state=e.status});
  unsupported.speak({text:'Manor',language:'en',event:trusted});
  assert.equal(state,'unsupported');assert.match(wordSpeechMessage('missing','kk'),/казахский/i);
});
