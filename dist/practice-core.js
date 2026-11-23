// A match is a comparison against the selected local dictionary, not a review grade.
export const MIN_PAIRS=3,MAX_PAIRS=4,MAX_CANDIDATES=240;
export function shuffle(items,random=Math.random){
  const a=[...items];
  for(let i=a.length-1;i>0;i--){const j=Math.min(i,Math.max(0,Math.floor(random()*(i+1))));[a[i],a[j]]=[a[j],a[i]]}
  return a;
}
const canonical=s=>String(s||'').normalize('NFKC').toLocaleLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const compact=s=>typeof s==='string'?s.replace(/\s+/g,' ').trim():'';
export function makePracticeCard(record,result){
  if(!record?.key||!result?.entries?.length)return null;
  const entries=result.entries;
  const main=entries.find(e=>compact(e.translation)||compact(e.definition));
  if(!main)return null;
  const meaning=compact(main.translation)||compact(main.definition);
  if(!meaning||Array.from(meaning).length>110)return null;
  const meaningKeys=new Set();
  for(const e of entries)for(const raw of [e.translation,e.definition]){
    const text=compact(raw);
    for(const s of [text,...text.split(/;|,|\s+\/\s+|\s+(?:or|или)\s+/u)]){
      const key=canonical(s);
      if(key)meaningKeys.add(key);
    }
  }
  const termKey=canonical(record.word),head=canonical(result.headword||record.word),shown=canonical(meaning);
  if(!termKey||!shown||termKey===shown||head===shown)return null;
  return {id:record.key,word:record.word,language:record.language,meaning,termKey,head,meaningKeys};
}
export function distinctCards(cards,take=MAX_PAIRS){
  const picks=[],words=new Set(),meanings=new Set();
  for(const card of cards){
    if(!card||words.has(card.termKey)||words.has(card.head)||[...card.meaningKeys].some(k=>meanings.has(k)))continue;
    picks.push(card);words.add(card.termKey);words.add(card.head);
    for(const k of card.meaningKeys)meanings.add(k);
    if(picks.length>=take)break;
  }
  return picks;
}
export function createMatchRound(cards,random=Math.random){
  const first=shuffle(cards,random),second=shuffle(cards,random);
  // Avoid a board that shows every answer directly opposite its word.
  if(second.length>1&&first.every((c,i)=>c.id===second[i].id))second.push(second.shift());
  return {words:first,meanings:second,matched:new Set(),selected:null,attempts:0};
}
export function matchChoice(round,side,id){
  if(!round||!['words','meanings'].includes(side)||!round[side].some(card=>card.id===id)||round.matched.has(id))return {kind:'ignored'};
  const previous=round.selected;
  if(!previous||previous.side===side){
    const same=previous?.id===id;
    round.selected=same?null:{side,id};
    return {kind:same?'cleared':'selected'};
  }
  round.attempts++;
  round.selected=null;
  if(previous.id!==id)return {kind:'miss',first:previous,second:{side,id}};
  round.matched.add(id);
  return {kind:round.matched.size===round.words.length?'complete':'hit',id};
}
