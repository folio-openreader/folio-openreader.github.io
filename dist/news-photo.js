// A daily digest may have an editorial image. Only use the exact Commons file
// embedded by Wikipedia's editors, never a thumbnail from a story citation.
const WIKI='https://en.wikipedia.org', COMMONS='https://commons.wikimedia.org';
const FILE=/^File:[^<>|#?\u0000-\u001f\u007f/\\]{1,245}\.(?:jpg|jpeg|png|webp)$/iu;
const MIN_WIDTH=420,MIN_HEIGHT=230;
const CC=/^https:\/\/creativecommons\.org\/(licenses\/(?:by|by-sa)\/(?:2\.0|2\.5|3\.0|4\.0)|publicdomain\/zero\/1\.0)\/?$/;
const count=6;
const normalizeFile=s=>typeof s==='string'?s.replaceAll('_',' ').trim():'';
function https(value,host){
 if(typeof value!=='string'||value.length>1600||/[\s\\<>]/u.test(value))return null;
 try{const u=new URL(value);return u.origin==='https://'+host&&!u.username&&!u.password&&!u.hash&&!u.search?u:null}catch{return null}
}
function mediaURL(value){
 const u=https(value,'upload.wikimedia.org');
 return u&&/^\/wikipedia\/commons\/(?:thumb\/)?[a-f0-9]\/[a-f0-9]{2}\/.+/i.test(u.pathname)&&/\.(?:jpe?g|png|webp)$/i.test(u.pathname)?u.href:'';
}
function pageTitle(value){
 const u=https(value,'commons.wikimedia.org');
 try{const s=normalizeFile(decodeURIComponent(u?.pathname.slice(6)||''));return u?.pathname.startsWith('/wiki/')&&FILE.test(s)?s:''}catch{return ''}
}
function plain(value,limit){
 if(typeof value!=='string')return '';
 const s=value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
 return s.length<=limit&&!/[<>]/.test(s)?s:'';
}
function licenseOf(value){
 const m=typeof value==='string'&&CC.exec(value);if(!m)return null;
 const code=m[1].split('/');
 return {licenseUrl:'https://creativecommons.org/'+m[1]+'/',license:code[0]==='publicdomain'?'CC0 1.0':'CC '+code[1].toUpperCase()+' '+code[2]};
}
function matchingMedia(src,file){
 try{return !!src&&decodeURIComponent(new URL(src).pathname).split('/').map(normalizeFile).includes(file.slice(5))}
 catch{return false}
}
export function sanitizeNewsPhoto(raw){
 const file=pageTitle(raw?.sourceUrl);if(!file)return null;
 const src=mediaURL(raw.src),lic=licenseOf(raw.licenseUrl),credit=plain(raw.credit,300),caption=plain(raw.caption,300);
 if(!matchingMedia(src,file)||!lic||(!credit&&lic.license.startsWith('CC BY')))return null;
 return {src,sourceUrl:raw.sourceUrl,...lic,credit,caption};
}
export function embeddedNewsPhotos(area){
 const result=[];
 for(const figure of area.querySelectorAll('figure,.thumb')){
  if(figure.closest('li,table,blockquote,nav,.noprint,[hidden],[aria-hidden="true"]'))continue;
  const a=figure.querySelector('a.mw-file-description'),img=a?.querySelector('img');
  if(!img||Number(img.getAttribute('width'))<120||Number(img.getAttribute('height'))<75)continue;
  if(!Number.isFinite(Number(img.getAttribute('width')))||!Number.isFinite(Number(img.getAttribute('height'))))continue;
  const raw=a.getAttribute('href');if(!raw)continue;
  try{
   const u=new URL(raw,WIKI);
   const file=u.origin===COMMONS?pageTitle(u.href):u.origin===WIKI&&!u.search&&!u.hash&&u.pathname.startsWith('/wiki/File:')?normalizeFile(decodeURIComponent(u.pathname.slice(6))):'';
   const src=img.getAttribute('src'),media=src&&mediaURL(new URL(src,WIKI).href);
   if(!FILE.test(file)||!matchingMedia(media,file)||result.some(p=>p.file===file))continue;
   const caption=plain(figure.querySelector('figcaption,.thumbcaption')?.textContent,300);
   if(!caption)continue;
   result.push({file,caption});if(result.length===2)break;
  }catch{}
 }
 return result;
}
export function selectNewsPhoto(candidates,raw,doc=globalThis.document){
 const pages=raw?.query?.pages;
 if(!Array.isArray(pages)||pages.length>count)return null;
 for(const {file,caption} of candidates){
  const p=pages.find(row=>normalizeFile(row?.title)===file),im=p?.imageinfo?.[0],m=im?.extmetadata;
  if(!m||pageTitle(im.descriptionurl)!==file||!['image/jpeg','image/png','image/webp'].includes(im.mime)||
     !Number.isFinite(im.thumbwidth)||im.thumbwidth<MIN_WIDTH||im.thumbwidth>800||
     !Number.isFinite(im.thumbheight)||im.thumbheight<MIN_HEIGHT||im.thumbheight>1000||
     m.Restrictions?.value||m.NonFree?.value&&m.NonFree.value!=='false')continue;
  const plainMarkup=html=>{
   if(typeof html!=='string'||html.length>6000)return '';
   const t=doc.createElement('template');t.innerHTML=html;t.content.querySelectorAll('style,script').forEach(n=>n.remove());
   return plain(t.content.textContent,300);
  };
  const artist=plainMarkup(m.Artist?.value),attribution=plainMarkup(m.Attribution?.value);
  const credit=attribution||artist;
  if(m.AttributionRequired?.value==='true'&&!credit)continue;
  const result=sanitizeNewsPhoto({src:im.thumburl,sourceUrl:im.descriptionurl,licenseUrl:m.LicenseUrl?.value,credit,caption});
  if(result)return result;
 }
 return null;
}
export function commonsNewsPhotoURL(candidates){
 const u=new URL('/w/api.php',COMMONS);
 const titles=[...new Set(candidates.map(x=>x.file).filter(f=>FILE.test(f)))].slice(0,count);
 if(!titles.length)return null;
 u.search=new URLSearchParams({action:'query',prop:'imageinfo',titles:titles.join('|'),format:'json',formatversion:'2',origin:'*',iiprop:'url|mime|extmetadata',iiurlwidth:'720',iiextmetadatafilter:'Artist|Attribution|AttributionRequired|LicenseUrl|Restrictions|NonFree'});
 return u.href;
}
