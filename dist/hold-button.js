import {installSheet} from './sheet.js';
// Vanilla interpretation of Kokonut UI's MIT Hold Button (see hold-button.LICENSE.txt).
export const HOLD_MS=1200;
export const holdKey=key=>key===' '||key==='Enter';
const DRAIN_MS=300,LABEL_DELAY=150,CONFIRMED_MS=1800,EASE='cubic-bezier(.23,1,.32,1)';

export function createHoldGate(duration=HOLD_MS){
  let held=null;
  function progress(now){return held===null?0:Math.max(0,Math.min(1,(now-held.at)/duration))}
  return {
    get pointer(){return held?.id??null},
    begin(id,now){if(held!==null||!Number.isFinite(now))return false;held={id,at:now};return true},
    cancel(id){if(held===null||(id!==undefined&&id!==held.id))return false;held=null;return true},
    release(id,now,inside){
      if(held===null||id!==held.id)return false;
      const ready=inside&&progress(now)>=1;held=null;return ready;
    },
    progress,
  };
}

const trash='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3m3 0-.75 12.2A2 2 0 0 1 15.25 21h-6.5a2 2 0 0 1-2-1.8L6 7m4 4v6m4-6v6"/></svg>';
const check='<svg class="hold-check" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path pathLength="1" d="m5 12 4 4L19 6"/></svg>';
const textByPhase={idle:'Удерживайте, чтобы удалить',holding:'Продолжайте удерживать',ready:'Отпустите, чтобы удалить',pending:'Удаляем…',complete:'Удалено'};

