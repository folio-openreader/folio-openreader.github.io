import assert from 'node:assert/strict';
import test from 'node:test';
import {installSheet} from '../dist/sheet.js';

function target(){
  const events=new Map();
  return {
    addEventListener(name,listen){events.set(name,[...(events.get(name)||[]),listen])},
    emit(name,event={}){for(const listener of events.get(name)||[]){listener(event);if(event.stopped)break}}
  };
}
function harness(){
  const handle=Object.assign(target(),{setPointerCapture(){},hasPointerCapture(){return false}});
  const dialog=Object.assign(target(),{
    open:false, reason:null, querySelector:()=>handle, classList:{remove(){}},removeAttribute(){},setAttribute(){},style:{removeProperty(){},setProperty(){}},
    getBoundingClientRect(){return {left:0,top:20,right:320,bottom:480}},
    showModal(){this.open=true;this.reason=null},
    close(reason){this.open=false;this.reason=reason;this.emit('close')},
    animate(){throw Error('Reduced motion should close without animation')}
  });
  const backup={window:globalThis.window,document:globalThis.document};
  const win=Object.assign(target(),{matchMedia:()=>({matches:true})});
  globalThis.window=win;globalThis.document=target();
  let block=false,focuses=0;
  const sheet=installSheet(dialog,{canDismiss:()=>!block,opener:{isConnected:true,closest:()=>null,focus(){focuses++}}});
  const pointer=(type,x,y)=>{const e={isTrusted:true,isPrimary:true,button:0,pointerId:5,clientX:x,clientY:y,timeStamp:100+y,target:handle,preventDefault(){}};
    win.emit(type,e);dialog.emit(type,e);handle.emit(type,e)
  };
  const click=({x=150,y=50,detail=1,trusted=true}={})=>{
    const e={isTrusted:trusted,detail,clientX:x,clientY:y,target:handle,stopped:false,preventDefault(){},stopImmediatePropagation(){this.stopped=true}};
    win.emit('click',e);if(!e.stopped)dialog.emit('click',e);if(!e.stopped)handle.emit('click',e);
    return e.stopped;
  };
  return {sheet,dialog,pointer,click,block:value=>{block=value},focuses:()=>focuses,restore(){Object.assign(globalThis,backup)}};
}

test('sheet grip closes for trusted click/tap and keyboard, without treating a drag or locked sheet as a click',()=>{
  const f=harness();
  try {
    f.sheet.open();
    f.pointer('pointerdown',150,50);f.pointer('pointerup',150,51);
    assert.equal(f.click({y:51}),false);
    assert.equal(f.dialog.open,false);assert.equal(f.dialog.reason,'handle');assert.equal(f.focuses(),1);

    f.sheet.open();f.click({detail:0});
    assert.equal(f.dialog.open,false);assert.equal(f.focuses(),2);

    f.sheet.open();
    f.pointer('pointerdown',150,50);f.pointer('pointermove',150,80);f.pointer('pointerup',150,80);
    assert.equal(f.click({y:80}),true);assert.equal(f.dialog.open,true);assert.equal(f.focuses(),2);

    f.pointer('pointerdown',150,50);f.pointer('pointermove',150,118);f.pointer('pointerup',150,118);
    assert.equal(f.dialog.reason,'swipe');assert.equal(f.click({y:118}),true);assert.equal(f.focuses(),3);

    f.sheet.open();
    f.block(true);f.pointer('pointerdown',150,50);f.pointer('pointerup',150,50);f.click();
    assert.equal(f.dialog.open,true);
    f.dialog.emit('cancel',{preventDefault(){}});
    assert.equal(f.dialog.open,true);
    f.block(false);f.click({trusted:false});
    assert.equal(f.dialog.open,true);
    f.dialog.emit('cancel',{preventDefault(){}});
    assert.equal(f.dialog.reason,'escape');assert.equal(f.focuses(),4);
  } finally { f.restore() }
});
