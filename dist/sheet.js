// Shared dismissal for Folio modal sheets.
const TAP_SLOP=14, SWIPE_MIN=64;
export function outsideSheet(rect,x,y){
  return x<rect.left||x>rect.right||y<rect.top||y>rect.bottom;
}
export function isDismissSwipe(start,end){
  const dy=end.y-start.y,dx=Math.abs(end.x-start.x),elapsed=end.time-start.time;
  return elapsed>=0&&dy>=SWIPE_MIN&&dy>dx*1.3;
}
const point=e=>({x:e.clientX,y:e.clientY,time:e.timeStamp});
const near=(a,b,r=TAP_SLOP)=>Math.hypot(a.x-b.x,a.y-b.y)<=r;

let tail=null,tailTimer=0,tailInstalled=false;
function clearTail(){tail=null;clearTimeout(tailTimer);tailTimer=0}
function protectRelease(e){
  clearTail();tail=point(e);tailTimer=setTimeout(clearTail,410);
}
function installTailProtection(){
  if(tailInstalled)return;
  tailInstalled=true;
  window.addEventListener('pointerdown',clearTail,true);
  window.addEventListener('click',e=>{
    if(!tail||!e.isTrusted||e.detail===0||!near(tail,point(e),22))return;
    clearTail();e.preventDefault();e.stopImmediatePropagation();
  },true);
}
export function installSheet(dialog,{opener,canDismiss=()=>true}={}){
  const handle=dialog.querySelector('[data-sheet-handle],[data-prefs-handle]');
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  let outside=null,drag=null,returnMotion=null,exitMotion=null,exitTimer=0;
  installTailProtection();

  function endDrag({rebound=false}={}){
    const prev=drag;drag=null;
    if(prev)try{if(handle.hasPointerCapture(prev.id))handle.releasePointerCapture(prev.id)}catch{}
    const final=prev?.offset||0;
    dialog.removeAttribute('data-sheet-dragging');
    dialog.style.removeProperty('--sheet-drag-y');
    returnMotion?.cancel();returnMotion=null;
    if(rebound&&final&&!reduce.matches&&dialog.open&&dialog.animate){
      returnMotion=dialog.animate([{transform:'translateY('+final+'px)'},{transform:'none'}],{
        duration:155,easing:'cubic-bezier(.23,1,.32,1)'
      });
    }
  }
  function reset(){
    outside=null;endDrag();clearTimeout(exitTimer);exitTimer=0;
    exitMotion?.cancel();exitMotion=null;dialog.removeAttribute('data-sheet-exiting');
  }
  function close(reason){
    if(!dialog.open||exitTimer||!canDismiss())return;
    const offset=drag?.offset||0;
    outside=null;endDrag();
    const finish=()=>{reset();if(dialog.open)dialog.close(reason)};
    if(reduce.matches||!dialog.animate){finish();return}
    const rect=dialog.getBoundingClientRect(),distance=Math.ceil(Math.max(24,window.innerHeight-rect.top)+8);
    dialog.setAttribute('data-sheet-exiting','');
    exitMotion=dialog.animate([{transform:'translateY('+offset+'px)'},{transform:'translateY('+distance+'px)'}],
      {duration:240,easing:'cubic-bezier(.32,0,.67,0)',fill:'both'});
    exitTimer=setTimeout(finish,290);
    exitMotion.onfinish=finish;
  }
  const primary=e=>e.isTrusted&&e.isPrimary&&e.button===0;
  dialog.addEventListener('pointerdown',e=>{
    outside=null;
    if(exitTimer||!canDismiss()){if(exitTimer){e.preventDefault();e.stopImmediatePropagation()}return}
    if(drag&&e.pointerId!==drag.id){endDrag({rebound:true});return}
    if(!primary(e)||e.target!==dialog||!outsideSheet(dialog.getBoundingClientRect(),e.clientX,e.clientY))return;
    outside={id:e.pointerId,at:point(e),released:false};
  },true);
  dialog.addEventListener('pointermove',e=>{
    if(outside&&e.pointerId===outside.id&&!near(outside.at,point(e)))outside=null;
  },true);
  dialog.addEventListener('pointerup',e=>{
    if(outside&&e.pointerId===outside.id){
      outside.released=e.isTrusted&&e.target===dialog&&near(outside.at,point(e))&&outsideSheet(dialog.getBoundingClientRect(),e.clientX,e.clientY);
      if(!outside.released)outside=null;
    }
  },true);
  dialog.addEventListener('pointercancel',()=>{outside=null},true);
  dialog.addEventListener('click',e=>{
    if(exitTimer){e.preventDefault();e.stopImmediatePropagation();return}
    const pair=outside;outside=null;
    if(!pair?.released||!e.isTrusted||e.target!==dialog||!near(pair.at,point(e))||!outsideSheet(dialog.getBoundingClientRect(),e.clientX,e.clientY))return;
    e.preventDefault();e.stopPropagation();close('outside');
  },true);

  handle.addEventListener('pointerdown',e=>{
    if(!primary(e)||drag||!dialog.open||exitTimer||!canDismiss())return;
    returnMotion?.cancel();returnMotion=null;
    drag={id:e.pointerId,start:point(e),offset:0,vertical:false,cancelled:false};
    try{handle.setPointerCapture(e.pointerId)}catch{}
  });
  handle.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId||drag.cancelled)return;
    const dx=Math.abs(e.clientX-drag.start.x),dy=e.clientY-drag.start.y;
    if(!drag.vertical&&dx>12&&dx>Math.abs(dy)*1.1){drag.cancelled=true;return}
    if(dy>7&&dy>dx*1.2)drag.vertical=true;
    if(!drag.vertical||reduce.matches)return;
    drag.offset=Math.max(0,Math.min(dy,150));
    dialog.setAttribute('data-sheet-dragging','');
    dialog.style.setProperty('--sheet-drag-y',drag.offset+'px');
  });
  handle.addEventListener('pointerup',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    const start=drag.start,end=point(e);
    if(e.isTrusted&&!drag.cancelled&&isDismissSwipe(start,end)){
      // The modal owns this pointer, not a control beneath it.
      e.preventDefault();protectRelease(e);close('swipe');return;
    }
    if(!near(start,end,10)||drag.cancelled||drag.vertical)protectRelease(e);
    endDrag({rebound:true});
  });
  for(const event of ['pointercancel','lostpointercapture','pointerleave'])handle.addEventListener(event,e=>{
    if(drag?.id!==e.pointerId)return;
    if(event==='pointerleave'&&handle.hasPointerCapture(e.pointerId))return;
    endDrag({rebound:true});
  });
  // A native click also covers a stationary touch/pen release. Pointer drags
  // already suppress their trailing click before it can reach the handle.
  handle.addEventListener('click',e=>{if(e.isTrusted){e.preventDefault();close('handle')}});
  handle.addEventListener('contextmenu',e=>{if(drag){e.preventDefault();endDrag({rebound:true})}});
  const stopDrag=()=>{outside=null;endDrag()};
  window.addEventListener('blur',stopDrag);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopDrag()});
  reduce.addEventListener?.('change',stopDrag);
  dialog.addEventListener('cancel',e=>{e.preventDefault();close('escape')});
  dialog.addEventListener('keydown',e=>{if(exitTimer){e.preventDefault();e.stopImmediatePropagation()}},true);
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    reset();
    if(opener?.isConnected&&!opener.closest('[hidden]'))opener.focus({preventScroll:true});
  });

  return {open(){if(!dialog.open){reset();dialog.showModal()}}};
}

export const installReaderPreferences=(dialog,opener)=>installSheet(dialog,{opener});
