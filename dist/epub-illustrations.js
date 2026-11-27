// IndexedDB sidecars keep library startup and the default text backup free of image bytes.
// A chapter reserves each image's aspect ratio before reading its local Blob.
const KEY='epub-illustration-v1';
const keyOf=(id,index)=>[KEY,id,index];
export function putIllustrations(store,id,images=[]){
  images.forEach((blob,index)=>store.add({id:keyOf(id,index),blob}));
}
export function dropIllustrations(store,id){
  store.delete(IDBKeyRange.bound([KEY,id],[KEY,id,[]],false,true));
}
export function readIllustration(store,id,index){
  return store.get(keyOf(id,index));
}
export function createIllustrationLayer(scroller,load,onOpen){
  const states=new Map();
  const unload=state=>{
    const {image,button}=state;
    state.ticket=null;state.blob=null;image.onerror=null;button.hidden=true;
    if(state.url){
      image.removeAttribute('src');URL.revokeObjectURL(state.url);state.url=null;
    }
  };
  const observer=new IntersectionObserver(entries=>{
    for(const {target:figure,isIntersecting} of entries){
      const state=states.get(figure);if(!state)continue;
      const {image,button}=state;
      state.nearby=isIntersecting;
      if(!isIntersecting){
        // Page Down can scroll beyond the lazy window while the button still
        // owns focus. Hiding it here would restart Tab at the beginning.
        if(button.ownerDocument.activeElement!==button)unload(state);
        continue;
      }
      if(state.url||state.ticket||state.failed)continue;
      const ticket=state.ticket={};
      const fail=()=>{
        if(states.get(figure)!==state||state.ticket!==ticket)return;
        state.failed=true;unload(state);figure.setAttribute('data-image-unavailable','');
      };
      Promise.resolve().then(()=>load(state.asset)).then(row=>{
        if(states.get(figure)!==state||state.ticket!==ticket)return;
        if(!(row?.blob instanceof Blob)){fail();return;}
        state.blob=row.blob;state.url=URL.createObjectURL(row.blob);
        image.onerror=fail;image.src=state.url;button.hidden=false;
      }).catch(fail);
    }
  },{root:scroller,rootMargin:'320px'});
  return {
    mount(doc,{asset,alt,width,height},language){
      const figure=doc.createElement('figure'),image=doc.createElement('img'),button=doc.createElement('button');
      const badge=doc.createElement('span');
      badge.className='illustration-expand';badge.setAttribute('aria-hidden','true');badge.textContent='⤢';
      button.className='illustration-open';button.type='button';button.hidden=true;
      button.setAttribute('aria-haspopup','dialog');
      button.setAttribute('aria-label',alt?'Увеличить иллюстрацию: '+alt:'Увеличить иллюстрацию');
      figure.className='reading-illustration';
      figure.style.setProperty('--art-width',width+'px');
      figure.style.setProperty('--art-ratio',String(width/height));
      const missing=doc.createElement('span');
      missing.className='muted';missing.textContent='Изображение недоступно';
      image.alt=alt;image.lang=language;image.decoding='async';image.width=width;image.height=height;
      button.append(image,badge);figure.append(button,missing);
      const state={asset,image,button,nearby:false};
      button.onclick=()=>{
        if(!state.blob)return;
        state.opening=true;
        try{onOpen({blob:state.blob,alt,language,button});}finally{state.opening=false;}
      };
      button.addEventListener('blur',()=>{
        // Opening the viewer temporarily transfers keyboard focus, not reading position.
        if(!state.nearby&&!state.opening&&states.get(figure)===state)unload(state);
      });
      states.set(figure,state);observer.observe(figure);
      return figure;
    },
    destroy(){
      observer.disconnect();
      for(const state of states.values())unload(state);
      states.clear();
    },
  };
}

// A viewer owns its own URL; retiring the lazy preview cannot blank it.
// History carries only a token and local slot, never the image or its description.
export function createIllustrationViewer(dialog){
  const doc=dialog.ownerDocument,win=doc.defaultView,history=win.history;
  const image=dialog.querySelector('img'),close=dialog.querySelector('button'),error=dialog.querySelector('[role=status]');
  let active=null,last=null,closingBack=false;
  function dismiss({focus=true,travel=true}={}){
    const held=active;if(!held)return;
    active=null;
    if(dialog.open)dialog.close();
    image.onerror=null;image.removeAttribute('src');URL.revokeObjectURL(held.url);
    if(focus&&held.button.isConnected&&!held.button.hidden)held.button.focus({preventScroll:true});
    if(travel&&held.token&&history.state?.folioIllustration===held.token){
      closingBack=true;history.back();
    }
  }
  function open({blob,alt,language,button,chapter,slot},restoreToken){
    if(active||closingBack||!(blob instanceof Blob))return;
    const route=win.location.href;
    const marker=history.state?.folioIllustration;
    if(restoreToken&&marker!==restoreToken)return;
    const replay=!!restoreToken||(last?.button===button&&last.route===route&&marker===last.token);
    const url=URL.createObjectURL(blob);
    try{dialog.showModal();}catch{URL.revokeObjectURL(url);return;}
    let token=replay?marker:null;
    if(!replay)try{
      token=crypto.randomUUID();history.pushState({...history.state,folioIllustration:token,folioIllustrationTarget:{route,chapter,slot}},'',route);
    }catch{token=null;}
    active={button,url,token};last=token?{button,token,route}:null;
    image.alt=alt;image.lang=language;image.hidden=false;error.hidden=true;
    image.onerror=()=>{if(active?.url===url){image.hidden=true;error.hidden=false;}};
    image.src=url;
    close.focus({preventScroll:true});
  }
  close.onclick=()=>dismiss();
  // The close button is the only tab stop; keep both Tab directions in the open viewer.
  dialog.addEventListener('keydown',event=>{
    if(!active||event.key!=='Tab'||event.altKey||event.ctrlKey||event.metaKey)return;
    event.preventDefault();close.focus({preventScroll:true});
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  dialog.addEventListener('close',()=>{if(active&&!dialog.open)dismiss();});
  win.addEventListener('popstate',()=>{
    closingBack=false;
    const token=history.state?.folioIllustration;
    if(active&&active.token!==token)dismiss({focus:last?.route===win.location.href,travel:false});
    if(!active&&last&&last.token===token&&last.route===win.location.href&&last.button.isConnected&&!last.button.hidden)
      last.button.click();
  });
  return {open,leave(){dismiss({focus:false,travel:false});last=null;}};
}
