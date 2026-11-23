// Press behavior adapted from DesignBookmark's MIT Command button.
// https://designbookmark.com/motion-src/react/command-button.tsx
// Folio has no search field or hotkey here: the existing button still starts
// the series. These listeners only change the spring's visual target.
export const COMMAND_PRESS = Object.freeze({stiffness:520,damping:34,mass:.6,scale:.97});
const {stiffness,damping,mass}=COMMAND_PRESS;
const decay=-damping/(2*mass), frequency=Math.sqrt(stiffness/mass-decay**2);
const SCALE_PROP='--command-scale';

export function sampleCommandSpring(from, velocity, target, seconds){
  const angle=frequency*seconds,attenuation=Math.exp(decay*seconds);
  const a=from-target,b=(velocity-decay*a)/frequency;
  const c=Math.cos(angle),s=Math.sin(angle),delta=a*c+b*s;
  return {
    scale:target+attenuation*delta,
    velocity:attenuation*(decay*delta+frequency*(-a*s+b*c)),
  };
}

const isPressKey=e=>!e.isComposing&&(e.key===' '||e.key==='Enter');

export function installCommandButton(button){
  if(!button||button.id!=='lesson-start'||button.hasAttribute('data-command-button'))return ()=>{};
  const doc=button.ownerDocument,view=doc.defaultView,reduced=view.matchMedia('(prefers-reduced-motion: reduce)');
  const controller=new AbortController(),{signal}=controller;
  let from=1,velocity=0,target=1,start=0,raf=0,pointer=null,keyboard=null;
  button.setAttribute('data-command-button','');

  function canMove(){return !reduced.matches&&!doc.hidden&&button.isConnected&&!button.disabled&&!button.closest('[hidden]')}
  function reset(){
    if(raf)view.cancelAnimationFrame(raf);
    raf=0;from=target=1;velocity=0;start=0;pointer=keyboard=null;button.style.removeProperty(SCALE_PROP);
  }
  function render(now){
    raf=0;
    if(!canMove()){reset();return}
    const next=sampleCommandSpring(from,velocity,target,Math.max(0,(now-start)/1000));
    if(Math.abs(next.scale-target)<.00015&&Math.abs(next.velocity)<.003){
      from=target;velocity=0;start=now;
      if(target===1)button.style.removeProperty(SCALE_PROP);
      else button.style.setProperty(SCALE_PROP,String(target));
      return;
    }
    button.style.setProperty(SCALE_PROP,next.scale.toFixed(5));
    raf=view.requestAnimationFrame(render);
  }
  function setPress(){
    if(!canMove()){reset();return}
    const next=pointer!==null||keyboard!==null?COMMAND_PRESS.scale:1;
    if(next===target)return;
    const now=view.performance.now(),current=sampleCommandSpring(from,velocity,target,Math.max(0,(now-start)/1000));
    from=current.scale;velocity=current.velocity;target=next;start=now;
    if(!raf)raf=view.requestAnimationFrame(render);
  }
  function releasePointer(e){if(e.pointerId===pointer){pointer=null;setPress()}}

  button.addEventListener('pointerdown',e=>{
    if(e.button!==0||!e.isPrimary||pointer!==null||!canMove())return;
    pointer=e.pointerId;setPress();
  },{signal,passive:true});
  for(const type of ['pointerup','pointerleave','pointercancel','lostpointercapture']){
    button.addEventListener(type,releasePointer,{signal,passive:true});
  }
  button.addEventListener('keydown',e=>{
    if(!e.repeat&&isPressKey(e)&&canMove()){keyboard=e.key;setPress()}
  },{signal});
  button.addEventListener('keyup',e=>{
    if(e.key===keyboard){keyboard=null;setPress()}
  },{signal});
  button.addEventListener('blur',reset,{signal});
  view.addEventListener('blur',reset,{signal});
  doc.addEventListener('visibilitychange',reset,{signal});
  reduced.addEventListener('change',reset,{signal});
  return ()=>{controller.abort();reset();button.removeAttribute('data-command-button')};
}
