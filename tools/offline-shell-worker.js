/* Folio's classic worker. Its only cache is a verified static application package. */
const PACKAGE=/* FOLIO_OFFLINE_PACKAGE */null;
const scope=new URL('./',self.location.href),entry=new URL('app.html',scope);
const family=new URL('_folio_offline/',scope),mount=new URL(PACKAGE.version+'/',family);
const prefix='folio-offline-shell:'+scope.pathname+':',cacheName=prefix+PACKAGE.version;
const marker=new URL('_folio_offline_complete',scope).href;
const assets=new Map(PACKAGE.assets.map(asset=>[new URL(asset.path,scope).href,asset]));
const mime={js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',
  html:'text/html; charset=utf-8',webmanifest:'application/manifest+json',png:'image/png',woff2:'font/woff2'};
const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
let filling=null;
async function completeCache(){
  if(!await caches.has(cacheName))return null;
  const cache=await caches.open(cacheName);
  if(!await cache.match(marker))return null;
  const found=new Set((await cache.keys()).map(key=>key.url));
  return [...assets.keys()].every(url=>found.has(url))?cache:null;
}
function prepare(){
  if(filling)return filling;
  filling=(async()=>{
    if(self.registration.scope!==scope.href)throw Error('scope');
    if(await completeCache())return;
    await caches.delete(cacheName);
    const cache=await caches.open(cacheName);
    try{
      // Four small same-origin assets at a time. No auth, redirect, or user data.
      const batch=[...assets.entries()];
      for(let i=0;i<batch.length;i+=4)await Promise.allSettled(batch.slice(i,i+4).map(async ([url,asset])=>{
        const response=await fetch(url,{credentials:'omit',mode:'same-origin',redirect:'error',cache:'reload'});
        if(!response.ok||response.redirected||response.url!==url||response.type!=='basic')throw Error('response');
        const body=await response.arrayBuffer();
        if(body.byteLength!==asset.bytes||await digest(body)!==asset.sha256)throw Error('version');
        // Strip the network response URL. Otherwise relative imports would
        // resolve outside the virtual package and could mix application versions.
        await cache.put(url,new Response(body,{headers:{'Content-Type':mime[asset.path.split('.').at(-1)]}}));
      })).then(results=>{if(results.some(result=>result.status==='rejected'))throw Error('asset');});
      await cache.put(marker,new Response(PACKAGE.version));
      if(!await completeCache())throw Error('incomplete');
    }catch(e){await caches.delete(cacheName);throw e;}
  })().finally(()=>{filling=null;});
  return filling;
}
self.addEventListener('install',event=>event.waitUntil(prepare()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Do not skip waiting. An old pinned reader may still need its package.
  if(!await completeCache())return;
  const prior=(await caches.keys()).filter(name=>name.startsWith(prefix)&&/^[a-f0-9]{24}$/.test(name.slice(prefix.length))&&name!==cacheName);
  await Promise.all(prior.map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
const unavailable=()=>new Response('Офлайн-копия недоступна. Подключитесь к интернету и подготовьте её снова.',{
  status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'},
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  url.hash='';
  if(request.method!=='GET'||url.origin!==scope.origin)return;
  if(request.mode==='navigate'&&url.href===entry.href){
    event.respondWith(fetch(request).catch(async()=>{
      const cache=await completeCache().catch(()=>null);
if(!cache)return Response.error();
      const target=new URL('app.html',mount).href;
      // A reload may carry a deep reading hash which is never sent to the
      // server. Preserve it while entering the explicitly pinned package.
      return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Folio офлайн</title><script>location.replace('+
        JSON.stringify(target)+'+location.hash)</script><noscript>Для чтения без интернета включите JavaScript.</noscript></html>',
        {headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
    }));
    return;
  }
  if(!url.href.startsWith(family.href))return;
  if(url.search)return event.respondWith(unavailable());
  if(!url.href.startsWith(mount.href)){
    const prior=url.href.slice(family.href.length);
    // Only a new document may switch versions. Assets from an old virtual
    // path can never get substituted with new-version bytes.
    if(request.mode!=='navigate'||!(/^[a-f0-9]{24}\/app\.html$/).test(prior))return event.respondWith(unavailable());
    return event.respondWith(completeCache().then(cache=>cache?Response.redirect(new URL('app.html',mount).href,302):unavailable()).catch(unavailable));
  }
  const part=url.href.slice(mount.href.length),original=new URL(part,scope);
  // One virtual pathname/version owns every local shell request. Never
  // substitute active network assets or unrelated paths into this document.
  if(!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[a-z0-9]+$/.test(part)||!assets.has(original.href)||
     (request.mode==='navigate'&&original.href!==entry.href))return event.respondWith(unavailable());
  event.respondWith((async()=>{
    const cache=request.mode==='navigate'?await completeCache():await caches.has(cacheName)?await caches.open(cacheName):null;
    return await cache?.match(original.href)||unavailable();
  })().catch(unavailable));
});
self.addEventListener('message',event=>{
  const port=event.ports[0];
  if(!port||!event.source?.url||new URL(event.source.url).origin!==scope.origin)return;
  const url=new URL(event.source.url);
  if(url.pathname!==entry.pathname&&url.pathname!==new URL('app.html',mount).pathname)return;
  const action=event.data?.folioOffline;
  if(action!=='status'&&action!=='prepare')return;
  event.waitUntil((async()=>{
    if(action==='prepare'){
      if(url.pathname!==entry.pathname)return port.postMessage({ready:false});
      await prepare();
    }
    port.postMessage({ready:!!await completeCache(),url:new URL('app.html',mount).href,version:PACKAGE.version});
  })().catch(()=>port.postMessage({ready:false})));
});
