// Motion based on DesignBookmark's Storage Meter; original, dependency-free adaptation.
const soft=[260,24],pop=[520,16],fade=[420,32],highlight=[300,26],roll=[260,22];
const reduce=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const format=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1});
const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));

export function readStorageEstimate(data){
  const bytes=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
  const usage=bytes(data?.usage),rawQuota=bytes(data?.quota);
  const quota=rawQuota>0?rawQuota:null;
  return {usage,quota,available:usage!==null&&quota!==null?Math.max(0,quota-usage):null,
    share:usage!==null&&quota!==null?clamp(usage/quota,0,1):null};
}
export function storageBytes(n){
  if(n===null)return '—';
  const units=['Б','КБ','МБ','ГБ','ТБ','ПБ'];
  const order=n<1024?0:Math.min(units.length-1,Math.floor(Math.log(n)/Math.log(1024)));
  return format.format(n/1024**order)+' '+units[order];
}
// Unit spring, integrated at 120 Hz and sampled at 60 Hz. Runs only on a change.
function move(el,{spring:[k,d],property,from,to,make,limit=false}){
  if(reduce()||!el.animate||from===to)return;
  let x=0,v=0;
  const frames=[{[property]:make(from)}];
  for(let t=0;t<84;t++){
    for(let step=0;step<2;step++){v+=((1-x)*k-v*d)/120;x+=v/120}
    frames.push({[property]:make(from+(to-from)*(limit?clamp(x,0,1):x))});
    if(Math.abs(1-x)<.001&&Math.abs(v)<.008)break;
  }
  frames.push({[property]:make(to)});
  return el.animate(frames,{duration:(frames.length-1)*1000/60});
}
export function installStorageMeter(mount,{storage=globalThis.navigator?.storage}={}){
  if(!mount)return;
  mount.classList.add('storage-meter');
  mount.innerHTML=`<p class="storage-meter-kicker">Данные Folio в браузере</p>
    <p class="storage-meter-total"><strong data-storage-usage>—</strong><span data-storage-quota></span></p>
    <div class="storage-meter-track" aria-hidden="true" hidden><span class="storage-meter-fill"></span></div>
    <div class="storage-meter-details" hidden>
      <details class="storage-meter-row"><summary><span>Занято</span><strong data-storage-used>—</strong></summary><p>Оценка браузера: книги, словари и другие данные Folio.</p></details>
      <details class="storage-meter-row storage-meter-available"><summary><span>Доступно Folio</span><strong data-storage-available>—</strong></summary><p>Лимит для сайта, а не свободное место на всём устройстве.</p></details>
    </div><p class="storage-meter-note" role="status">Проверяем…</p>`;
  const el=s=>mount.querySelector(s);
  const track=el('.storage-meter-track'),fill=el('.storage-meter-fill'),usageNode=el('[data-storage-usage]');
  const details=el('.storage-meter-details'),rows=[...details.querySelectorAll('details')];
  const profile=mount.closest('#profile-view');
  let previousShare=null,currentAnimation=null,request=0,visible=false;
  rows.forEach(row=>row.addEventListener('toggle',()=>{
    if(!row.open)return;
    rows.forEach(other=>{if(other!==row)other.open=false});
    move(row,{spring:highlight,property:'backgroundColor',from:0,to:1,make:x=>`color-mix(in srgb,var(--accent) ${clamp(x,0,1)*7}%,transparent)`});
    move(row.querySelector('p'),{spring:fade,property:'opacity',from:0,to:1,make:x=>clamp(x,0,1)});
    move(fill,{spring:pop,property:'scale',from:0.8,to:1,make:x=>`1 ${x}`});
  }));
  async function refresh(){
    const token=++request;let raw;
    try{raw=await storage?.estimate?.()}catch{}
    if(token!==request||!visible)return;
    const result=readStorageEstimate(raw);
    const formatted=storageBytes(result.usage);
    if(usageNode.textContent!==formatted){
      usageNode.textContent=formatted;
      if(result.usage!==null){
        move(usageNode,{spring:roll,property:'transform',from:.48,to:0,make:x=>`translateY(${x}em)`});
        move(usageNode,{spring:fade,property:'opacity',from:0,to:1,make:x=>clamp(x,0,1)});
      }
    }
    el('[data-storage-quota]').textContent=result.quota===null||result.usage===null?'':'из '+storageBytes(result.quota);
    el('[data-storage-used]').textContent=storageBytes(result.usage);
    el('[data-storage-available]').textContent=storageBytes(result.available);
    details.hidden=result.usage===null;
    rows[1].hidden=result.available===null;
    track.hidden=result.share===null;
    el('.storage-meter-note').textContent=result.usage===null?'Браузер не сообщает объём.':result.quota===null?'Лимит браузера неизвестен.':'Приблизительная оценка браузера.';
    currentAnimation?.cancel();
    if(result.share!==null){
      fill.style.transform=`scaleX(${result.share})`;
      currentAnimation=move(fill,{spring:soft,property:'transform',from:previousShare??0,to:result.share,make:x=>`scaleX(${x})`,limit:true});
    }
    previousShare=result.share;
  }
  function sync(){
    const next=!mount.closest('[hidden]')&&(!profile||!profile.hidden);
    if(next===visible)return;
    visible=next;
    if(next){previousShare=null;void refresh()}
    else{request++;currentAnimation?.cancel();rows.forEach(row=>{row.open=false})}
  }
  const observer=new MutationObserver(sync);
  // Only visibility attributes along this component's ancestor path, never descendant mutations.
  for(let cursor=mount;cursor;cursor=cursor.parentElement)observer.observe(cursor,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',()=>{if(visible&&!document.hidden)void refresh()});
  sync();
}
