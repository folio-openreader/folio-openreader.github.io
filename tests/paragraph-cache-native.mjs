// Run inside a real browser (see paragraph-cache-browser.py). No IDB mock.
import {clearTextBookTranslations,prepareParagraphCache,readParagraphCache,stampTextBook,writeParagraphCache} from '../dist/paragraph-translation-cache.js';
import {parseBackup,serializeBackup} from '../dist/release-core.js';
const id='book-a45c1397-b71f-4cf8-aaff-55660c574919',other='book-89752796-bd17-4c70-b725-1c48946d4ec7';
const model='folio-bergamot-en-ru-2.1-packed',nextModel='folio-bergamot-en-ru-2.2-packed';
const make=(key=id)=>({id:key,createdAt:6,title:'Synthetic title',author:'',language:'en',format:'TXT',alignment:'none',
  chapters:[{title:'Chapter',paragraphs:[{text:'The river enters the sea.',translation:null}]}]});
const locationOf=book=>({book,ci:0,pi:0,p:book.chapters[0].paragraphs[0]});
const equal=(value,expected,label)=>{if(value!==expected)throw Error(label+': got '+JSON.stringify(value)+', expected '+JSON.stringify(expected))};
function open(name){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(name);req.onupgradeneeded=()=>req.result.createObjectStore('books',{keyPath:'id'});
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
function transact(db,mode,fn){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('books',mode),store=tx.objectStore('books');let request;
    tx.oncomplete=()=>resolve(request?.result);
    tx.onabort=()=>reject(tx.error||new Error('aborted'));
    try{request=fn(store,tx);}catch(error){tx.abort();reject(error);}
  });
}
function remove(db,id){
  return transact(db,'readwrite',store=>{clearTextBookTranslations(store,[id]);return store.delete(id);});
}
function add(db,book,replace=false){
  return transact(db,'readwrite',store=>{clearTextBookTranslations(store,[book.id]);return replace?store.put(book):store.add(book);});
}
function cacheCount(db,which=id){
  return transact(db,'readonly',store=>store.getAllKeys()).then(keys=>
    keys.filter(k=>Array.isArray(k)&&k[0]==='paragraph-translation-v1'&&k[1]===which).length);
}

export async function testNativeParagraphCache(){
  const name='folio-paragraph-cache-fixture-'+crypto.randomUUID(),a=await open(name),b=await open(name);
  try{
    const legacy=make(),staleLegacy=make();
    await transact(a,'readwrite',store=>store.add(legacy));
    equal(await prepareParagraphCache(a,locationOf(legacy),model,{createGeneration:false}),null,'cache-only view does not stamp a legacy book');
    equal((await transact(a,'readonly',store=>store.get(id))).localTranslationGeneration,undefined,'legacy storage unchanged by viewing');
    const first=await prepareParagraphCache(a,locationOf(legacy),model);
    equal(!!first,true,'legacy identity claimed');
    equal(await prepareParagraphCache(b,locationOf(staleLegacy),model),null,'stale untagged tab does not claim new identity');

    const unrelated=stampTextBook(make(other));await add(b,unrelated);
    const otherEntry=await prepareParagraphCache(b,locationOf(unrelated),model);
    equal(await writeParagraphCache(a,first,'old translation'),true,'initial write');
    equal(await writeParagraphCache(b,otherEntry,'unrelated translation'),true,'other book write');
    equal(await readParagraphCache(b,first),'old translation','cross-connection cached read');
    equal(await readParagraphCache(b,await prepareParagraphCache(b,locationOf(legacy),nextModel)),null,'model revision isolated');

    // Rolled-back transaction must not remove only half of the book or cache.
    let aborted=false;
    await transact(b,'readwrite',(store,tx)=>{clearTextBookTranslations(store,[id]);store.delete(id);tx.abort()})
      .catch(()=>{aborted=true;});
    equal(aborted,true,'delete rolled back');
    equal(await readParagraphCache(a,first),'old translation','rollback kept cache');

    // Delayed translation result from the old open tab arrives after a different
    // connection deleted the book and restored the exact same backup and ID.
    let releaseLate;
    const fakeTranslation=new Promise(resolve=>{releaseLate=resolve;});
    const late=fakeTranslation.then(value=>writeParagraphCache(a,first,value));
    await remove(b,id);
    equal(await cacheCount(a),0,'successful delete physically removes sidecar');
    equal(await readParagraphCache(a,first),null,'no read after deletion');
    equal(await writeParagraphCache(a,first,'another late value'),false,'no write after deletion');
    equal(await readParagraphCache(a,otherEntry),'unrelated translation','selective delete');

    const exported=serializeBackup([legacy],{positions:{},bookmarks:{},lastBook:id,prefs:{}},[]);
    equal(exported.includes('localTranslationGeneration'),false,'backup does not export generation');
    equal(exported.includes('old translation'),false,'backup does not export cache');
    const restored=stampTextBook(parseBackup(exported,{id:'demo',chapters:[]}).books[0]);
    await add(b,restored);equal(restored.id,id,'same ID deliberately restored');
    const newEntry=await prepareParagraphCache(b,locationOf(restored),model);
    equal(first.generation===newEntry.generation,false,'restore rotates identity');
    releaseLate('stale value from deleted book');equal(await late,false,'stale result cannot write into restored ID');
    equal(await cacheCount(b),0,'late result creates no sidecar');
    equal(await readParagraphCache(b,newEntry),null,'restored book never reads old result');
    equal(await writeParagraphCache(b,newEntry,'fresh result'),true,'restored book can cache anew');

    // The opposite queue order is safe too: commit a pending write before the
    // subsequent delete transaction; the same transaction purges its sidecar.
    const queued=writeParagraphCache(a,newEntry,'queued result');
    const removal=remove(b,id);equal(await queued,true,'write committed before queued delete');await removal;
    equal(await cacheCount(a),0,'queued delete purges earlier write');
    equal(await readParagraphCache(a,newEntry),null,'queued delete clears record');

    const reused=stampTextBook(make());await add(b,reused);
    const reusedEntry=await prepareParagraphCache(a,locationOf(reused),model);
    await writeParagraphCache(a,reusedEntry,'newly imported translation');
    const replacement=stampTextBook(make());replacement.chapters[0].paragraphs[0].text='A completely different chapter.';
    await add(b,replacement,true);
    equal(await writeParagraphCache(a,reusedEntry,'stale late replacement'),false,'same ID reused for a different text');
    equal(await cacheCount(a),0,'replacement physically removes all older sidecars');
    return 'Native IndexedDB: delete abort, cross-tab delete/restore, late writes, same-ID replacement and model revision passed.';
  }finally{a.close();b.close();await new Promise((ok,bad)=>{const req=indexedDB.deleteDatabase(name);req.onsuccess=ok;req.onerror=()=>bad(req.error);});}
}
