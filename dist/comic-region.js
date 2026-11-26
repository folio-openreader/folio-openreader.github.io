const clamp=n=>Math.min(1,Math.max(0,n));
const meaningful=/[\p{L}\p{N}]/u;
export function fromCorners(a,b){
  const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y);
  return {x,y,w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};
}
export function comicRegionPixels(region,width,height){
  if(!region||![region.x,region.y,region.w,region.h].every(Number.isFinite)||
     region.x<0||region.y<0||region.w<=0||region.h<=0||
     region.x+region.w>1.000001||region.y+region.h>1.000001)return null;
  const x=Math.floor(region.x*width),y=Math.floor(region.y*height);
  const w=Math.min(width,Math.ceil((region.x+region.w)*width))-x;
  const h=Math.min(height,Math.ceil((region.y+region.h)*height))-y;
  return w>=18&&h>=18?{x,y,w,h}:null;
}
export function comicRegionWord(word,rect,width,height){
  return {...word,x:(rect.x+word.x*rect.w)/width,y:(rect.y+word.y*rect.h)/height,
    w:word.w*rect.w/width,h:word.h*rect.h/height};
}
const inside=(word,rect)=>{
  const x=word.x+word.w/2,y=word.y+word.h/2;
  return x>=rect.x&&x<=rect.x+rect.w&&y>=rect.y&&y<=rect.y+rect.h;
};
// A slot is a contiguous run of replaced text in the *old* reading order.
function bounds(words){
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const {x,y,w,h} of words){
    if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0)continue;
    left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+w);bottom=Math.max(bottom,y+h);
  }
  return right>left&&bottom>top?{left,top,right,bottom,area:(right-left)*(bottom-top)}:null;
}
function sharesFootprint(a,b){
  const w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
  return w>0&&h>0&&w*h>=.2*Math.min(a.area,b.area);
}
function slotReplacements(slots,added){
  if(slots.length===1){slots[0].replacements=added;return true;}
  const footprints=slots.map(slot=>bounds(slot.removed));
  if(footprints.some(box=>!box))return false;
  for(const group of added){
    const box=bounds(group.words);
    if(!box)return false;
    let match=-1;
    for(let i=0;i<footprints.length;i++){
      if(!sharesFootprint(box,footprints[i]))continue;
      if(match!==-1)return false;
      match=i;
    }
    if(match===-1)return false;
    slots[match].replacements.push(group);
  }
  // A recognizer can merge two lines or skip one. Never delete another old
  // slot without a clear replacement; the user can choose smaller crops.
  return slots.every(slot=>slot.replacements.length);
}
// Keep unlocated text and untouched text verbatim. If old words overlap the
// replacement, split at their exact UTF-16 ranges rather than dropping other words.
export function mergeComicRegion(previous,next,rect){
  if(!previous?.paragraphs?.length)return next;
  const indexed=new Map(),groups=[],slots=[];
  for(const w of previous.words||[]){
    const p=previous.paragraphs[w.paragraphIndex];
    if(typeof p?.text!=='string'||typeof w.text!=='string'||!w.text||!Number.isInteger(w.offset)||
       w.offset<0||p.text.slice(w.offset,w.offset+w.text.length)!==w.text)continue;
    if(!indexed.has(w.paragraphIndex))indexed.set(w.paragraphIndex,[]);
    indexed.get(w.paragraphIndex).push(w);
  }
  for(const [i,p] of previous.paragraphs.entries()){
    const words=indexed.get(i)||[],removed=words.filter(w=>inside(w,rect)).sort((a,b)=>a.offset-b.offset);
    if(!removed.length){groups.push({p,words});continue;}
    let cursor=0;
    const part=end=>{
      if(end<=cursor)return;
      const raw=p.text.slice(cursor,end),text=raw.trim();
      if(!text||!meaningful.test(text))return;
      const start=cursor+raw.indexOf(text),stop=start+text.length;
      groups.push({p:{text},words:words.filter(w=>w.offset>=start&&w.offset+w.text.length<=stop)
        .map(w=>({...w,offset:w.offset-start}))});
    };
    for(const word of removed){
      part(word.offset);
      let slot=groups.at(-1);
      if(!slot?.removed){slot={removed:[],replacements:[]};groups.push(slot);slots.push(slot);}
      slot.removed.push(word);
      cursor=Math.max(cursor,word.offset+word.text.length);
    }
    part(p.text.length);
  }
  const added=next.paragraphs.map(p=>({p,words:[]}));
  for(const word of next.words||[])added[word.paragraphIndex]?.words.push(word);
  if(!slots.length){
    // Text newly recognized in previously unlocated space keeps the old
    // insertion behavior. No existing group is moved relative to another.
    const below=groups.findIndex(g=>g.words.length&&g.words.every(w=>w.y>=rect.y+rect.h));
    groups.splice(below<0?groups.length:below,0,...added);
  }else if(!slotReplacements(slots,added)){
    return {...previous,status:'ambiguous'};
  }
  const ordered=groups.flatMap(group=>group.replacements||[group]);
  return {status:'ready',paragraphs:ordered.map(g=>g.p),words:ordered.flatMap((g,i)=>g.words.map(w=>({...w,paragraphIndex:i})))};
}

