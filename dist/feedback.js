// All feedback is optional. Only explicit, foreground actions can make a sound.
// No media files, network requests, silent unlock clips or audio-session overrides.
const patterns = Object.freeze({
  study: 12, word: 8, lesson: 10, step: 10, correct: 14,
  incorrect: Object.freeze([9, 35, 9]), complete: Object.freeze([15, 40, 18]),
});
const visible = p=>!p.document?.hidden && p.document?.visibilityState !== 'hidden';
const reduced = p=>!!p.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const explicit = e=>e?.isTrusted === true && (e.type === 'click' || (e.type === 'keydown' && !e.repeat && !e.isComposing && ['Enter',' '].includes(e.key)));

export function tactileFeedback(event, kind, enabled, platform=globalThis) {
  if (enabled === false || !explicit(event) || !Object.hasOwn(patterns,kind) || !visible(platform)) return false;
  try {
    if (reduced(platform) || tactileMode(platform)!=='vibrate') return false;
    const pattern=patterns[kind];
    return platform.navigator.vibrate(Array.isArray(pattern) ? [...pattern] : pattern) === true;
  } catch { return false; }
}

// Display-mode detection chooses an audio backend, not a haptic capability.
export function installedAppleMobile(platform=globalThis) {
  try {
    const n=platform.navigator;
    const mobile=/iPhone|iPad|iPod/i.test(n?.userAgent||'') ||
      (/Macintosh/i.test(n?.userAgent||'') && n.maxTouchPoints>1);
    return !!mobile && (n.standalone===true || !!platform.matchMedia?.('(display-mode: standalone)').matches);
  } catch { return false; }
}

// The switch attribute arrived before its haptic in Safari. A genuine tap is
// eligible for a system tick, but no web API can verify hardware/system output.
export function tactileMode(platform=globalThis) {
  try {
    const n=platform.navigator, ua=n?.userAgent||'';
    if(/\biPhone\b/i.test(ua)){
      const ios=ua.match(/\bOS (\d+)/i);
      const safari=ua.match(/\bVersion\/(\d+)/i);
      const major=Number((ios||safari)?.[1]);
      return major>=18 && 'switch' in (platform.HTMLInputElement?.prototype||{}) ? 'iphone-switch' : 'none';
    }
    return typeof n?.vibrate==='function'?'vibrate':'none';
  } catch { return 'none'; }
}
export const supportsIphoneSwitch=(platform=globalThis)=>tactileMode(platform)==='iphone-switch';
export function nativeLessonSwitch(enabled, platform=globalThis) {
  return enabled === true && supportsIphoneSwitch(platform) && !reduced(platform);
}

// Original quiet plucked notes: [onset, frequency, duration, peak amplitude].
// Levels leave headroom even at overlapping note tails; verdicts use pitch and
// rhythm rather than a loud buzzer. The text verdict is always the primary cue.
const sounds = Object.freeze({
  lesson: [[0,640,.038,.070]],
  step: [[0,510,.070,.080]],
  correct: [[0,523.25,.116,.155],[.071,698.46,.185,.13]],
  incorrect: [[0,349.23,.122,.125],[.092,293.66,.139,.105]],
  complete: [[0,392,.16,.135],[.083,523.25,.16,.14],[.174,659.26,.24,.155]],
});
const sampleRate=24000;
export function renderCue(kind) {
  if (!Object.hasOwn(sounds,kind)) return null;
  const notes=sounds[kind], duration=Math.max(...notes.map(([t,,d])=>t+d));
  const out=new Float32Array(Math.ceil(duration*sampleRate));
  for (const [start,hz,length,peak] of notes) {
    const offset=Math.round(start*sampleRate), count=Math.min(out.length-offset,Math.ceil(length*sampleRate));
    for(let i=0;i<count;i++){
      const t=i/sampleRate, p=t/length, phase=2*Math.PI*hz*t;
      const envelope=Math.min(t/.005,1)*Math.exp(-3.9*p)*Math.min((count-1-i)/(sampleRate*.012),1);
      out[offset+i]+=peak*envelope*(.82*Math.sin(phase)+.18*Math.exp(-9*p)*Math.sin(phase*2.005));
    }
  }
  return out;
}

// Original, mono 16-bit PCM. The data URL is generated from the same samples
// as Web Audio. No fetch, decodeAudioData(), microphone or permission prompt.
export function encodeCue(kind) {
  const samples=renderCue(kind);
  if(!samples)return null;
  const bytes=new Uint8Array(44+samples.length*2),v=new DataView(bytes.buffer);
  const ascii=(offset,word)=>{for(let i=0;i<word.length;i++)bytes[offset+i]=word.charCodeAt(i)};
  ascii(0,'RIFF');v.setUint32(4,bytes.length-8,true);ascii(8,'WAVEfmt ');
  v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
  v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);
  v.setUint16(32,2,true);v.setUint16(34,16,true);ascii(36,'data');v.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++)v.setInt16(44+i*2,Math.round(32767*samples[i]),true);
  return bytes;
}

