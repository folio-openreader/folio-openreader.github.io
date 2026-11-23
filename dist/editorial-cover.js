import {sanitizeNewsPhoto} from './news-photo.js';
// Local editorial illustrations, not publisher photos or figures.
const researchArt=Object.freeze({
  'research-blackbird-migration':'blackbird',
  'research-umap':'umap',
  'research-group-drumming':'drumming',
  'research-visual-navigation':'navigation',
  'research-music-and-the-brain':'neuroscience',
});
const newsTopics=[
  [/armed conflicts|attacks|disasters|accidents|international relations|politics|law and crime/i,'Мир','news-world'],
  [/business|economy|finance/i,'Экономика','news-economy'],
  [/science|technology|health|environment/i,'Наука и технологии','news-science'],
  [/arts|culture|sports/i,'Культура и спорт','news-culture'],
];
export function editorialCoverInfo(entry){
  if(typeof entry?.id!=='string')return null;
  if(Object.hasOwn(researchArt,entry.id))return {art:researchArt[entry.id],detail:''};
  if(entry.id.startsWith('research-'))return {art:'news-science',detail:''};
  if(!/^news-20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(entry.id))return null;
  const labels=Array.isArray(entry.topics)?entry.topics:Array.isArray(entry.chapters)?entry.chapters.map(c=>c?.title):[];
  const topics=[];
  for(const title of labels){
    if(typeof title!=='string')continue;
    const row=newsTopics.find(([p])=>p.test(title));
    if(row&&!topics.includes(row))topics.push(row);
  }
  // Prefer a specific subject over the umbrella World label when the digest has both.
  const displayed=topics.slice(0,2);
  return {art:displayed.find(row=>row[2]!=='news-world')?.[2]||'news-world',detail:displayed.map(row=>row[1]).join(' · ')};
}
export function newsCoverPhoto(entry){
  return /^news-20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(entry?.id??'')?sanitizeNewsPhoto(entry.edition?.photo):null;
}
export function makeEditorialCredit(entry,cover,doc=globalThis.document){
  const photo=newsCoverPhoto(entry);if(!photo||!cover)return null;
  const credit=doc.createElement('small');credit.className='editorial-credit';
  const link=(url,label)=>{const a=doc.createElement('a');a.href=url;a.textContent=label;a.target='_blank';a.rel='noopener noreferrer';return a};
  const source=link(photo.sourceUrl,photo.credit?'Фото: '+photo.credit:'Фото: Wikimedia Commons');
  source.title=photo.caption;credit.append(source,doc.createTextNode(' · '),link(photo.licenseUrl,photo.license));
  credit.hidden=true;
  cover.addEventListener('editorial-photo-loaded',()=>{credit.hidden=false});
  if(cover.dataset.photo==='loaded')credit.hidden=false;
  return credit;
}
export function makeEditorialCover(entry,doc=globalThis.document){
  const info=editorialCoverInfo(entry); if(!info)return null;
  const cover=doc.createElement('span');cover.className='editorial-cover';cover.dataset.art=info.art;
  cover.setAttribute('aria-hidden','true');
  const img=doc.createElement('img');img.alt='';img.width=640;img.height=288;
  img.loading='lazy';img.decoding='async';
  const photo=newsCoverPhoto(entry),fallback=new URL('./editorial/covers/'+info.art+'.svg',import.meta.url).href;
  img.addEventListener('error',()=>{
    if(img.src===fallback)img.remove();
    else {delete cover.dataset.photo;img.src=fallback}
  });
  if(photo){
    img.referrerPolicy='no-referrer';
    img.addEventListener('load',()=>{
      if(img.src===photo.src){cover.dataset.photo='loaded';cover.dispatchEvent(new Event('editorial-photo-loaded'))}
    },{once:true});
  }
  img.src=photo?.src??fallback;
  cover.append(img);return cover;
}
