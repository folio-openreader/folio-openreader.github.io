// Local activity selection only. Nothing here changes schedules or word stages.
import {due,stage} from './learning-core.js';
const DAY=86400000, HISTORY=32;
const byKey=(a,b)=>a.key<b.key?-1:a.key>b.key?1:0;

// Keep a small, session-only recency ranking. Repeated rounds move their words
// to the back, rather than growing a permanent practice history.
export function rememberStudyWords(previous,keys){
  const next=new Set(previous);
  for(const key of keys){next.delete(key);next.add(key)}
  return [...next].slice(-HISTORY);
}

export function rankPracticeWords(records,{now=Date.now(),recent=[],limit=240}={}){
  const last=new Map([...recent].map((key,i)=>[key,i+1]));
  function info(r){
    const isDue=due(r,now),priority=isDue?(r.lapsed?0:1):r.lapsed?2:stage(r)==='known'?4:3;
    return {r,priority,recent:last.get(r.key)||0,late:isDue?Math.floor((now-r.nextReviewAt)/DAY):0};
  }
  const rows=records.filter(Boolean).map(info).sort((a,b)=>
    a.priority-b.priority||a.recent-b.recent||b.late-a.late||
    a.r.createdAt-b.r.createdAt||byKey(a.r,b.r));
  // Lead with the strongest learning signal. Then reserve one of the first
  // eight slots for a different non-mastered word if the whole lead set was
  // just practised. This doesn't move that word ahead of the most urgent card.
  const tail=rows.slice(7),fresh=tail.find(r=>!r.recent&&r.priority<4);
  if(rows.length>=8&&rows.slice(0,7).every(r=>r.recent)&&fresh){
    rows.splice(rows.indexOf(fresh),1);rows.splice(7,0,fresh);
  }
  return rows.slice(0,limit).map(x=>x.r);
}

export function recallQueue(records,{now=Date.now(),limit=24}={}){
  return records.filter(r=>due(r,now)).sort((a,b)=>
    Number(b.lapsed)-Number(a.lapsed)||a.nextReviewAt-b.nextReviewAt||a.createdAt-b.createdAt||byKey(a,b)).slice(0,limit);
}