export function createWordDeleteDialog(){
  const dialog=document.createElement('dialog');
  dialog.id='word-delete';
  dialog.className='word-delete-dialog';
  dialog.setAttribute('aria-labelledby','word-delete-title');
  dialog.setAttribute('aria-describedby','word-delete-name word-delete-note');
  // Only the fixed UI is HTML. The selected count is inserted as text.
  dialog.innerHTML=`
    <button type="button" data-sheet-handle aria-label="Закрыть панель" autofocus></button>
    <div class="dialog-heading"><h2 id="word-delete-title">Удалить слова?</h2></div>
    <p id="word-delete-name" class="delete-summary" dir="auto"></p>
    <p id="word-delete-note">Отмеченные слова и их прогресс будут удалены из словаря.</p>
    <div class="delete-actions">
      <button type="button" class="word-hold" data-phase="idle" aria-label="Удерживайте, чтобы удалить. С клавиатуры удерживайте пробел или Enter.">
        <span class="word-hold-fill" aria-hidden="true"></span>
        <span class="word-hold-label" aria-hidden="true"></span>
      </button>
    </div>
    <p class="delete-status" role="status" aria-live="polite" aria-atomic="true"></p>`;
  document.body.append(dialog);
  const q=s=>dialog.querySelector(s), title=q('#word-delete-title'),name=q('#word-delete-name'),h=q('.word-hold'),fill=q('.word-hold-fill'),label=q('.word-hold-label'),grip=q('[data-sheet-handle]'),status=q('.delete-status');
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)'), gate=createHoldGate();
  let request=null,phase='idle',p=0,frame=0,labelTimer=0,readyTimer=0,closeTimer=0,drain=null;
  const sheet=installSheet(dialog,{canDismiss:()=>!request?.pending});
  const mono=()=>performance.now();
  function paintProgress(value){p=value;fill.style.transform='scaleX('+value+')'}
  function paintPhase(next,animate=true){
    if(phase===next&&label.firstChild)return;
    phase=next;h.dataset.phase=next;
    label.replaceChildren();
    const content=document.createElement('span');
    content.innerHTML=next==='complete'?check:trash;
    content.append(document.createTextNode(textByPhase[next]));
    label.append(content);
    if(animate&&!reduced.matches)content.animate?.(
      [{transform:'translateY(8px)',opacity:.45},{transform:'none',opacity:1}],{duration:200,easing:EASE});
  }
  function clearHoldClock(){
    cancelAnimationFrame(frame);clearTimeout(labelTimer);clearTimeout(readyTimer);frame=labelTimer=readyTimer=0;
  }
  function releaseCapture(id){try{if(typeof id==='number'&&h.hasPointerCapture(id))h.releasePointerCapture(id)}catch{}}
  function resetVisual(drainBack=false){
    drain?.cancel();drain=null;
    const from=p;paintProgress(0);
    if(drainBack&&!reduced.matches&&from>0)drain=fill.animate?.([{transform:'scaleX('+from+')'},{transform:'scaleX(0)'}],{duration:from*DRAIN_MS,easing:EASE})??null;
    if(phase==='holding'||phase==='ready')paintPhase('idle');
  }
  function abort(id,drainBack=true){
    const old=gate.pointer;
    if(!gate.cancel(id))return;
    clearHoldClock();releaseCapture(old);resetVisual(drainBack);status.textContent='';
  }
  function tick(){
    if(gate.pointer===null)return;
    const value=gate.progress(mono());paintProgress(value);
    if(value<1)frame=requestAnimationFrame(tick);
  }
  function inside(e){const r=h.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom}
  function trusted(e){return e.isTrusted===true&&dialog.open&&!!request&&!request.pending&&!request.done&&!document.hidden}
  function buttonsLocked(locked){h.disabled=grip.disabled=locked}
  function beginHold(id,at){
    if(!gate.begin(id,at))return false;
    resetVisual();status.textContent='';
    if(!reduced.matches)frame=requestAnimationFrame(tick);
    labelTimer=setTimeout(()=>{if(gate.pointer===id)paintPhase('holding')},LABEL_DELAY);
    readyTimer=setTimeout(()=>{if(gate.pointer===id){
      paintProgress(1);paintPhase('ready');
      if(typeof id==='string')status.textContent='Отпустите клавишу, чтобы удалить.';
    }},Math.max(0,HOLD_MS-(mono()-at)));
    return true;
  }
  function start(e){
    if(!trusted(e)||!e.isPrimary||e.button!==0||!inside(e)||!beginHold(e.pointerId,e.timeStamp))return;
    try{h.setPointerCapture(e.pointerId)}catch{}
  }
  function finishHold(id,at,valid){
    if(id!==gate.pointer)return;
    const value=gate.progress(at),ready=gate.release(id,at,valid);
    clearHoldClock();releaseCapture(id);
    if(ready){paintProgress(1);void perform()}
    else{paintProgress(value);resetVisual(true)}
  }
  function failPress(id){abort(id)}
  async function perform(){
    if(!request||request.pending||request.done||!dialog.open)return;
    const active=request;
    active.pending=true;paintPhase('pending');buttonsLocked(true);
    // Disabling the active action must not send focus behind the modal.
    title.tabIndex=-1;title.focus({preventScroll:true});
    status.textContent='Удаляем слова…';
    try{
      active.message=await active.remove();
      active.done=true;paintPhase('complete');
      grip.disabled=false;
      status.textContent=active.message||'Слова удалены.';
      grip.focus({preventScroll:true});
      closeTimer=setTimeout(()=>{if(request===active&&dialog.open)dialog.close()},reduced.matches?700:CONFIRMED_MS);
    }catch{
      resetVisual();paintPhase('idle',false);buttonsLocked(false);
      status.textContent='Не удалось удалить слова. Попробуйте ещё раз.';
      h.focus({preventScroll:true});
    }finally{
      active.pending=false;
    }
  }
  h.addEventListener('pointerdown',start);
  h.addEventListener('pointermove',e=>{
    if(e.pointerId===gate.pointer&&(!inside(e)||(e.pointerType==='mouse'&&!(e.buttons&1))))failPress(e.pointerId);
  });
  h.addEventListener('pointerup',e=>finishHold(e.pointerId,e.timeStamp,trusted(e)&&inside(e)));
  h.addEventListener('keydown',e=>{
    if(!holdKey(e.key)||e.altKey||e.ctrlKey||e.metaKey)return;
    e.preventDefault();
    if(trusted(e)&&!e.repeat)beginHold(e.code||e.key,e.timeStamp);
  });
  h.addEventListener('keyup',e=>{
    if(!holdKey(e.key))return;
    e.preventDefault();
    finishHold(e.code||e.key,e.timeStamp,trusted(e)&&document.activeElement===h);
  });
  for(const event of ['pointercancel','lostpointercapture','pointerleave'])h.addEventListener(event,e=>{
    if(e.pointerId===gate.pointer)failPress(e.pointerId);
  });
  h.addEventListener('contextmenu',e=>{if(gate.pointer!==null)e.preventDefault()});
  h.addEventListener('blur',()=>failPress());
  h.addEventListener('click',e=>{
    e.preventDefault();
    if(trusted(e)&&e.detail===0&&gate.pointer===null)status.textContent='Удерживайте кнопку, пробел или Enter.';
  });
  dialog.addEventListener('pointerdown',e=>{
    if(gate.pointer!==null&&e.pointerId!==gate.pointer)failPress();
  },true);
  dialog.addEventListener('cancel',e=>{if(request?.pending)e.preventDefault();else failPress()});
  dialog.addEventListener('close',()=>{
    failPress();clearTimeout(closeTimer);closeTimer=0;drain?.cancel();
    const active=request;
    if(!active||dialog.open)return;
    request=null;
    const target=active.trigger?.isConnected&&!active.trigger.closest('[hidden]')?active.trigger:active.focusFallback?.();
    if(target&&!target.closest('[hidden]'))target.focus({preventScroll:true});
  });
  window.addEventListener('blur',()=>failPress());
  window.addEventListener('pagehide',()=>failPress());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)failPress()});
  window.addEventListener('hashchange',()=>{if(dialog.open&&!request?.pending)dialog.close()});
  reduced.addEventListener?.('change',()=>failPress());

  return {open({wordCount,trigger,remove,focusFallback}){
    if(dialog.open||request)return;
    request={trigger,remove,focusFallback,pending:false,done:false};
    name.textContent=wordCount;status.textContent='';
    buttonsLocked(false);resetVisual();paintPhase('idle',false);
    sheet.open();
  }};
}
