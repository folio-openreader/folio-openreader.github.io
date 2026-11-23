// One interruptible animation per destination. Navigation never waits for it.
const running = new WeakMap();
const ease = 'cubic-bezier(0.23, 1, 0.32, 1)';
export function cancelMotion(element) {
  running.get(element)?.cancel();
  running.delete(element);
}
export function revealMotion(element, kind, {enabled=true}={}) {
  cancelMotion(element);
  if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !element.animate) return null;
  const presets = {
    reader: {'from': 'translateY(6px)', 'duration': 165},
    home: {'from': 'translateY(-4px)', 'duration': 145},
    tabForward: {'from': 'translateX(7px)', 'duration': 155},
    tabBack: {'from': 'translateX(-7px)', 'duration': 155},
    panel: {'from': 'translateY(4px)', 'duration': 135},
    file: {'from': 'scale(0.985)', 'duration': 155},
  };
  const p = presets[kind] || presets.panel;
  const animation = element.animate(
    [{opacity: kind==='file'?0.74:0.90,transform:p.from},{opacity:1,transform:'none'}],
    {duration:p.duration,easing:ease}
  );
  running.set(element, animation);
  const clear=()=>{if(running.get(element)===animation)running.delete(element)};
  animation.onfinish=animation.oncancel=clear;
  return animation;
}

// A brief outcome cue leaves the action, focus and history synchronous.
const cueTimers=new WeakMap();
export function outcomeCue(element,kind,hold=600){
  if(!element)return;
  clearTimeout(cueTimers.get(element));
  element.dataset.outcomeCue=kind;
  cueTimers.set(element,setTimeout(()=>{
    delete element.dataset.outcomeCue;cueTimers.delete(element);
  },hold));
}
