const clamp=(n,lo,hi)=>Math.min(hi,Math.max(lo,n));
function smoothBetween(t,lo,hi){
  const x=clamp((t-lo)/(hi-lo),0,1);
  return x*x*(3-2*x);
}

// The early lift is measured above the higher endpoint, not as a fixed bend
// away from the direct line: even a long drop starts by lifting off the word.
export function wordFlightPath(from,to,{width=0,top=0}={}){
  const dx=to.x-from.x,dy=to.y-from.y,distance=Math.hypot(dx,dy);
  const lift=clamp(Math.min(25+distance*.05,Math.min(from.y,to.y)-top-18),0,49);
  const bend=Math.abs(dy)+2*lift+2*Math.sqrt(lift*(lift+Math.abs(dy)));
  // With almost vertically aligned endpoints, give the arc room to read.
  const lateral=(from.x<width/2?1:-1)*clamp(30-Math.abs(dx)*.45,0,30);
  const duration=Math.round(clamp(740+distance*.21,740,900));
  const frames=Array.from({length:49},(_,i)=>{
    const t=i/48,p=t*(.36+.64*t),arc=p*(1-p);
    const x=dx*p+4*lateral*arc,y=dy*p-bend*arc;
    const scale=1+.07*smoothBetween(t,0,.19)-.87*smoothBetween(t,.27,.99);
    const opacity=(1-smoothBetween(t,.85,1))*(.5+.5*smoothBetween(t,0,.09));
    return {x,y,scale,opacity,t};
  });
  return {duration,frames};
}

// One flight at a time. The overlay joins the native top layer, above the word
// sheet and its backdrop; older browsers animate within the card instead.
export function makeWordFlight(dialog,target){
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,ghost=null,flight=null,arrival=null;
  function removeGhost(){
    try{ghost?.hidePopover?.()}catch{}
    ghost?.remove();ghost=null;
  }
  function cancel(){
    cancelAnimationFrame(frame);flight?.cancel();arrival?.cancel();removeGhost();
    flight=arrival=null;target.removeAttribute('data-arriving');
  }
  function start(text,from,heading){
    cancel();
    if(reduce.matches||!target.animate||document.hidden||!text)return;
    target.setAttribute('data-arriving','');
    frame=requestAnimationFrame(()=>{
      if(!dialog.open||dialog.hasAttribute('data-sheet-exiting')||target.getAttribute('aria-pressed')!=='true'){cancel();return}
      const center=r=>({x:(r.left+r.right)/2,y:(r.top+r.bottom)/2});
      const to=center(target.getBoundingClientRect()), label=center(heading.getBoundingClientRect());
      // The sheet can still be sliding in on the first frame. For the fixed
      // overlay, target its resting center instead of its transient location.
      const rect=dialog.getBoundingClientRect(), css=getComputedStyle(dialog);
      let landing=to;
      try{
        if(css.transform!=='none'){
          const matrix=new DOMMatrixReadOnly(css.transform);
          const [ox,oy]=css.transformOrigin.split(' ').map(parseFloat);
          const baseX=rect.left-(ox*(1-matrix.a)+matrix.e),baseY=rect.top-(oy*(1-matrix.d)+matrix.f);
          landing={x:baseX+(to.x-rect.left)/matrix.a,y:baseY+(to.y-rect.top)/matrix.d};
        }
      }catch{}
      ghost=document.createElement('span');ghost.className='word-flight';
      ghost.setAttribute('aria-hidden','true');ghost.textContent=Array.from(text).slice(0,40).join('');
      ghost.setAttribute('popover','manual');dialog.append(ghost);
      let origin=center(from),offset={x:0,y:0};
      try{ghost.showPopover()}
      catch{
        ghost.removeAttribute('popover');ghost.classList.add('word-flight-inline');
        origin=label;
        const r=dialog.getBoundingClientRect();offset={x:r.left+dialog.clientLeft-dialog.scrollLeft,y:r.top+dialog.clientTop-dialog.scrollTop};
      }
      if(origin.x<0||origin.x>innerWidth||origin.y<0||origin.y>innerHeight||Math.hypot(origin.x-to.x,origin.y-to.y)<30)origin=label;
      ghost.style.left=(origin.x-offset.x)+'px';ghost.style.top=(origin.y-offset.y)+'px';
      const endpoint=ghost.classList.contains('word-flight-inline')?to:landing;
      const {duration,frames}=wordFlightPath(origin,endpoint,{
        width:innerWidth,top:ghost.classList.contains('word-flight-inline')?offset.y:0,
      });
      flight=ghost.animate(frames.map(({x,y,scale,opacity,t})=>({
        transform:`translate(-50%,-50%) translate(${x}px,${y}px) scale(${scale})`,
        opacity,offset:t,
      })),{duration,easing:'linear',fill:'both'});
      flight.onfinish=()=>{
        removeGhost();flight=null;target.removeAttribute('data-arriving');
        if(dialog.open&&!dialog.hasAttribute('data-sheet-exiting')&&target.getAttribute('aria-pressed')==='true')
          arrival=target.animate([
            {transform:'scale(1)',easing:'ease-out'},
            {transform:'scale(1.045,.935)',offset:.22,easing:'cubic-bezier(.18,.7,.34,1)'},
            {transform:'scale(.992,1.044)',offset:.56,easing:'ease-out'},
            {transform:'scale(1)'},
          ],{duration:280});
      };
    });
  }
  reduce.addEventListener?.('change',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel()});
  return {start,cancel};
}
