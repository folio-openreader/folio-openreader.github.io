// Use compound keys in the existing store so an old open Folio tab never
// blocks a schema upgrade. A bounded book query excludes every image record.
import {comicModelTag,COMIC_OCR_LANGUAGES} from './comic-languages.js';
const imageKey=(bookId,index)=>['comic-page',bookId,index];
export const booksOnly=()=>IDBKeyRange.upperBound([],true);
export function isComic(book){return book?.kind==='comic'&&Array.isArray(book.comicPages)&&book.comicPages.length===book.chapters?.length}
export function comicBook(id,parsed,ocrLanguage,createdAt=Date.now()){
  const language=comicModelTag(ocrLanguage);
  return {id,kind:'comic',title:parsed.title,author:'',format:parsed.format,language,ocrLanguage,createdAt,alignment:'none',
    comicPages:parsed.pages.map(({name,width,height})=>({name,width,height})),
    chapters:parsed.pages.map((_,i)=>({title:'Страница '+(i+1),paragraphs:[{text:'',translation:null}]}))};
}
export function comicTransaction(db,mode,action,signal){
  return new Promise((resolve,reject)=>{
    const canceled=()=>new DOMException('Открытие страницы отменено.','AbortError');
    if(signal?.aborted){reject(canceled());return;}
    if(!db){reject(new Error('Хранилище комиксов недоступно.'));return}
    const tx=db.transaction('books',mode);let value;
    const abort=()=>{try{tx.abort()}catch{/* It may already be completing. */}};
    const detach=()=>signal?.removeEventListener('abort',abort);
    tx.oncomplete=()=>{detach();signal?.aborted?reject(canceled()):resolve(value);};
    tx.onabort=()=>{detach();reject(signal?.aborted?canceled():tx.error||new Error('Изменения не сохранились.'));};
    signal?.addEventListener('abort',abort,{once:true});
    try{
      const request=action(tx.objectStore('books'));
      if(request)request.onsuccess=()=>{value=request.result};
    }catch(e){detach();abort();reject(e)}
  });
}
export const putComic=(db,book,pages)=>comicTransaction(db,'readwrite',store=>{
  store.add(book);
  pages.forEach(({blob},index)=>store.add({id:imageKey(book.id,index),index,blob}));
});
export const readComicPage=(db,id,index,signal)=>comicTransaction(db,'readonly',store=>store.get(imageKey(id,index)),signal);
export const dropComic=(db,id,count)=>comicTransaction(db,'readwrite',store=>{
  store.delete(id);store.delete(IDBKeyRange.bound(imageKey(id,0),imageKey(id,count-1)));
});
export function comicOCRChapter(chapter,ocr){
  if(!chapter || !COMIC_OCR_LANGUAGES.includes(ocr?.ocrLanguage) || !ocr.paragraphs?.length ||
     !ocr.paragraphs.every(p=>typeof p?.text==='string'&&p.text.trim())) throw new Error('Нет текста для сохранения.');
  return {...chapter,ocrLanguage:ocr.ocrLanguage,paragraphs:ocr.paragraphs.map(p=>({text:p.text,translation:null}))};
}
export function updateComicPage(db,bookId,page){
  return comicTransaction(db,'readwrite',store=>{
    // Read the latest record in the same transaction. Updating page B must
    // never erase a just-completed correction from page A or recreate a
    // deleted comic. The page image and text retain their original key.
    const tx=store.transaction, request=store.get(bookId);
    request.onsuccess=()=>{
      try{
        const book=request.result, index=page.index;
        if(!isComic(book)||!Number.isInteger(index)||!book.chapters[index]||!(page.blob instanceof Blob))throw new Error('Комикс недоступен.');
        const chapters=book.chapters.slice();chapters[index]=comicOCRChapter(chapters[index],page.ocr);
        store.put({...book,chapters});store.put({...page,id:imageKey(bookId,index)});
      }catch{tx.abort()}
    };
  });
}
