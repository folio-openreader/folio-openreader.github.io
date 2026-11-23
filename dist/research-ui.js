import {editorialCoverInfo,makeEditorialCover,makeEditorialCredit} from './editorial-cover.js';
export function installResearchCatalog(root,{loadCatalog,openBook,progress,makeIcon}){
  const cards=root.querySelector('.research-cards'),status=root.querySelector('[role=status]'),retry=root.querySelector('[data-research-retry]');
  let pending=null,entries=null,request=0;
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};
  const buttons=new Map();
  function makeCard(entry){
    const card=node('article',null,'research-card');
    const open=node('button',null,'research-open');open.type='button';
    const info=editorialCoverInfo(entry),cover=makeEditorialCover(entry);
    if(cover)open.append(cover);
    const content=node('span',null,'research-copy');
    const topic=entry.topic?[entry.topic,entry.year].filter(Boolean).join(' · '):info?.detail;
    if(topic)content.append(node('span',topic,'research-topic'));
    content.append(node('strong',entry.title),node('span',entry.journal||entry.source,'research-journal'));
    const action=node('span',null,'research-action');action.setAttribute('aria-hidden','true');action.append(makeIcon('openBook'));content.append(action);
    open.setAttribute('aria-label','Читать: '+entry.title);
    if(topic){const id='catalog-topic-'+entry.id;content.firstElementChild.id=id;open.setAttribute('aria-describedby',id)}
    const meter=node('span',null,'research-progress');content.append(meter);open.append(content);
    open.onclick=async e=>{
      const current=++request,previous=open.getAttribute('aria-label');
      open.disabled=true;open.setAttribute('aria-busy','true');open.setAttribute('aria-label','Открывается: '+entry.title);
      status.textContent='';
      try{await openBook(entry,e)}catch{if(current===request)status.textContent='Не удалось открыть текст. Попробуйте ещё раз.'}
      finally{open.disabled=false;open.removeAttribute('aria-busy');open.setAttribute('aria-label',previous)}
    };
    card.append(open);const credit=makeEditorialCredit(entry,cover);if(credit)card.append(credit);buttons.set(entry.id,{open,meter});return card;
  }
  function update(){for(const [id,{meter}] of buttons){const value=progress(id);meter.textContent=Number.isFinite(value)&&value>0?value+'%':'';meter.hidden=!meter.textContent}}
  async function refresh({force=false,live=false}={}){
    if(entries&&!force&&!live){update();return}
    if(pending)return pending;
    if(!entries)status.textContent='Загружаем…'; retry.hidden=true;
    pending=(async()=>{
      try{
        const next=await loadCatalog({force});
        if(!entries||JSON.stringify(entries)!==JSON.stringify(next)){entries=next;buttons.clear();cards.replaceChildren(...entries.map(makeCard));}
        update();status.textContent=entries.length?'':'Пока нет материалов.';
      }catch{entries=null;status.textContent='Каталог недоступен.';retry.hidden=false}
      finally{pending=null}
    })();
    return pending;
  }
  retry.onclick=()=>void refresh({force:true})
  return {refresh,focusArticle(id){const el=buttons.get(id)?.open;if(!el||el.disabled)return false;el.focus({preventScroll:true});return true}};
}