export function createComicRegionPicker(dialog){
  const viewport=dialog.querySelector('.comic-region-viewport'),frame=viewport.querySelector('figure');
  const img=frame.querySelector('img'),box=frame.querySelector('.comic-region-box'),pin=frame.querySelector('.comic-region-pin');
  const note=dialog.querySelector('.comic-region-help'),go=dialog.querySelector('[data-region-start]');
  const reset=dialog.querySelector('[data-region-reset]'),cancel=dialog.querySelector('[data-region-cancel]');
  const win=dialog.ownerDocument.defaultView;
  let opened=null,first=null,region=null,keys=null;
  function mark(el,x,y,w,h){
    el.hidden=false;el.style.left=x*100+'%';el.style.top=y*100+'%';
    if(w!==undefined){el.style.width=w*100+'%';el.style.height=h*100+'%';}
  }
  function clear(){
    first=null;region=null;keys=null;box.hidden=true;pin.hidden=true;go.disabled=true;
    note.textContent='Коснитесь одного угла облачка, затем противоположного. Между касаниями можно прокручивать страницу.';
  }
  function choose(point){
    if(!opened)return;
    if(!first||region){clear();first=point;mark(pin,point.x,point.y);
      note.textContent='Выбран первый угол. Коснитесь противоположного угла.';
      return;}
    const selected=fromCorners(first,point);
    if(!comicRegionPixels(selected,opened.width,opened.height)){
      note.textContent='Область слишком мала. Выберите более дальний угол.';return;
    }
    region=selected;pin.hidden=true;mark(box,selected.x,selected.y,selected.w,selected.h);
    go.disabled=false;note.textContent='Область выбрана. Проверьте, что текст целиком внутри рамки.';
  }
  function leave(focus=true){
    const held=opened;if(!held)return null;
    opened=null;
    if(dialog.open)dialog.close();
    img.removeAttribute('src');URL.revokeObjectURL(held.url);
    if(focus&&held.opener?.isConnected&&!held.opener.hidden)held.opener.focus({preventScroll:true});
    return held;
  }
  frame.onclick=event=>{
    if(!opened||!event.detail)return;
    const r=img.getBoundingClientRect();
    if(r.width>0&&r.height>0)choose({x:clamp((event.clientX-r.left)/r.width),y:clamp((event.clientY-r.top)/r.height)});
  };
  frame.onkeydown=event=>{
    if(!opened||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Enter',' '].includes(event.key))return;
    event.preventDefault();
    if(!keys){
      const r=img.getBoundingClientRect(),v=viewport.getBoundingClientRect();
      keys={x:.5,y:clamp((v.top+v.height/2-r.top)/Math.max(1,r.height))};
    }
    if(event.key==='Enter'||event.key===' '){const point={...keys};choose(point);keys=point;return;}
    const step=event.shiftKey ? .045 : .012;
    if(event.key==='ArrowLeft')keys.x=clamp(keys.x-step);
    if(event.key==='ArrowRight')keys.x=clamp(keys.x+step);
    if(event.key==='ArrowUp')keys.y=clamp(keys.y-step);
    if(event.key==='ArrowDown')keys.y=clamp(keys.y+step);
    mark(pin,keys.x,keys.y);
    const r=img.getBoundingClientRect(),v=viewport.getBoundingClientRect(),y=r.top+r.height*keys.y;
    if(y<v.top+16)viewport.scrollTop+=y-v.top-16;
    if(y>v.bottom-16)viewport.scrollTop+=y-v.bottom+16;
  };
  reset.onclick=clear;cancel.onclick=()=>leave();
  dialog.addEventListener('cancel',event=>{event.preventDefault();leave();});
  go.onclick=()=>{if(!region)return;const selected=region,held=leave();held?.apply(selected);};
  return {
    open({blob,width,height,offset,opener,apply}){
      if(opened||!(blob instanceof Blob))return;
      clear();
      const url=URL.createObjectURL(blob);
      try{dialog.showModal();}catch{URL.revokeObjectURL(url);return;}
      const held=opened={width,height,opener,apply,url};
      img.width=width;img.height=height;img.src=url;
      viewport.scrollTop=0;
      win.requestAnimationFrame(()=>{
        if(opened===held&&viewport.scrollTop===0)viewport.scrollTop=clamp(offset||0)*img.offsetHeight;
      });
    },
    leave:()=>leave(false),
  };
}
