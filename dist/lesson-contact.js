// A deliberately narrow adaptation of Gradelyy's iPhone HapticButton. Only
// the existing first CHECK action may use this opt-in touch target. The switch
// is NOT over the scroll surface. A real user taps a label; the browser alone
// decides whether its native default activation produces a system tick.
const validTap=(s,e)=>e.timeStamp>=s.t && e.timeStamp-s.t<500 && Math.hypot(e.clientX-s.x,e.clientY-s.y)<=10;
const clickFollowsTap=(s,e)=>e.timeStamp>=s.upAt && e.timeStamp-s.upAt<500;
export function lessonCheckContact(box,button,eligible,activate){
  let input=null,label=null,gesture=null,activating=false;
  function detach(){
    if(activating)return;gesture=null;label?.remove();input?.remove();label=input=null;box.classList.remove('lesson-check-contact');
  }
  function sync(){
    if(!eligible()||button.disabled){detach();return}
    if(label)return;
    box.classList.add('lesson-check-contact');
    input=document.createElement('input');input.type='checkbox';input.setAttribute('switch','');input.tabIndex=-1;
    input.id='lesson-check-tick';input.className='lesson-native-tick';input.setAttribute('aria-hidden','true');
    label=document.createElement('label');label.htmlFor=input.id;label.className='lesson-touch-target';label.setAttribute('aria-hidden','true');
    const cancel=()=>{if(gesture)gesture.cancelled=true};
    label.onpointerdown=e=>{
      if(!e.isTrusted||!e.isPrimary||e.button!==0){cancel();return}
      gesture={id:e.pointerId,x:e.clientX,y:e.clientY,t:e.timeStamp,upAt:null,cancelled:false};
    };
    label.onpointermove=e=>{if(gesture&&(e.pointerId!==gesture.id||!validTap(gesture,e)))cancel()};
    label.onpointerup=e=>{if(gesture){gesture.upAt=e.timeStamp;if(!e.isTrusted||e.pointerId!==gesture.id||!validTap(gesture,e))cancel()}};
    label.onpointercancel=()=>{gesture=null};label.onpointerleave=()=>{if(gesture?.upAt==null)gesture=null};label.oncontextmenu=cancel;
    label.onclick=e=>{
      const s=gesture;gesture=null;
      if(!e.isTrusted||activating||document.hidden||!eligible()||button.disabled){e.preventDefault();return}
      // Virtual accessibility activation normally targets the real button. If
      // it targets the label instead, preserve the action, never fake a tick.
      if(!s && e.detail===0){e.preventDefault();activate(e);return}
      // Pointer up already checked the true contact geometry. Do not require
      // the synthesized browser click to preserve touch coordinates.
      if(s?.upAt==null||s.cancelled||!clickFollowsTap(s,e)){e.preventDefault();return}
      // Check updates the current task in place. Leave its associated switch in
      // the DOM until after native activation. Never .click() either control;
      // input/change handlers cannot grade, so a tap can submit only once.
      activating=true;
      try{activate(e)}finally{
        const here=input;
        setTimeout(()=>{
          activating=false;
          if(here&&document.activeElement===here&&button.isConnected&&!document.hidden)button.focus({preventScroll:true});
          if(!button.isConnected||!eligible()||button.disabled)detach();
        },0);
      }
    };
    box.append(input,label);
  }
  return sync;
}
