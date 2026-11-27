// Native vertical scrolling over reserved page slots. Keep only a small window
// of indexed page blobs/decoded images; the rest are layout, not loaded art.
const WINDOW_RADIUS=2, MAX_MOUNTED=10;
const cap=(n,low,high)=>Math.min(high,Math.max(low,n));

export function createComicStrip(host,scroller,pages,{load,onPosition,onReadPage}){
  const doc=host.ownerDocument,win=doc.defaultView;
  const el=(tag,cls,text)=>{
    const node=doc.createElement(tag);node.className=cls;
    if(text)node.textContent=text;
    return node;
  };
  const root=el('section','comic-strip');
  root.setAttribute('aria-label','Вертикальная лента комикса');
  const bar=el('div','comic-strip-bar');
  const count=el('span','comic-count');
  const read=el('button','comic-control','Слова страницы');
  read.type='button';read.setAttribute('aria-label','Распознавание текущей страницы');
  bar.append(count,read);root.append(bar);
  const frames=pages.map(({width,height},i)=>{
    const slot=el('figure','comic-strip-frame');
    slot.dataset.page=i;slot.style.aspectRatio=width>0&&height>0?width+' / '+height:'1 / 1';
    root.append(slot);return slot;
  });
  host.replaceChildren(root);
  const last=frames.length-1,active=new Map();
  let dead=false,raf=0,anchor=null,dimension='';
  const maxScroll=()=>Math.max(0,scroller.scrollHeight-scroller.clientHeight);
  const viewportTop=()=>scroller.getBoundingClientRect().top+bar.offsetHeight;
  const size=()=>scroller.clientWidth+'x'+scroller.clientHeight;
  function pageAt(y){
    let lo=0,hi=last,index=0;
    while(lo<=hi){
      const mid=(lo+hi)>>>1;
      if(frames[mid].getBoundingClientRect().top<=y){index=mid;lo=mid+1;}
      else hi=mid-1;
    }
    return index;
  }
  function artwork(frame,index){
    const {width,height}=pages[index];
    // Mirrors object-fit: contain, including the slot's minimum-height padding.
    // Layout can find the artwork even before IndexedDB delivers its image.
    const artHeight=width>0&&height>0?Math.min(frame.height,frame.width*height/width):frame.height;
    return {height:artHeight,padding:(frame.height-artHeight)/2};
  }
  function sample(head,index){
    const max=maxScroll();
    if(max>1&&max-scroller.scrollTop<1)return {chapter:last,paragraph:0,fraction:.99,comicImageOffset:1,comicLayout:'strip'};
    const frame=frames[index].getBoundingClientRect();
    const comicImageOffset=cap((head-frame.top)/Math.max(1,frame.height),0,.999999);
    const art=artwork(frame,index),point=head-frame.top-art.padding;
    const position={chapter:index,paragraph:0,fraction:Math.min(.99,comicImageOffset),comicImageOffset,comicLayout:'strip'};
    // Preserve legacy slot coordinates and whitespace edges; only a point on the
    // art itself is portable as an artwork offset to a different viewport.
    if(point>0&&point<art.height)position.comicStripArtworkOffset=point/art.height;
    return position;
  }
  function jump(p){
    const index=cap(p.chapter,0,last),offset=p.comicImageOffset??p.fraction??0;
    if(index===last&&offset===1){scroller.scrollTop=maxScroll();return;}
    const frame=frames[index].getBoundingClientRect();
    // At the bottom of a non-final page, leave its last pixel in view so that
    // moving between modes retains the page identity.
    const art=artwork(frame,index),anchor=p.comicStripArtworkOffset;
    const within=Number.isFinite(anchor)?art.padding+art.height*cap(anchor,0,1):frame.height*cap(offset,0,1);
    const inset=Math.min(within,Math.max(0,frame.height-2));
    scroller.scrollTop+=frame.top-viewportTop()+inset;
  }
  function drop(index,slot){
    active.delete(index);
    // The page may be queued behind another local write. Don't read its Blob
    // once it has left the window (the latest viewport keeps its requests).
    slot.load?.abort();
    if(slot.image){slot.image.onerror=null;slot.image.removeAttribute('src');}
    if(slot.url)URL.revokeObjectURL(slot.url);
    frames[index].replaceChildren();
  }
  function mount(index){
    const slot={load:new AbortController()};active.set(index,slot);
    const fail=()=>{
      if(dead||active.get(index)!==slot)return;
      slot.load=null;
      if(slot.image){slot.image.onerror=null;slot.image.removeAttribute('src');}
      if(slot.url){URL.revokeObjectURL(slot.url);slot.url=null;}
      const msg=el('p','comic-image-error','Не удалось открыть страницу '+(index+1)+'.');
      frames[index].replaceChildren(msg);
    };
    Promise.resolve().then(()=>!dead&&active.get(index)===slot?load(index,slot.load.signal):null).then(row=>{
      if(dead||active.get(index)!==slot)return;
      slot.load=null;
      if(!(row?.blob instanceof Blob)){fail();return;}
      const img=slot.image=el('img','comic-strip-art');
      const meta=pages[index];
      img.width=meta.width;img.height=meta.height;img.alt='Страница '+(index+1);img.decoding='async';img.draggable=false;
      slot.url=URL.createObjectURL(row.blob);img.onerror=fail;img.src=slot.url;
      frames[index].replaceChildren(img);
    }).catch(fail);
  }
  function refresh(){
    if(dead||!scroller.clientWidth)return null;
    const nextSize=size();
    if(dimension!==nextSize){
      dimension=nextSize;
      if(anchor&&Math.abs(scroller.scrollTop-Math.min(anchor.top,maxScroll()))<=1)jump(anchor.position);
    }
    const head=viewportTop(),first=pageAt(head+.5);
    const position=sample(head,first),visibleLast=pageAt(scroller.getBoundingClientRect().bottom-.5);
    // Tall pages usually need no more than five images. On short/wide art,
    // prefer every visible page (slots have a viewport-based minimum) to
    // preloading a neighbor the reader cannot see.
    const wantLo=Math.max(0,Math.min(first,position.chapter-WINDOW_RADIUS));
    const wantHi=Math.min(last,Math.max(visibleLast,position.chapter+WINDOW_RADIUS));
    const lo=Math.min(first,Math.max(wantLo,wantHi-MAX_MOUNTED+1)),hi=Math.min(wantHi,lo+MAX_MOUNTED-1);
    for(const [index,slot] of active)if(index<lo||index>hi)drop(index,slot);
    for(let i=lo;i<=hi;i++)if(!active.has(i))mount(i);
    const label=(position.chapter+1)+' / '+frames.length;
    if(count.textContent!==label)count.textContent=label;
    anchor={top:scroller.scrollTop,position};
    onPosition?.(position);
    return position;
  }
  const schedule=()=>{if(!raf&&!dead)raf=win.requestAnimationFrame(()=>{raf=0;refresh()});};
  scroller.addEventListener('scroll',schedule,{passive:true});
  const resize=new ResizeObserver(schedule);resize.observe(scroller);
  read.onclick=()=>{const position=refresh();if(position)onReadPage(position)};
  return {
    seek(position){dimension=size();jump(position);return refresh();},
    position:refresh,
    destroy(){
      if(dead)return;
      dead=true;scroller.removeEventListener('scroll',schedule);resize.disconnect();win.cancelAnimationFrame(raf);
      for(const [index,slot] of active)drop(index,slot);
      root.remove();
    },
  };
}
