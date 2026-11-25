import {createReadingTime,READING_TIME_KEY,READING_GOAL_KEY} from './reading-time.js';
import {installSheet} from './sheet.js';

export function installReadingHome({goHome=()=>{}}={}){
  const q=s=>document.querySelector(s), track=q('#home-widget-track'), slides=[...track.children];
  const dots=[...document.querySelectorAll('[data-home-widget]')], hero=q('#home-view');
  const mini=q('#reading-goal-shortcut'), goal=q('#reading-goal-widget'), value=q('#reading-today');
  const miniValue=q('#reading-mini-count'), open=q('#reading-goal-open'), form=q('#reading-goal-form');
  const dialog=q('#reading-goal-dialog'), minutes=q('#reading-goal-minutes'), status=q('#reading-goal-status');
  const sheet=installSheet(dialog,{opener:open});
  const reader=q('#reader'), timer=createReadingTime();
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)');
  const IDLE_MS=120000;
  let scrollFrame=0,lastActivity=-Infinity,focused=document.hasFocus(),lastView='',active=false,pageVisible=true,narrating=false;
  function select(index){
    for(const [i,slide] of slides.entries()){
      // The inactive slide stays in layout for native scrolling but is not announced.
      slide.inert=i!==index;
      if(i===index)slide.removeAttribute('aria-hidden');else slide.setAttribute('aria-hidden','true');
    }
    for(const [i,dot] of dots.entries())dot.setAttribute('aria-pressed',String(i===index));
  }
  function go(index){
    const left=slides[index].offsetLeft-slides[0].offsetLeft;
    if(!track.clientWidth)return;
    track.scrollTo({left,behavior:reduce.matches?'instant':'smooth'});
    if(Math.abs(track.scrollLeft-left)<2)select(index);
  }
  track.addEventListener('scroll',()=>{
    if(scrollFrame)return;
    scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;if(track.clientWidth)select(Math.round(track.scrollLeft/track.clientWidth)>0?1:0)});
  },{passive:true});
  dots.forEach((d,index)=>d.addEventListener('click',()=>go(index)));
  mini.addEventListener('click',e=>{if(hero.hidden)goHome(e);go(1)});
  function render({elapsedMs,goalMinutes,day}=timer.getToday()){
    const seconds=Math.floor(elapsedMs/1000),mins=Math.floor(seconds/60),hit=elapsedMs>=goalMinutes*60000;
    const signature=day+':'+seconds+':'+goalMinutes;
    if(lastView===signature)return;lastView=signature;
    value.textContent=mins+':'+String(seconds%60).padStart(2,'0');
    miniValue.firstChild.nodeValue=String(mins);miniValue.lastElementChild.textContent=' / '+goalMinutes;
    mini.setAttribute('aria-label','Показать дневную цель: '+mins+' из '+goalMinutes+' мин');
    open.textContent=hit?'Цель достигнута · '+goalMinutes+' мин':'Цель: '+goalMinutes+' мин';
    for(const el of [goal,mini]){
      el.style.setProperty('--reading-goal-progress',String(Math.min(100,elapsedMs/(goalMinutes*600))));
      el.toggleAttribute('data-has-time',seconds>0);
    }
  }
  function sync({tick=false}={}){
    const next=pageVisible&&!reader.hidden&&!document.hidden&&focused&&!document.querySelector('dialog[open]')&&(narrating||performance.now()-lastActivity<IDLE_MS);
    if(next!==active){active=next;render(timer.setActive(active))}
    else if(tick&&next)timer.tick();
    else if(tick&&!hero.hidden)render();
  }
  function activity(e){
    if(!e.isTrusted||reader.hidden||document.querySelector('dialog[open]'))return;
    lastActivity=performance.now();
    // Direct gestures can restore focus on an installed mobile browser.
    if(e.type==='pointerdown')focused=true;
    if(!active)sync();
  }
  for(const name of ['pointerdown','keydown'])document.addEventListener(name,activity,{capture:true,passive:true});
  q('#reading-scroll').addEventListener('wheel',activity,{passive:true});
  q('#reading-scroll').addEventListener('touchmove',activity,{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)focused=document.hasFocus();sync();if(!document.hidden)render()});
  window.addEventListener('focus',()=>{focused=true;sync();render()});
  window.addEventListener('blur',()=>{focused=false;sync()});
  window.addEventListener('pagehide',()=>{pageVisible=false;sync()});
  window.addEventListener('pageshow',()=>{pageVisible=true;focused=document.hasFocus();sync();render()});
  window.addEventListener('storage',e=>{if(e.key===READING_TIME_KEY||e.key===READING_GOAL_KEY||e.key===null)render()});
  const watcher=new MutationObserver(()=>sync());
  watcher.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open'],childList:false});
  setInterval(()=>{if(!document.hidden)sync({tick:true})},5000);
  open.addEventListener('click',()=>{status.hidden=true;minutes.value=timer.getToday().goalMinutes;sheet.open()});
  form.addEventListener('submit',e=>{
    e.preventDefault();
    if(!e.isTrusted||!dialog.open||!form.reportValidity())return;
    const n=minutes.valueAsNumber, result=timer.setGoal(n);
    if(result.goalMinutes!==n){status.textContent='Введите от 1 до 240 минут.';status.hidden=false;return}
    render(result);
    if(!timer.goalStored){status.textContent='Цель изменена в этой вкладке. Браузер не сохранил её.';status.hidden=false;return}
    dialog.close();
  });
  render();
  return {
    enterReader(){lastActivity=performance.now();sync()},
    leaveReader(){narrating=false;lastActivity=-Infinity;sync();render()},
    // Only the actual 'speaking' state bypasses the gesture idle timer.
    // Hidden, blurred or covered readers remain excluded as before.
    setNarrating(value){if(narrating===value)return;narrating=value;sync()},
    render,
    getReadingHistory: timer.getHistory,
    focusContinue(){go(0);track.scrollTo({left:0,behavior:'instant'});select(0);slides[0].querySelector('button')?.focus({preventScroll:true})}
  };
}
