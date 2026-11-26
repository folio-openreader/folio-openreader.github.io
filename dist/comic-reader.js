// Page view only. Assets stay in the caller's local store; a single image is
// mounted at a time. No fetch, third-party image URLs or OCR on open.
const tokenPattern = /[\p{L}][\p{L}\p{M}]*(?:['‘’ʼ‐‑-][\p{L}][\p{L}\p{M}]*)*/gu;
const tokenList = text => Array.from(text.matchAll(tokenPattern));
const clamped = n => Math.max(0,Math.min(1,n));
const MAX_MARKS = 2500;
let japaneseWords;
function transcriptWords(text,language,marks,paragraphIndex){
  if (language==='ja') {
    if(typeof Intl.Segmenter==='function'){
      japaneseWords??=new Intl.Segmenter('ja',{granularity:'word'});
      return Array.from(japaneseWords.segment(text)).filter(s=>s.isWordLike).map(s=>({word:s.segment,offset:s.index}));
    }
    const exact=marks.filter(m=>m.paragraphIndex===paragraphIndex).sort((a,b)=>a.offset-b.offset);
    if(exact.length)return exact;
  }
  return tokenList(text).map(token=>({word:token[0],offset:token.index}));
}

export function comicRect(word, width, height) {
  if (!word) return null;
  let {x,y,w,h} = word;
  if (word.bbox) {
    if (!(width>0 && height>0)) return null;
    const {x0,y0,x1,y1} = word.bbox;
    if (![x0,y0,x1,y1].every(Number.isFinite)) return null;
    x=x0/width; y=y0/height; w=(x1-x0)/width; h=(y1-y0)/height;
  }
  if (![x,y,w,h].every(Number.isFinite) || w<=0 || h<=0) return null;
  const right=clamped(x+w), bottom=clamped(y+h);
  x=clamped(x);y=clamped(y);
  return right>x && bottom>y ? {x,y,w:right-x,h:bottom-y} : null;
}

export function comicPageText(data) {
  const paragraphs = Array.isArray(data.paragraphs)
    ? data.paragraphs.map(p => typeof p==='string' ? p : typeof p?.text==='string' ? p.text : '') : [];
  const words = Array.isArray(data.words) ? data.words : [];
  if (!paragraphs.length && typeof data.text==='string' && data.text.trim()) paragraphs.push(...data.text.split(/\r?\n+/));
  if (!paragraphs.length && words.length) paragraphs.push(words.map(w=>typeof w?.text==='string'?w.text:'').join(' '));
  const marks=[];
  let pi=0, cursor=0;
  for (const entry of words.slice(0,MAX_MARKS)) {
    if (typeof entry?.text!=='string' || !entry.text || entry.text.length>250) continue;
    const box=comicRect(entry,data.width,data.height);
    if (!box) continue;
    const tokens=tokenList(entry.text);
    // Never invent separate on-image positions for several words inside one
    // rectangle. They remain individually available in the full transcript.
    if (tokens.length!==1) continue;
    const word=tokens[0][0];
    const explicit=Number.isInteger(entry.paragraphIndex);
    let i=explicit ? entry.paragraphIndex : pi;
    if (i<0 || i>=paragraphs.length) continue;
    let offset=-1;
    if (Number.isInteger(entry.offset) && entry.offset>=0 && paragraphs[i].slice(entry.offset,entry.offset+entry.text.length)===entry.text) {
      offset=entry.offset+tokens[0].index;
    } else {
      for (;i<paragraphs.length;i++) {
        const start=i===pi ? cursor : 0;
        const hit=paragraphs[i].indexOf(entry.text,start);
        if (hit!==-1) {offset=hit+tokens[0].index;break;}
        if (explicit) break;
      }
    }
    if (offset<0) continue;
    marks.push({word,paragraphIndex:i,offset,box});pi=i;cursor=offset+word.length;
  }
  return {paragraphs,marks};
}

function element(doc,tag,cls,label) {
  const el=doc.createElement(tag);
  if (cls) el.className=cls;
  if (label!=null) el.textContent=label;
  return el;
}

const ink={
  prev:'m14 6-6 6 6 6', next:'m10 6 6 6-6 6',
  scan:'M8 4H5a1 1 0 0 0-1 1v3m12-4h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m12-4v3a1 1 0 0 1-1 1h-3M8 15l3-7h2l3 7m-6.7-2.5h5.4',
  language:'M3 5h12M9 3v2m3 0c-.5 4.5-3 7.2-7 9m1-7c.8 2.5 2.2 4.4 4.5 6m2 7 4.5-10 4.5 10m-7.7-3h6.4',
  transcript:'M5 6h14M5 10h10M5 14h14M5 18h9'
};
function icon(doc,id) {
  const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg'),p=doc.createElementNS(ns,'path');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
  p.setAttribute('d',ink[id]);svg.append(p);return svg;
}

let serial=0;
const instances=new WeakMap();
export function createComicReader(host,{onNavigate,onRecognize,onCorrection,onWord,decorateWord}={}) {
  instances.get(host)?.destroy();
  const doc=host.ownerDocument, stamp='folio-comic-'+(++serial);
  const el=(tag,cls,label)=>element(doc,tag,cls,label);
  const root=el('section','comic-reader');root.setAttribute('aria-label','Страница комикса');
  const bar=el('div','comic-bar');
  const b=(key,title,label) => {
    const button=el('button','comic-control comic-'+(key==='transcript'?'text-toggle':key));
    button.type='button';button.setAttribute('aria-label',title);button.title=title;
    button.append(icon(doc,key));if(label)button.append(el('span',null,label));
    return button;
  };
  const prev=b('prev','Предыдущая страница'),next=b('next','Следующая страница');
  const count=el('span','comic-count');count.tabIndex=-1;count.setAttribute('role','group');
  const nav=el('nav','comic-nav');nav.setAttribute('aria-label','Страницы комикса');nav.append(prev,count,next);
  const tools=el('div','comic-tools');
  const ocr=b('scan','Распознать слова на странице','Распознать');
  const transcript=b('transcript','Показать распознанный текст','Текст');transcript.setAttribute('aria-controls',stamp+'-text');
  const correction=b('language','Язык распознавания страницы');correction.setAttribute('aria-haspopup','dialog');
  tools.append(ocr,correction,transcript);bar.append(nav,tools);
  const stateNote=el('p','comic-note');stateNote.setAttribute('role','status');
  const panel=el('div','comic-transcript');panel.id=stamp+'-text';panel.setAttribute('role','region');panel.setAttribute('aria-label','Распознанный текст');
  const frame=el('div','comic-frame'),overlay=el('div','comic-overlay');
  overlay.setAttribute('role','group');overlay.setAttribute('aria-label','Слова на изображении. Для выбора используйте стрелки влево и вправо.');
  const fault=el('p','comic-image-error','Не удалось открыть изображение страницы.');fault.setAttribute('role','status');
  const status=el('span','comic-sr');status.setAttribute('role','status');
  root.append(bar,stateNote,panel,frame,status);host.replaceChildren(root);
  let img=null,url=null,page={},content={paragraphs:[],marks:[]},state='idle',dead=false,drawMarks=true,readText=false,panelBuilt=false;
  let waiting=false,notice='';
  function revoke(){
    if(img){img.onload=img.onerror=null;img.removeAttribute('src');img.remove();img=null;}
    if(url){URL.revokeObjectURL(url);url=null;}
  }
  function wordButton(word,index,offset,cls){
    const button=el('button','word '+cls,word);
    button.type='button';button.dataset.word=word.toLocaleLowerCase();button.dataset.offset=String(offset);button.dataset.paragraph=String(index);
    if(page.language) button.lang=page.language;
    decorateWord?.(button,word);
    return button;
  }
  function buildPanel(){
    if(panelBuilt)return;
    panelBuilt=true;
    const fragment=doc.createDocumentFragment();
    content.paragraphs.forEach((text,i)=>{
      if(!text.trim())return;
      const row=el('p');row.dataset.paragraph=String(i);
      if(page.language)row.lang=page.language;
      let offset=0;
      for(const token of transcriptWords(text,page.language,content.marks,i)){
        if(token.offset<offset)continue;
        if(token.offset>offset)row.append(doc.createTextNode(text.slice(offset,token.offset)));
        row.append(wordButton(token.word,i,token.offset,'comic-token'));
        offset=token.offset+token.word.length;
      }
      if(offset<text.length)row.append(doc.createTextNode(text.slice(offset)));
      fragment.append(row);
    });
    panel.replaceChildren(fragment);
  }
  function setOcrLabel(label,title){
    ocr.lastElementChild.textContent=label;ocr.title=title;ocr.setAttribute('aria-label',title);
  }
  function paintControls(){
    const hasMarks=content.marks.length>0, hasText=content.paragraphs.some(p=>p.trim());
    const ready=hasText, busy=state==='loading', empty=state==='empty';
    ocr.hidden=false;ocr.disabled=busy&&!ready;ocr.removeAttribute('aria-pressed');
    correction.hidden=!onCorrection||!page.blob;correction.disabled=busy;correction.dataset.busy=String(busy);
    ocr.dataset.busy=String(busy&&!ready);
    stateNote.hidden=true;
    if (ready && hasMarks){
      setOcrLabel('Слова','Слова на изображении');ocr.setAttribute('aria-pressed',String(drawMarks));
    } else if (ready && hasText){
      ocr.hidden=true;
    } else if (busy) {
      setOcrLabel('Распознаём…','Распознавание слов');
    } else if(state==='error') {
      setOcrLabel('Повторить','Повторить распознавание слов');
      stateNote.textContent='Не удалось распознать текст.';stateNote.hidden=false;
    } else if(empty){
      setOcrLabel('Повторить','Повторить распознавание слов');stateNote.textContent='На этой странице слова не распознаны.';stateNote.hidden=false;
    } else {
      setOcrLabel('Распознать','Распознать слова на странице');
    }
    if(!onRecognize && !(ready&&hasMarks)) ocr.hidden=true;
    transcript.hidden=!ready||!hasText;
    transcript.setAttribute('aria-expanded',String(!transcript.hidden&&readText));
    transcript.setAttribute('aria-label',readText?'Скрыть распознанный текст':'Показать распознанный текст');
    transcript.title=transcript.getAttribute('aria-label');
    overlay.hidden=!drawMarks||!ready||!hasMarks||!fault.hidden;
    panel.hidden=transcript.hidden||!readText;
    if(!panel.hidden) buildPanel();
    if (notice){stateNote.textContent=notice;stateNote.hidden=false;}
    bar.dataset.noTools=String(ocr.hidden&&correction.hidden&&transcript.hidden);
  }
  function paintMarks(){
    const fragment=doc.createDocumentFragment();let i=0;
    for(const {word,paragraphIndex,offset,box} of content.marks){
      const button=wordButton(word,paragraphIndex,offset,'comic-hotspot');
      button.tabIndex=i===0?0:-1;button.dataset.mark=String(i++);
      Object.assign(button.style,{left:box.x*100+'%',top:box.y*100+'%',width:box.w*100+'%',height:box.h*100+'%'});
      fragment.append(button);
    }
    overlay.replaceChildren(fragment);
  }
  function setOCR(data={}) {
    if(dead || (Number.isInteger(data.index)&&data.index!==page.index))return;
    state=data.status||'ready';
    waiting=state==='loading';notice='';
    const hadText=content.paragraphs.some(p=>p.trim());
    if(state==='ready'){
      const nextText=comicPageText({...data,width:page.width,height:page.height});
      if(nextText.paragraphs.some(p=>p.trim())){
        if(data.language)page.language=data.language;
        content=nextText;panelBuilt=false;panel.replaceChildren();paintMarks();
      }else state='empty';
    }
    if(hadText&&state==='empty')notice='Новый текст не распознан. Предыдущий оставлен.';
    if(hadText&&state==='error')notice='Не удалось распознать заново. Предыдущий текст оставлен.';
    paintControls();
    if(state==='loading')status.textContent='Распознавание началось';
    else if(state==='ready')status.textContent=content.marks.length?'Слова на странице доступны для выбора':content.paragraphs.some(p=>p.trim())?'Распознанный текст доступен':'';
    else status.textContent='';
  }
  function showPage(data={}){
    if(dead)return;
    revoke();
    page={...data};
    content={paragraphs:[],marks:[]};notice='';panelBuilt=false;panel.replaceChildren();paintMarks();
    const total=Number.isInteger(page.total)&&page.total>0?page.total:1;
    page.index=Number.isInteger(page.index)?Math.max(0,Math.min(page.index,total-1)):0;
    page.total=total;readText=false;waiting=false;
    count.textContent=(page.index+1)+' / '+total;
    count.setAttribute('aria-label','Страница '+(page.index+1)+' из '+total);
    const noPrev=!onNavigate||page.index===0,noNext=!onNavigate||page.index===total-1;
    // A native disabled button drops focus. Keep it in the page controls at
    // either boundary, without turning the next Enter into a reverse turn.
    if((noPrev&&doc.activeElement===prev)||(noNext&&doc.activeElement===next))count.focus({preventScroll:true});
    prev.disabled=noPrev;next.disabled=noNext;
    frame.style.aspectRatio=Number.isFinite(page.width)&&page.width>0&&Number.isFinite(page.height)&&page.height>0?page.width+' / '+page.height:'';
    fault.hidden=true;frame.classList.remove('comic-image-failed');frame.replaceChildren();
    const currentImg=img=el('img','comic-art');
    img.alt='Страница '+(page.index+1);img.decoding='async';img.draggable=false;
    if(Number.isInteger(page.width)&&page.width>0)img.width=page.width;
    if(Number.isInteger(page.height)&&page.height>0)img.height=page.height;
    frame.append(img,overlay,fault);
    const fail=()=>{if(img!==currentImg||dead)return;img.hidden=true;fault.hidden=false;frame.classList.add('comic-image-failed');paintControls();};
    img.onerror=fail;
    try{url=URL.createObjectURL(page.blob);img.src=url;}catch{fail();}
    setOCR({...data,index:page.index,status:data.status||(data.words?.length||data.text?.trim()||data.paragraphs?.some(p=>(typeof p==='string'?p:p?.text)?.trim())?'ready':'idle')});
    // Reserved dimensions keep the image steady before decode even after restoration.
  }
  async function recognize() {
    if(!onRecognize||waiting||!page.blob)return;
    const requested=page;waiting=true;state='loading';paintControls();status.textContent='Распознавание началось';
    try{
      const result=await onRecognize(page.index);
      if (dead || requested!==page || state!=='loading')return;
      if (result && typeof result==='object' && ('status' in result || 'paragraphs' in result || 'words' in result)) setOCR(result);
      // A fire-and-forget callback can supply the result later through setOCR().
    }catch(e){
      if(!dead&&requested===page&&state==='loading')setOCR({status:e?.name==='AbortError'?'idle':'error'});
    }
  }
  function click(e) {
    const target=e.target.closest?.('button');
    if(!target||target.disabled)return;
    if(target===prev || target===next){onNavigate?.(page.index+(target===prev?-1:1));return;}
    if(target===correction){onCorrection?.(page.index,correction);return;}
    if(target===ocr){
      if(content.marks.length){drawMarks=!drawMarks;paintControls();}
      else void recognize();
      return;
    }
    if(target===transcript){readText=!readText;paintControls();return;}
    if(target.dataset.word!==undefined && onWord){
      e.stopPropagation();
      if(e.detail>0&&target.classList.contains('comic-token')&&doc.getSelection?.()?.isCollapsed===false)return;
      const paragraphIndex=Number(target.dataset.paragraph);
      onWord({button:target,word:target.textContent,offset:Number(target.dataset.offset),text:content.paragraphs[paragraphIndex],paragraphIndex,event:e});
    }
  }
  function focusMark(e){
    const target=e.target;if(!target.classList?.contains('comic-hotspot'))return;
    const old=overlay.querySelector('.comic-hotspot[tabindex="0"]');if(old&&old!==target)old.tabIndex=-1;target.tabIndex=0;
  }
  function keys(e) {
    const target=e.target;
    if(!target.classList?.contains('comic-hotspot') || e.ctrlKey||e.metaKey||e.altKey||e.shiftKey)return;
    const current=Number(target.dataset.mark),last=overlay.children.length-1;
    const moves={ArrowLeft:Math.max(0,current-1),ArrowRight:Math.min(last,current+1),Home:0,End:last};
    if(!Object.hasOwn(moves,e.key))return;
    e.preventDefault();e.stopPropagation();
    const nextMark=overlay.children[moves[e.key]];if(nextMark){nextMark.focus();}
  }
  root.addEventListener('click',click);root.addEventListener('keydown',keys);root.addEventListener('focusin',focusMark);
  function destroy(){
    if(dead)return;dead=true;revoke();root.removeEventListener('click',click);root.removeEventListener('keydown',keys);root.removeEventListener('focusin',focusMark);
    root.remove();instances.delete(host);page={};content={paragraphs:[],marks:[]};
  }
  const api={showPage,setOCR,destroy};instances.set(host,api);return api;
}
