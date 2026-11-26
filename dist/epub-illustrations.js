// IndexedDB sidecars keep library startup and textual backups free of image bytes.
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
export function createIllustrationLayer(scroller,load){
  const states=new Map();
  const unload=(image,state)=>{
    state.ticket=null;image.onerror=null;
    if(state.url){
      image.removeAttribute('src');URL.revokeObjectURL(state.url);state.url=null;
    }
  };
  const observer=new IntersectionObserver(entries=>{
    for(const {target:image,isIntersecting} of entries){
      const state=states.get(image);if(!state)continue;
      if(!isIntersecting){unload(image,state);continue;}
      if(state.url||state.ticket||state.failed)continue;
      const ticket=state.ticket={};
      const fail=()=>{
        if(states.get(image)!==state||state.ticket!==ticket)return;
        state.failed=true;unload(image,state);
        image.parentElement?.setAttribute('data-image-unavailable','');
      };
      Promise.resolve().then(()=>load(state.asset)).then(row=>{
        if(states.get(image)!==state||state.ticket!==ticket)return;
        if(!(row?.blob instanceof Blob)){fail();return;}
        state.url=URL.createObjectURL(row.blob);
        image.onerror=fail;image.src=state.url;
      }).catch(fail);
    }
  },{root:scroller,rootMargin:'320px'});
  return {
    mount(doc,{asset,alt,width,height},language){
      const figure=doc.createElement('figure'),image=doc.createElement('img');
      figure.className='reading-illustration';
      figure.style.setProperty('--art-width',width+'px');
      figure.style.setProperty('--art-ratio',String(width/height));
      const missing=doc.createElement('span');
      missing.className='muted';missing.textContent='Изображение недоступно';
      image.alt=alt;image.lang=language;image.decoding='async';image.width=width;image.height=height;
      figure.append(image,missing);
      states.set(image,{asset});observer.observe(image);
      return figure;
    },
    destroy(){
      observer.disconnect();
      for(const [image,state] of states)unload(image,state);
      states.clear();
    },
  };
}