export function createPracticeAudio(isEnabled, platform=globalThis) {
  let ctx=null, active=null, media=null, request=0, idle=0, pending=0, preferAlternate=false;
  const buffers=new Map(), mediaUrls=new Map();
  const now=()=>platform.performance?.now?.() ?? Date.now();
  const allow=()=>isEnabled()===true&&visible(platform);
  const clearTimer=name=>{const timer=name==='idle'?idle:pending;if(timer)platform.clearTimeout(timer);if(name==='idle')idle=0;else pending=0};
  function retire(node){
    if(!node)return;
    node.onended=null;
    try{node.disconnect()}catch{} try{node.stop()}catch{}
  }
  function discardContext(){
    retire(active);active=null;
    const old=ctx;ctx=null;buffers.clear();
    try{if(old&&old.state!=='closed')Promise.resolve(old.close()).catch(()=>{})}catch{}
  }
  function pauseMedia(discard=false){
    if(!media)return;
    try{media.pause()}catch{}
    if(discard){
      try{media.removeAttribute('src');media.load()}catch{}
      media=null;
    }
  }
  function stop(){
    request++;clearTimer('idle');clearTimer('pending');
    discardContext();pauseMedia(true);preferAlternate=false;
  }
  function play(event,kind,report){
    if(!explicit(event)||!Object.hasOwn(sounds,kind)||!allow())return false;
    const AudioContext=platform.AudioContext??platform.webkitAudioContext;
    const Media=platform.Audio;
    const token=++request;
    const matches=()=>token===request&&allow();
    clearTimer('idle');clearTimer('pending');retire(active);active=null;pauseMedia();
    let settled=false;
    const success=()=>{if(!settled&&matches()){settled=true;clearTimer('pending');report?.('started')}};
    const failed=alternate=>{
      if(settled||!matches())return;
      settled=true;clearTimer('pending');preferAlternate=alternate;report?.('blocked');
    };
    const defaultMedia=installedAppleMobile(platform);
    const useMedia=!!Media&&(!AudioContext||(defaultMedia!==preferAlternate));
    // A failed attempt can select the other backend on the next real gesture.
    // Do not start a second sound asynchronously or after returning to the app.
    if(useMedia){
      try{
        if(!media){media=new Media();media.preload='none';media.setAttribute?.('playsinline','')}
        let url=mediaUrls.get(kind);
        if(!url){url='data:audio/wav;base64,'+platform.btoa(String.fromCharCode(...encodeCue(kind)));mediaUrls.set(kind,url)}
        media.src=url;
        const node=media;
        const played=node.play(); // activation is still on the stack
        pending=platform.setTimeout(()=>{if(matches()){pauseMedia(true);failed(defaultMedia)}},650);
        Promise.resolve(played).then(()=>{
          if(matches()&&media===node)success();
        },()=>{if(matches()){pauseMedia(true);failed(defaultMedia)}});
        return true;
      }catch{pauseMedia(true);if(defaultMedia)preferAlternate=true}
    }
    try{
      if(!AudioContext){failed(false);return false}
      if(ctx?.state==='interrupted')discardContext();
      if(!ctx||ctx.state==='closed'){ctx=new AudioContext();buffers.clear()}
      const context=ctx,started=now();
      const begin=()=>{
        if(!matches()||ctx!==context||context.state!=='running'||now()-started>650)return false;
        let buffer=buffers.get(kind);
        if(!buffer){const samples=renderCue(kind);buffer=context.createBuffer(1,samples.length,sampleRate);buffer.getChannelData(0).set(samples);buffers.set(kind,buffer)}
        const node=context.createBufferSource();active=node;
        try{
          node.buffer=buffer;node.connect(context.destination);
          node.onended=()=>{
            try{node.disconnect()}catch{}
            if(active!==node)return;
            active=null;clearTimer('idle');
            idle=platform.setTimeout(()=>{idle=0;if(!active&&ctx===context)discardContext()},15_000);
          };
          node.start();success();return true;
        }catch{retire(node);active=null;return false}
      };
      if(context.state==='running' && begin())return true;
      // Request resume before yielding. A stalled Safari context is retired
      // (not suspended and reused), rather than waiting forever for a promise.
      const resume=context.resume();
      pending=platform.setTimeout(()=>{if(matches()){discardContext();failed(!defaultMedia)}},650);
      Promise.resolve(resume).then(()=>{
        if(matches()&&!begin()){discardContext();failed(!defaultMedia)}
      }).catch(()=>{if(matches()){discardContext();failed(!defaultMedia)}});
      return true;
    }catch{discardContext();failed(!defaultMedia);return false}
  }
  return {play,stop};
}
