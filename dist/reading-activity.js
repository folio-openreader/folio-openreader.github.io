import {READING_TIME_KEY} from './reading-time.js';

const WEEKS=7, MINUTE=60000;
const WEEKDAYS=['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];
const SHORT_DAYS=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const dateFormat=new Intl.DateTimeFormat('ru',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const plural=new Intl.PluralRules('ru');
const localDate=key=>{const [y,m,d]=key.split('-').map(Number);return new Date(y,m-1,d,12)};
const dayKey=d=>[d.getFullYear(),d.getMonth()+1,d.getDate()].map(n=>String(n).padStart(2,'0')).join('-');

export function readingLevel(ms){
  return ms>=30*MINUTE?4:ms>=15*MINUTE?3:ms>=5*MINUTE?2:ms>0?1:0;
}

export function readingCalendar({day,entries}){
  const today=localDate(day), start=new Date(today);
  start.setDate(start.getDate()-(WEEKS-1)*7-(start.getDay()+6)%7);
  const durations=new Map(entries.map(entry=>[entry.day,entry.elapsedMs]));
  const rows=Array.from({length:7},()=>[]);
  let count=0;
  for(let week=0;week<WEEKS;week++){
    for(let weekday=0;weekday<7;weekday++,start.setDate(start.getDate()+1)){
      if(start>today){rows[weekday].push(null);continue}
      const key=dayKey(start), ms=durations.get(key)||0, level=readingLevel(ms);
      if(level)count++;
      rows[weekday].push({day:key,ms,level});
    }
  }
  return {day,rows,count};
}

export function readingDuration(ms){
  if(!ms)return 'Нет записей';
  const seconds=Math.floor(ms/1000);
  if(!seconds)return 'Менее 1 с';
  const hours=Math.floor(seconds/3600), minutes=Math.floor(seconds/60)%60, rest=seconds%60;
  return [hours&&hours+' ч',minutes&&minutes+' мин',rest&&rest+' с'].filter(Boolean).join(' ');
}

export function calendarDestination(rows,row,column,key,ctrl=false){
  const valid=(r,c)=>rows[r]?.[c]!=null;
  const first=values=>values.findIndex(Boolean);
  const last=values=>values.findLastIndex(Boolean);
  let r=row,c=column;
  switch(key){
    case 'ArrowLeft':c--;break;
    case 'ArrowRight':c++;break;
    case 'ArrowUp':r--;break;
    case 'ArrowDown':r++;break;
    case 'Home':if(ctrl)r=0;c=first(rows[r]);break;
    case 'End':if(ctrl)r=6;c=last(rows[r]);break;
    default:return null;
  }
  return valid(r,c)?[r,c]:[row,column];
}

export function installReadingActivity(root,readHistory){
  const grid=root.querySelector('[data-reading-grid]');
  const count=root.querySelector('[data-reading-days]');
  const date=root.querySelector('[data-reading-date]');
  const duration=root.querySelector('[data-reading-duration]');
  const doc=root.ownerDocument, win=doc.defaultView;
  let selected='', lastDay='', signature='', rows=[], nodes=new Map();
  function select(day,focus=false){
    const item=nodes.get(day);
    if(!item)return;
    const old=nodes.get(selected);
    if(old){old.button.tabIndex=-1;old.cell.setAttribute('aria-selected','false')}
    selected=day;
    item.button.tabIndex=0;
    item.cell.setAttribute('aria-selected','true');
    date.dateTime=day;date.textContent=item.label;
    duration.textContent=item.duration;
    if(focus)item.button.focus({preventScroll:true});
  }
  function render(){
    const model=readingCalendar(readHistory());
    const next=JSON.stringify(model);
    if(next===signature)return;
    signature=next;
    const focusWasInside=grid.contains(doc.activeElement);
    const prior=selected===lastDay?model.day:selected;
    lastDay=model.day;rows=model.rows;nodes=new Map();
    count.textContent=model.count+' '+({one:'день',few:'дня',many:'дней'}[plural.select(model.count)]||'дней')+' чтения';
    const fragment=doc.createDocumentFragment();
    for(const [r,days] of rows.entries()){
      const row=doc.createElement('div');row.className='reading-activity-row';row.setAttribute('role','row');
      const weekday=doc.createElement('span');
      weekday.setAttribute('role','rowheader');weekday.setAttribute('aria-label',WEEKDAYS[r]);
      weekday.textContent=SHORT_DAYS[r];row.append(weekday);
      for(const [c,value] of days.entries()){
        const cell=doc.createElement('div');
        if(!value){cell.setAttribute('aria-hidden','true');row.append(cell);continue}
        cell.setAttribute('role','gridcell');cell.setAttribute('aria-selected','false');
        const button=doc.createElement('button');button.type='button';button.tabIndex=-1;
        const formatted=dateFormat.format(localDate(value.day));
        const label=formatted[0].toLocaleUpperCase('ru')+formatted.slice(1);
        const duration=readingDuration(value.ms);
        button.dataset.day=value.day;button.dataset.row=r;button.dataset.col=c;button.dataset.level=value.level;
        button.setAttribute('aria-label',label+': '+duration);
        if(value.day===model.day)button.setAttribute('aria-current','date');
        if(value.ms)button.title=label+': '+duration;
        cell.append(button);row.append(cell);
        nodes.set(value.day,{button,cell,label,duration});
      }
      fragment.append(row);
    }
    grid.replaceChildren(fragment);
    select(nodes.has(prior)?prior:model.day,focusWasInside);
  }
  function updateVisible(){
    if(!doc.hidden&&!root.closest('[hidden]'))render();
  }
  grid.addEventListener('click',event=>{
    const button=event.target.closest('button[data-day]');
    if(button)select(button.dataset.day);
  });
  grid.addEventListener('keydown',event=>{
    const button=event.target.closest('button[data-day]');
    if(!button||event.altKey||event.metaKey||event.shiftKey)return;
    const target=calendarDestination(rows,+button.dataset.row,+button.dataset.col,event.key,event.ctrlKey);
    if(!target)return;
    event.preventDefault();select(rows[target[0]][target[1]].day,true);
  });
  win.addEventListener('storage',event=>{if(event.key===READING_TIME_KEY||event.key===null)updateVisible()});
  doc.addEventListener('visibilitychange',updateVisible);
  win.addEventListener('focus',updateVisible);
  win.setInterval(updateVisible,15000);
  return {render};
}
