import {embeddedNewsPhotos,commonsNewsPhotoURL,selectNewsPhoto,sanitizeNewsPhoto} from './news-photo.js';
// Direct read-only public feed. No Folio book, account or translation data leaves the device.
// Text: Wikipedia contributors, CC BY-SA 4.0. No third-party article is fetched or mirrored.
const WIKI='https://en.wikipedia.org', API=WIKI+'/w/api.php', DAY=86400000, TTL=30*60*1000, MAX=400000;
const KEY='folio.news.days.v1', AUTHOR='Wikipedia contributors', SOURCE='Wikipedia · Current events';
const LICENSE='CC BY-SA 4.0', LICENSE_URL='https://creativecommons.org/licenses/by-sa/4.0/';
const changes='Краткая сводка: текст разбит по темам, ссылки вынесены отдельно. Перевод, если включён, машинный; та же лицензия.';
const ISO=d=>new Date(d).toISOString().slice(0,10);
const months='January February March April May June July August September October November December'.split(' ');
const asDate=s=>typeof s==='string'&&/^20\d\d-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&ISO(s)===s;
export const isNewsId=s=>typeof s==='string'&&s.startsWith('news-')&&asDate(s.slice(5));
const pageName=d=>{const [y,m,n]=d.split('-');return 'Portal:Current events/'+y+' '+months[+m-1]+' '+(+n)};
const clean=s=>typeof s==='string'?s.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim():'';
const textOk=(s,n)=>typeof s==='string'&&s.length>0&&s.length<=n&&!/[<>]/.test(s);
const bad=()=>{throw new Error('Не удалось получить сводку Wikipedia.')};
function safeLink(value){
 if(typeof value!=='string'||value.length>2000||/[\s<>]/.test(value))return '';
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname.includes('.')?u.href:''}catch{return ''}
}
function valid(row){
 if(!asDate(row?.date)||!Number.isSafeInteger(row.rev)||row.rev<1||!Array.isArray(row.groups)||!row.groups.length||row.groups.length>20)return false;
 return row.groups.every(g=>textOk(g?.name,120)&&Array.isArray(g.events)&&g.events.length&&g.events.length<=80&&g.events.every(e=>textOk(e?.text,2500)&&Array.isArray(e.links)&&e.links.length&&e.links.length<=8&&e.links.every(l=>textOk(l?.label,150)&&!!safeLink(l.url))));
}
// This literal is an explicitly dated, abridged offline edition, not a fresh network result.
const seed={date:'2026-11-21',rev:1387114257,groups:[
 {name:'Business and economy',events:[{text:'Japan’s trade ministry said Saudi Arabia had agreed to expand its oil reserves in Japan to 24 million barrels, three times the previous volume.',links:[{label:'Japan Today',url:'https://japantoday.com/category/business/saudi-arabia-agrees-to-triple-crude-stored-in-japan-amid-mideast-tensions'}]}]},
 {name:'International relations',events:[{text:'Indonesia and the European Union signed agreements on trade and investment. The agreements would remove nearly all tariffs on goods from the EU.',links:[{label:'Euronews',url:'https://www.euronews.com/2026/11/21/european-union-and-indonesia-sign-free-trade-deal-after-decade-of-talks'}]}]}
]};
export function parseNewsDay(raw,date,doc=globalThis.document,{includePhotoCandidates=false}={}){
 const p=raw?.parse;
 if(!asDate(date)||p?.title!==pageName(date)||!Number.isSafeInteger(p.revid)||p.revid<1||typeof p.text!=='string'||p.text.length>MAX)bad();
 // Inert template, NEVER inserted. Unlike a live DOM it won't load images, frame URLs or stylesheets.
 const template=doc.createElement('template');template.innerHTML=p.text;
 const region=template.content.querySelector('.current-events-main');
 if(!region||region.querySelector('.dtstart')?.textContent.trim()!==date)bad();
 const area=region.querySelector('.current-events-content');if(!area)bad();
 const photoCandidates=includePhotoCandidates?embeddedNewsPhotos(area):[];
 area.querySelectorAll('style,script,link,img,iframe,frame,object,embed,audio,video,source,svg,math,form,template,nav,table,sup,figure,blockquote,.current-events-nav,.noprint,[hidden],[aria-hidden="true"]').forEach(e=>e.remove());
 const groups=[];let g=null;
 for(const child of area.children){
  if((child.tagName==='P'&&child.querySelector('b,strong'))||child.classList.contains('current-events-content-heading')||/^H[2-6]$/.test(child.tagName)){
   const name=clean(child.textContent);g=textOk(name,120)?{name,events:[]}:null;
   if(g){if(groups.length>=20)break;groups.push(g)}
  }else if(g&&child.tagName==='UL'){
   for(const li of child.querySelectorAll('li')){
    if(li.querySelector('ul,ol')||g.events.length>=80)continue; // Parent bullets are topic labels, not reports.
    const links=[];for(const a of li.querySelectorAll('a.external')){
     const url=safeLink(a.getAttribute('href')),label=clean(a.textContent).replace(/^\((.*)\)$/,'$1')||'Источник';
     if(url&&textOk(label,150)&&links.length<8&&!links.some(l=>l.url===url))links.push({label,url});
     a.remove();
    }
    const text=clean(li.textContent);if(links.length&&textOk(text,2500)&&text.length>=22)g.events.push({text,links});
   }
  }
 }
 // An empty day early in UTC is expected; don't duplicate yesterday under today's date.
 const row={date,rev:p.revid,groups:groups.filter(g=>g.events.length),...(photoCandidates.length?{photoCandidates}:{})};
 return row.groups.length&&valid(row)?row:null;
}
function makeBook(row){
 const date=row.date,sourceUrl=WIKI+'/w/index.php?oldid='+row.rev;
 const sources=Array.from(new Map(row.groups.flatMap(g=>g.events.flatMap(e=>e.links)).map(l=>[l.url,{...l}])).values());
 const photo=sanitizeNewsPhoto(row.photo);
 const edition={source:SOURCE,sourceUrl,license:LICENSE,licenseUrl:LICENSE_URL,attribution:AUTHOR,changes,sources,date,revision:row.rev,...(photo?{photo}:{})};
 const title='Мир за '+new Intl.DateTimeFormat('ru',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date));
 return {id:'news-'+date,kind:'news',title,author:AUTHOR,language:'en',format:'TXT',alignment:'none',date,source:SOURCE,sourceUrl,edition,createdAt:Date.parse(date),
  chapters:row.groups.map(g=>({title:g.name,paragraphs:g.events.map(e=>({text:e.text,translation:null}))}))};
}
function summary(row){
 const {chapters,...rest}=makeBook(row);
 const count=chapters.reduce((a,x)=>a+x.paragraphs.length,0);
 return {...rest,topics:chapters.map(c=>c.title),description:chapters.map(c=>c.title).join(' · '),paragraphCount:count,words:chapters.flatMap(c=>c.paragraphs).reduce((a,p)=>a+p.text.split(/\s+/).length,0)};
}
async function limitedJSON(response){
 if(!response.ok||!response.body?.getReader||Number(response.headers.get('content-length'))>MAX)bad();
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if((size+=value.byteLength)>MAX){void reader.cancel();bad()}chunks.push(value)}}
 finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let pos=0;for(const c of chunks){bytes.set(c,pos);pos+=c.length}
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
function cancelled(signal){if(signal?.aborted)throw signal.reason||new DOMException('Aborted','AbortError')}
export function createNewsSource({fetcher=(...a)=>globalThis.fetch(...a),now=()=>Date.now(),storage,timeout=6500}={}){
 if(storage===undefined){try{storage=globalThis.localStorage}catch{}}
 let rows=new Map(),checked=0,partial=false,loaded=false;
 function restore(){
  if(loaded)return;loaded=true;
  try{const raw=storage?.getItem(KEY);if(!raw||raw.length>500000)return;
   const j=JSON.parse(raw);if(!Array.isArray(j.rows)||j.rows.length>7)return;
   for(const r of j.rows)if(valid(r))rows.set(r.date,r);
   partial=j.partial===true;
   if(rows.size&&Number.isFinite(j.checked)&&j.checked<=now()&&j.checked>0)checked=j.checked;
  }catch{}
 }
 function save(){try{const raw=JSON.stringify({rows:[...rows.values()],checked,partial});if(raw.length<=500000)storage?.setItem(KEY,raw)}catch{}}
 async function fetchDay(date,signal){
  cancelled(signal);
  const ctl=new AbortController(),stop=()=>ctl.abort(),timer=setTimeout(stop,timeout);
  signal?.addEventListener('abort',stop,{once:true});
  try{
   const u=new URL(API);u.search=new URLSearchParams({action:'parse',format:'json',formatversion:'2',origin:'*',page:pageName(date),prop:'text|revid'}).toString();
   const res=await fetcher(u.href,{method:'GET',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:ctl.signal});
   const raw=await limitedJSON(res);if(raw?.error?.code==='missingtitle')return null;
   return parseNewsDay(raw,date,globalThis.document,{includePhotoCandidates:true});
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop)}
 }
 async function enrichPhotos(incoming,signal){
  const pending=incoming.flatMap(row=>{
   const candidates=row.photoCandidates;delete row.photoCandidates;
   const cached=rows.get(row.date);
   if(cached?.rev===row.rev&&cached.photo!==undefined){
    row.photo=sanitizeNewsPhoto(cached.photo);return [];
   }
   return candidates?.length?[{row,candidates}]:[];
  });
  const url=commonsNewsPhotoURL(pending.flatMap(p=>p.candidates));if(!url)return;
  const ctl=new AbortController(),stop=()=>ctl.abort(),timer=setTimeout(stop,Math.min(timeout,1800));
  signal?.addEventListener('abort',stop,{once:true});
  try{
   const res=await fetcher(url,{method:'GET',mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',signal:ctl.signal});
   const raw=await limitedJSON(res);
   if(Array.isArray(raw?.query?.pages))for(const {row,candidates} of pending)row.photo=selectNewsPhoto(candidates,raw);
  }catch{}finally{clearTimeout(timer);signal?.removeEventListener('abort',stop)}
 }
 function feed(stale,offline){
  const today=ISO(now()),cut=ISO(now()-6*DAY),current=[...rows.values()].filter(r=>r.date>=cut&&r.date<=today).sort((a,b)=>b.date.localeCompare(a.date));
  // Never present the fixture more than a week later as today's news.
  if(!current.length&&seed.date>=cut&&seed.date<=today)current.push(seed);
  return {items:current.map(summary),checkedAt:checked?new Date(checked).toISOString():null,stale,offline};
 }
 async function loadNewsFeed({force=false,signal}={}){
  cancelled(signal);restore();
  if(!force&&checked&&ISO(checked)===ISO(now())&&now()-checked<TTL)return feed(partial,false);
  const dates=[0,1,2].map(i=>ISO(now()-i*DAY));
  const results=await Promise.allSettled(dates.map(d=>fetchDay(d,signal)));cancelled(signal);
  await enrichPhotos(results.flatMap(r=>r.status==='fulfilled'&&r.value?[r.value]:[]),signal);cancelled(signal);
  let ok=0,got=0;
  for(let i=0;i<results.length;i++){const r=results[i];if(r.status==='fulfilled'){ok++;if(r.value){got++;rows.set(dates[i],r.value)}else rows.delete(dates[i])}}
  rows=new Map([...rows].filter(([d])=>d>=ISO(now()-6*DAY)&&d<=dates[0]));
  if(got){checked=now();partial=ok!==dates.length}save();
  return feed(!got||ok!==dates.length,!ok);
 }
 async function loadNewsBook(id,{signal}={}){
  if(!isNewsId(id))bad();cancelled(signal);restore();const d=id.slice(5);
  if(rows.has(d))return makeBook(rows.get(d));if(d===seed.date)return makeBook(seed);
  if(d>ISO(now())||d<ISO(now()-6*DAY))bad();
  const row=await fetchDay(d,signal);cancelled(signal);if(!row)bad();await enrichPhotos([row],signal);cancelled(signal);rows.set(d,row);save();return makeBook(row);
 }
 return {loadNewsFeed,loadNewsBook};
}
const news=createNewsSource();
export const loadNewsFeed=news.loadNewsFeed,loadNewsBook=news.loadNewsBook;
