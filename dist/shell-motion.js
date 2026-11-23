// One visual plate, not four competing active backgrounds. Layout/routing/focus
// always commit synchronously. A second pick starts at the plate's painted box.
export function installNavMotion(dock,{indicator='.nav-current',keyAttribute='view'}={}) {
  const plate=dock.querySelector(indicator);
  const buttons=[...dock.querySelectorAll('button[data-'+keyAttribute+']')];
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  let key='',lastBox='',flight=null,pulse=null;
  function stop(){flight?.cancel();pulse?.cancel();flight=pulse=null}
  function select(next,{animate=false}={}) {
    const target=buttons.find(b=>b.dataset[keyAttribute]===next);
    if(!target)return;
    const x=target.offsetLeft,y=target.offsetTop,w=target.offsetWidth,h=target.offsetHeight;
    if(!w||!h)return; // Reader, hidden ancestor, or detached.
    const signature=[x,y,w,h].join(':');
    if(key===next&&lastBox===signature)return;
    const old=key?plate.getBoundingClientRect():null;
    stop();
    const prior=key;key=next;lastBox=signature;
    Object.assign(plate.style,{left:x+'px',top:y+'px',width:w+'px',height:h+'px'});
    dock.dataset.traveller='';
    if(!prior||!old?.width||!animate||reduce.matches||!plate.animate)return;
    const end=plate.getBoundingClientRect(),delta=old.left-end.left;
    if(Math.abs(delta)<1)return;
    const fromX=old.width/end.width,fromY=old.height/end.height;
    // The leading edge arrives a little sooner than the trailing edge; keep
    // stretch bounded even when jumping directly between the first/last tab.
    const midWidth=1+Math.min(11,Math.abs(delta)*.07)/end.width;
    flight=plate.animate([
      {transform:`translate(${delta}px,${old.top-end.top}px) scale(${fromX},${fromY})`,easing:'cubic-bezier(.26,.07,.22,1)'},
      {offset:.67,transform:`translateX(${delta*.055-(midWidth-1)*end.width*.5}px) scaleX(${midWidth})`,easing:'ease-out'},
      {transform:'none'}
    ],{duration:245});
    const icon=target.querySelector('.icon-glyph');
    if(icon?.animate)pulse=icon.animate([{transform:'scale(.90)'},{offset:.58,transform:'scale(1.065)'},{transform:'none'}],{duration:215,easing:'ease-out'});
  }
  function fit(){if(key)select(key)}
  reduce.addEventListener?.('change',()=>{if(reduce.matches)stop()});
  if(window.ResizeObserver){const ro=new ResizeObserver(fit);ro.observe(dock);buttons.forEach(b=>ro.observe(b))}
  else window.addEventListener('resize',fit,{passive:true});
  return {select};
}
