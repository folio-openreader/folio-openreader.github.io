const parentOf=url=>new URL('./',url);
const inOfflineFolder=url=>/\/_folio_offline\/[a-f0-9]{24}\/app\.html$/.test(url.pathname);
function ask(worker,action,ms=1800){
  if(!worker)return Promise.resolve(null);
  return new Promise(resolve=>{
    const channel=new MessageChannel();
    const finish=reply=>{clearTimeout(timer);channel.port1.close();resolve(reply);};
    const timer=setTimeout(()=>finish(null),ms);
    channel.port1.onmessage=e=>finish(e.data);
    try{worker.postMessage({folioOffline:action},[channel.port2]);}catch{finish(null);}
  });
}
export function installOfflineShell(panel){
  if(!panel)return;
  const page=new URL(location.href),offline=inOfflineFolder(page);
  const scope=offline?new URL('../../',page):parentOf(page);
  const worker=new URL('folio-offline-worker.js',scope),entry=new URL('app.html',scope);
  const setup=panel.querySelector('[data-offline-prepare]'),remove=panel.querySelector('[data-offline-remove]');
  const status=panel.querySelector('[data-offline-status]'),open=panel.querySelector('[data-offline-open]');
  let sw;try{sw=navigator.serviceWorker}catch{}
  let busy=false;
  const own=registration=>registration?.scope===scope.href&&
    [registration.installing,registration.waiting,registration.active].some(w=>w?.scriptURL===worker.href);
  const registration=async()=>{
    const found=await sw?.getRegistration(scope.href);
    return own(found)?found:null;
  };
  function show(reply,reg){
    const address=typeof reply?.url==='string'?new URL(reply.url):null;
    const local=address&&inOfflineFolder(address)&&address.href.startsWith(scope.href);
    const ready=!!(reply?.ready&&local);
    open.hidden=!ready;setup.hidden=offline||ready;remove.hidden=offline||!reg;
    if(ready){open.href=address.href+'#home';status.textContent='Готово. Сохранённые книги можно открыть без интернета.';}
    else{
      open.removeAttribute('href');
      status.textContent=reg?'Офлайн-копия ещё не готова. Нужен интернет.':'Офлайн-копия не подготовлена.';
    }
    if(offline){open.href=entry.href+location.hash;open.textContent='Открыть обычную читалку';open.hidden=false;}
    return ready;
  }
  async function refresh(){
    if(busy)return;
    try{
      const reg=await registration();
      show(await ask(reg?.active,'status'),reg);
    }catch{status.textContent='Этот браузер не показал состояние офлайн-копии.';}
  }
  if(!window.isSecureContext||!sw||!window.caches){
    setup.hidden=true;status.textContent='Подготовка недоступна в этом браузере.';return;
  }
  setup.onclick=async()=>{
    if(busy||offline)return;
    busy=setup.disabled=true;open.hidden=true;remove.hidden=true;
    status.textContent='Проверяем и сохраняем файлы читалки…';
    let reg;
    try{
      // Never replace a different service worker in this owner's origin.
      const other=await sw.getRegistration(scope.href);
      if(other&&!own(other))throw Error('another worker');
      reg=other||await sw.register(worker.href,{scope:scope.href,updateViaCache:'none'});
      const start=performance.now();
      while(performance.now()-start<25000){
        if(reg.active){
          const reported=await ask(reg.active,'status');
          if(show(reported,reg))return;
          const repaired=await ask(reg.active,'prepare',20000);
          if(show(repaired,reg))return;
          break;
        }
        if(!reg.installing&&!reg.waiting)break;
        await new Promise(resolve=>setTimeout(resolve,120));
      }
      throw Error('offline package');
    }catch{setup.hidden=false;remove.hidden=!reg;status.textContent='Не удалось подготовить копию. Проверьте подключение и попробуйте ещё раз.';}
    finally{busy=setup.disabled=false;}
  };
  remove.onclick=async()=>{
    if(busy||offline)return;
    busy=remove.disabled=true;
    try{
      const reg=await registration();if(reg)await reg.unregister();
      const prefix='folio-offline-shell:'+scope.pathname+':';
      const names=(await caches.keys()).filter(name=>name.startsWith(prefix)&&/^[a-f0-9]{24}$/.test(name.slice(prefix.length)));
      await Promise.all(names.map(name=>caches.delete(name)));
      show(null,null);
    }catch{status.textContent='Не удалось удалить файлы читалки.';}
    finally{busy=remove.disabled=false;}
  };
  window.addEventListener('online',refresh);
  document.querySelector('#profile-view')?.addEventListener('folio:profile-page',event=>{
    if(event.detail?.page==='storage')void refresh();
  });
  if(location.hash==='#profile/storage')void refresh();
}
installOfflineShell(document.querySelector('#profile-offline'));
