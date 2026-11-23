import {installSheet} from './sheet.js';
// Single book removal uses a regular, explicit confirmation, not a timed gesture.
export function createBookDeleteDialog(){
  const dialog=document.createElement('dialog');
  dialog.id='book-delete';
  dialog.setAttribute('aria-labelledby','book-delete-title');
  dialog.setAttribute('aria-describedby','book-delete-name book-delete-note');
  dialog.innerHTML=`
    <button type="button" data-sheet-handle aria-label="Закрыть панель" autofocus></button>
    <div class="dialog-heading"><h2 id="book-delete-title">Удалить книгу?</h2></div>
    <p id="book-delete-name" class="delete-summary" dir="auto"></p>
    <p id="book-delete-note">Книга, закладки и место чтения будут удалены из этого браузера. Сохранённые слова останутся.</p>
    <div class="delete-actions">
      <button type="button" class="delete-confirm">Удалить книгу</button>
    </div>
    <p class="delete-status" role="status"></p>`;
  document.body.append(dialog);
  const q=s=>dialog.querySelector(s), name=q('#book-delete-name'),title=q('#book-delete-title'),
    grip=q('[data-sheet-handle]'),confirm=q('.delete-confirm'),status=q('.delete-status');
  let request=null,pending=false;
  const sheet=installSheet(dialog,{canDismiss:()=>!pending});
  confirm.onclick=async e=>{
    if(!e.isTrusted||!request||pending||!dialog.open)return;
    const active=request;
    pending=true;grip.disabled=confirm.disabled=true;title.tabIndex=-1;title.focus({preventScroll:true});
    status.textContent='Удаляем…';
    try{await active.remove();dialog.close()}
    catch{status.textContent='Не удалось удалить книгу. Попробуйте ещё раз.'}
    finally{
      pending=false;grip.disabled=confirm.disabled=false;
      if(dialog.open)grip.focus({preventScroll:true});
    }
  };
  dialog.addEventListener('close',()=>{
    if(dialog.open)return;
    const active=request;request=null;
    const target=active?.trigger?.isConnected?active.trigger:active?.focusFallback?.();
    if(target&&!target.closest('[hidden]'))target.focus({preventScroll:true});
  });
  window.addEventListener('hashchange',()=>{if(dialog.open&&!pending)dialog.close()});
  return {open(options){
    if(dialog.open||request)return;
    request=options;name.textContent=options.bookTitle;status.textContent='';
    sheet.open();
  }};
}
