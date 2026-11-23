(() => {
  'use strict';
  // This short authored demo never touches the reader's books, settings or network.
  const glosses = new Map([['lantern','фонарь'], ['canal','канал'], ['ferry','паром']]);
  const find = s => document.querySelector(s);
  const sample = find('.reader-sample'), word = find('#example-word'), gloss = find('#example-gloss');
  const announcement = find('#demo-announcement'), replay = find('#demo-replay');
  if (!sample || !word || !gloss || !announcement || !replay) return;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const buttons = new Map(), timers = new Set();
  let active = 'lantern', played = false, triggered = false, inView = false, observeDemo;
  const later = (f, delay) => {
    const timer = window.setTimeout(() => { timers.delete(timer); f(); },delay);
    timers.add(timer);
  };
  function cancel() {
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    for (const b of buttons.values()) b.classList.remove('pointing','show-gloss');
  }
  function display(key, speak, bubble=false) {
    active = key;
    for (const [k,b] of buttons) b.setAttribute('aria-pressed',String(k===key));
    word.textContent = key;
    gloss.textContent = glosses.get(key);
    sample.classList.remove('demo-waiting');
    if (speak) announcement.textContent = key + ': ' + glosses.get(key) + '.';
    if (bubble && !motion.matches) {
      const b = buttons.get(key); b.classList.add('show-gloss');
      later(() => b.classList.remove('show-gloss'),1250);
    }
  }
  function settle(){
    cancel();display(active,false);
  }
  for (const span of document.querySelectorAll('[data-example]')) {
    const key = span.dataset.example;
    if (!glosses.has(key)) continue;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'word'; b.textContent = key;
    b.setAttribute('aria-pressed',String(key===active));
    b.setAttribute('aria-controls','demo-note');
    // Actual element, not generated textual content, keeps accessible button names clean.
    const bubble = document.createElement('span');
    bubble.setAttribute('aria-hidden','true');bubble.className = 'word-bubble';bubble.textContent = glosses.get(key);bubble.lang = 'ru';b.append(bubble);
    b.addEventListener('focus',() => {played=true;triggered=false;settle();});
    b.addEventListener('click',() => {played=true;triggered=false;cancel();display(key,true,true);});
    span.replaceWith(b);buttons.set(key,b);
  }
  if (!buttons.has('lantern')) return;
  function play(manual=false) {
    cancel();played=true;triggered=true;active='lantern';
    if (motion.matches || (!manual && document.hidden)) {display('lantern',manual);triggered=false;return}
    sample.classList.add('demo-waiting');
    for (const b of buttons.values()) b.setAttribute('aria-pressed','false');
    later(() => buttons.get('lantern').classList.add('pointing'),180);
    later(() => display('lantern',manual,true),610);
    later(() => {buttons.get('lantern').classList.remove('pointing');triggered=false;},1160);
  }
  replay.addEventListener('click',() => play(true));
  replay.hidden = false;
  if ('IntersectionObserver' in window) {
    observeDemo = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting && entry.intersectionRatio >= .9;
      if (!inView) {
        if (triggered) {triggered=false;settle();}
        return;
      }
      if (!played && !document.hidden) play();
    }, {threshold:[0,.9], rootMargin:'0px 0px -12% 0px'});
    // Retain the progressive no-JS result for unsupported/reduced-motion readers.
    if (!motion.matches) sample.classList.add('demo-waiting');
    observeDemo.observe(buttons.get('lantern'));
  }
  // Scroll-driven book in real CSS perspective. No forever animation/rAF loop.
  const stage=find('.exhibit'), hero=find('.hero');
  let heroObserved=true, pendingFrame=0;
  function updateArt() {
    pendingFrame=0;
    if(!stage||!hero||motion.matches||document.hidden||!heroObserved)return;
    const rect=hero.getBoundingClientRect(), travel=Math.max(0,Math.min(1,-rect.top/Math.max(1,rect.height)));
    stage.style.setProperty('--pitch',(6-travel*8).toFixed(2)+'deg');
    stage.style.setProperty('--yaw',(-22+travel*22).toFixed(2)+'deg');
    stage.style.setProperty('--open',(travel*-32).toFixed(2)+'deg');
    stage.style.setProperty('--lift',(-travel*12).toFixed(2)+'px');
    stage.style.setProperty('--chart-y',(travel*15).toFixed(2)+'px');
  }
  function queueArt(){if(!motion.matches&&!document.hidden&&heroObserved&&!pendingFrame)pendingFrame=window.requestAnimationFrame(updateArt);}
  if(stage&&hero){
    if('IntersectionObserver' in window){
      const observeHero=new IntersectionObserver(([e])=>{heroObserved=e.isIntersecting;if(heroObserved)queueArt();});
      observeHero.observe(hero);
    }
    window.addEventListener('scroll',queueArt,{passive:true});
    queueArt();
  }
  function reflectMotion(){
    triggered=false;settle();
    for(const p of ['--pitch','--yaw','--open','--lift','--chart-y'])stage?.style.removeProperty(p);
    if(!motion.matches)queueArt();
  }
  if (motion.addEventListener) motion.addEventListener('change',reflectMotion);
  else if (motion.addListener) motion.addListener(reflectMotion);
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) {triggered=false;settle();}
    else {queueArt();if(inView&&!played)play();}
  });
})();
