import {availableNarrator,pauseNeural,playNeural,stopNeural} from './neural-voices.js';
// Book text never leaves the device. Share the word reader's locale and Apple
// fallback policy; never let another browser choose an unspecified default voice.
import {localVoice,voicePreference,appleSpeechPlatform,nativeEnglish} from './word-speech.js';

export function nextChunk(text,offset,max=160) {
  // Bound native utterance length, and prefer ending a phrase to cutting a word.
  while(offset<text.length&&/\s/u.test(text[offset]))offset++;
  if(offset>=text.length)return null;
  let end=Math.min(offset+max,text.length);
  if(end<text.length){
    const slice=text.slice(offset,end), stops=[...slice.matchAll(/[.!?。！？…](?:[”’»"']*)(?=\s|$)|[。！？]/gu)];
    const space=[...slice.matchAll(/\s+/gu)].at(-1),stop=stops.at(-1);
    if(stop)end=offset+stop.index+stop[0].length;
    else if(space)end=offset+space.index;
    else if(/[\uD800-\uDBFF]/u.test(text[end-1]))end--;
  }
  return {start:offset,end,text:text.slice(offset,end)};
}

const NEURAL_CHUNK=92, NATIVE_CHUNK=160, LOOKAHEAD_STEPS=24;
function findChunk(book,chapter,paragraph,offset,max,steps=Infinity){
  for(;chapter<book.chapters.length&&steps>0;steps--){
    const rows=book.chapters[chapter].paragraphs;
    if(paragraph>=rows.length){chapter++;paragraph=0;offset=0;continue}
    const chunk=nextChunk(rows[paragraph]?.text||'',offset,max);
    if(chunk)return {chapter,paragraph,chunk};
    paragraph++;offset=0;
  }
  return null;
}

const OPENING_MIN=36,OPENING_MAX=62,OPENING_SAVING=22;
let sentenceSegmenter;
export function firstNarrationChunk(chunk){
  if(!chunk||chunk.text.length<OPENING_MIN+OPENING_SAVING||typeof Intl.Segmenter!=='function')return chunk;
  // Use a complete first sentence only. A hard character cut, initials,
  // ellipses and ambiguous abbreviations are worse than normal buffering.
  sentenceSegmenter??=new Intl.Segmenter('en',{granularity:'sentence'});
  const lead=sentenceSegmenter.segment(chunk.text)[Symbol.iterator]().next().value?.segment?.trimEnd()||'';
  if(lead.length<OPENING_MIN||lead.length>OPENING_MAX||chunk.text.length-lead.length<OPENING_SAVING)return chunk;
  if(!/[.!?][”’"']*$/u.test(lead)||/(?:\.\.(?:\.)?|\b(?:mr|mrs|ms|miss|dr|prof|sr|jr|st|etc|vs|fig|no|vol|rev|sgt)|\b[A-Za-z]|\b[A-Za-z]{1,3}\.[A-Za-z]{1,3})\.[”’"']*$/iu.test(lead))return chunk;
  if(!/^[“‘"']?\p{Lu}/u.test(chunk.text.slice(lead.length).trimStart()))return chunk;
  return {start:chunk.start,end:chunk.start+lead.length,text:lead};
}

export function createBookSpeech({host=window,onPosition=()=>{},onState=()=>{}}={}){
  let synth,Utterance;
  try{synth=host.speechSynthesis;Utterance=host.SpeechSynthesisUtterance}catch{}
  const getVoices=()=>{try{return synth?.getVoices?.()||[]}catch{return []}};
  getVoices(); // warm up the voice list without submitting any book text
  let book=null,c=0,p=0,offset=0,active=null,status='idle',timer,voice,lang,neural,resume,opening=true;
  const playing=()=>status==='speaking'||status==='starting';
  function emit(s){status=s;onState(s,lang)}
  function clear(){host.clearTimeout?.(timer);timer=undefined}
  function interrupt(){
    const old=active;active=null;clear();
    if(old&&neural)stopNeural();else if(old)try{synth.cancel()}catch{}
  }
  function stop(){interrupt();resume=null;opening=true;book=null;offset=0;if(status!=='idle')emit('idle')}
  function pause(){
    if(!playing())return;
    if(active&&neural){active=null;clear();resume=pauseNeural()||resume}
    else interrupt();
    emit('paused')
  }
  function fail(s){interrupt();emit(s);return false}
  function advance(){
    if(host.document?.hidden){pause();return false}
    const found=findChunk(book,c,p,offset,neural?NEURAL_CHUNK:NATIVE_CHUNK);
    if(!found){book=null;emit('ended');return false}
    let {chapter,paragraph,chunk}=found;
    if(chapter!==c||paragraph!==p){
      c=chapter;p=paragraph;offset=0;
      onPosition({book,chapter:c,paragraph:p});if(!book||!playing())return false;
    }
    if(neural){
      if(opening)chunk=firstNarrationChunk(chunk);
      const token={};active=token;offset=chunk.start;
      // Spend one worker slot on the same segment advance() will find, even
      // across blank rows or a chapter boundary. Do not scan ahead through an
      // arbitrary number of empty rows before starting the current playback.
      const next=findChunk(book,c,p,chunk.end,NEURAL_CHUNK,LOOKAHEAD_STEPS)?.chunk.text;
      timer=host.setTimeout(()=>{if(active===token)fail('unavailable')},60000);
      return playNeural(host,{text:chunk.text,next,resume,voice:neural,rate:voicePreference(host,lang).rate,
        onstart(){if(active===token){resume=null;clear();emit('speaking');timer=host.setTimeout(()=>{if(active===token)fail('unavailable')},120000)}},
        onend(){if(active===token){resume=null;opening=false;active=null;clear();offset=chunk.end;advance()}},
        onerror(s){if(active===token)fail(s)}});
    }
    let u;
    try{
      u=new Utterance(chunk.text);u.rate=voicePreference(host,lang).rate;u.lang=voice?.lang||lang;if(voice)u.voice=voice;
    }catch{return fail('unavailable')}
    let started=false;
    active=u;offset=chunk.start;
    function start(){
      if(active!==u||started)return;
      started=true;clear();emit('speaking');
      timer=host.setTimeout(()=>{if(active===u)fail('unavailable')},60000);
    }
    u.onstart=start;
    u.onboundary=e=>{
      if(active!==u)return;
      start();
      if(Number.isInteger(e?.charIndex)&&e.charIndex>=0&&e.charIndex<chunk.text.length)offset=chunk.start+e.charIndex;
    };
    u.onend=()=>{
      if(active!==u)return;
      if(!started){fail('unavailable');return}
      active=null;clear();offset=chunk.end;advance();
    };
    u.onerror=e=>{
      if(active===u)fail(e?.error==='not-allowed'?'blocked':['voice-unavailable','language-unavailable'].includes(e?.error)?'missing':
        ['canceled','interrupted'].includes(e?.error)?'interrupted':'unavailable');
    };
    timer=host.setTimeout(()=>{if(active===u)fail('unavailable')},5500);
    try{synth.speak(u);return true}catch{return fail('unavailable')}
  }
  function toggle({event,source,chapter,paragraph,language}){
    if(event?.isTrusted!==true||host.document?.hidden||!source)return false;
    if(playing()){pause();return true}
    if(source!==book||chapter!==c||paragraph!==p){stop();book=source;c=chapter;p=paragraph;offset=0}
    lang=language;neural=availableNarrator(host,lang,voicePreference(host,lang).voice);
    if(neural){emit('starting');return advance()}
    if(!synth||typeof synth.speak!=='function'||typeof Utterance!=='function')return fail('unsupported');
    if(!lang)return fail('unknown');
    const voices=getVoices();voice=localVoice(voices,lang,new Set(),voicePreference(host,lang).voice);
    if(!voice){
      const fallback=appleSpeechPlatform(host.navigator).systemSafari&&nativeEnglish(lang);
      if(!fallback)return fail(voices.length?'missing':'waiting');
      lang=fallback;
    }
    try{if(synth.paused)synth.resume?.()}catch{}
    emit('starting');
    // No asynchronous work precedes the first native speak() on a user tap.
    return advance();
  }
  return {toggle,stop,pause,get playing(){return playing()}};
}
