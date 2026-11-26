import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {installReadingHome} from '../dist/reading-home.js';

const no=()=>{};
function target(){
  const events=new Map();
  return {
    addEventListener(type,fn){events.set(type,[...(events.get(type)||[]),fn]);},
    fire(type,event={}){for(const fn of events.get(type)||[])fn(event);},
    querySelector(){return target();},setAttribute:no,removeAttribute:no,toggleAttribute:no,
    style:{setProperty:no,removeProperty:no},
  };
}
function fixture(t){
  let elapsed=0,focused=true;
  const start=new Date(2026,10,25,12).getTime(),nodes=new Map(),disk=new Map(),beats=[];
  const $=sel=>{if(!nodes.has(sel))nodes.set(sel,target());return nodes.get(sel);};
  Object.assign($('#home-widget-track'),{children:[target(),target()]});
  Object.assign($('#reading-mini-count'),{firstChild:{},lastElementChild:{}});
  const doc=Object.assign(target(),{documentElement:{},body:{},hidden:false,hasFocus:()=>focused,
    querySelector:s=>s==='dialog[open]'?null:$(s),querySelectorAll:()=>[]});
  const win=Object.assign(target(),{matchMedia:()=>({matches:true})});
  Object.assign($('#reader'),{hidden:false});Object.assign($('#home-view'),{hidden:true});
  for(const [k,value] of Object.entries({document:doc,window:win,
    localStorage:{getItem:k=>disk.get(k),setItem:(k,v)=>disk.set(k,v)},
    MutationObserver:class{observe(){}},setInterval:fn=>beats.push(fn)})){
    const old=Object.getOwnPropertyDescriptor(globalThis,k);
    Object.defineProperty(globalThis,k,{value,writable:true,configurable:true});
    t.after(()=>{if(old)Object.defineProperty(globalThis,k,old);else delete globalThis[k];});
  }
  t.mock.method(Date,'now',()=>start+elapsed);
  t.mock.method(globalThis.performance,'now',()=>elapsed);
  const readingHome=installReadingHome();
  // Feed the real headphone runner's state callback. Audio timing is synthetic;
  // the application's reader lifecycle and local time counter are unmodified.
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  const i=app.indexOf('  onState(status,lang){'),j=app.indexOf('\n});\nlistenButton.onclick=',i);
  assert.ok(i>=0&&j>i);
  const hooks=runInNewContext('({'+app.slice(i,j)+'})',{
    readingHome,current:null,pendingReadingScroll:null,markReadingScrollAnchor:no,listenButton:{setAttribute:no,firstElementChild:{}},
    iconMarkup:()=>'',toast:no,wordSpeechMessage:()=>'',
  });
  readingHome.enterReader();
  function advance(ms){
    for(let n=0;n<ms;n+=5000){elapsed+=5000;for(const beat of beats)beat();}
  }
  const counted=()=>readingHome.getReadingHistory().entries.reduce((sum,x)=>sum+x.elapsedMs,0);
  return {
    advance,counted,status:s=>hooks.onState(s,'en'),hide(){doc.hidden=true;doc.fire('visibilitychange');},
    show(){doc.hidden=false;doc.fire('visibilitychange');},
    blur(){focused=false;win.fire('blur');},focus(){focused=true;win.fire('focus');},
    leave(){readingHome.leaveReader();$('#reader').hidden=true;$('#home-view').hidden=false;},
    label:()=>$('#reading-today').textContent
  };
}

test('the reader counts hands-free listening beyond the touch idle timeout, then stops when paused',t=>{
  const h=fixture(t);h.status('starting');h.status('speaking');
  h.advance(180000);assert.equal(h.counted(),180000);
  h.status('paused');h.advance(30000);assert.equal(h.counted(),180000);
  h.leave();assert.equal(h.label(),'3:00');
});

test('readying a voice does not bypass idle and continued speech never counts while hidden or unfocused',t=>{
  const h=fixture(t);h.status('starting');h.advance(180000);
  assert.equal(h.counted(),120000);
  h.status('speaking');h.advance(15000);assert.equal(h.counted(),135000);
  h.hide();h.advance(20000);assert.equal(h.counted(),135000);
  h.show();h.advance(10000);assert.equal(h.counted(),145000);
  h.blur();h.advance(15000);assert.equal(h.counted(),145000);
  h.focus();h.advance(10000);assert.equal(h.counted(),155000);
  h.status('ended');h.advance(15000);assert.equal(h.counted(),155000);
});
