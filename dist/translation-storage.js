import {storageBytes} from './storage-meter.js';

export function modelStatusLabel(info){
  if(!info||info.state==='unavailable')return 'Не удалось проверить';
  if(info.state==='cached')return storageBytes(info.totalBytes)+' сохранено';
  if(info.state==='partial')return storageBytes(info.cachedBytes)+' из '+storageBytes(info.totalBytes);
  return 'Не скачана';
}
export function modelDownloadLabel(info){
  if(!info)return 'Перевести';
  if(info.state==='cached')return 'Перевести на устройстве';
  if(info.state==='partial')return 'Докачать · '+storageBytes(info.totalBytes-info.cachedBytes);
  return 'Скачать модель · '+storageBytes(info.totalBytes);
}
export function installTranslationStorage(mount,modelStorage){
  if(!mount)return;
  let request=0;
  const refresh=()=>{
    const token=++request;
    if(document.hidden||mount.closest('[hidden]'))return;
    for(const entry of mount.querySelectorAll('[data-model-target]')){
      void modelStorage({source:'en',target:entry.dataset.modelTarget}).then(info=>{
        if(token===request&&!mount.closest('[hidden]'))entry.textContent=modelStatusLabel(info);
      });
    }
  };
  const observer=new MutationObserver(refresh);
  for(let cursor=mount;cursor;cursor=cursor.parentElement)observer.observe(cursor,{attributes:true,attributeFilter:['hidden']});
  document.addEventListener('visibilitychange',refresh);
  refresh();
}
