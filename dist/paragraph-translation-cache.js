// Private derived data: sidecar keys share the existing IndexedDB "books" store.
// New tabs can use the cache without blocking on a database schema upgrade.
const PREFIX='paragraph-translation-v1', RECENT=['paragraph-translation-recent-v1'];
const GENERATION='localTranslationGeneration', MAX_ROWS=256, MAX_TEXT=24_000;
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const validGeneration=value=>typeof value==='string'&&uuid.test(value);
const titleId=value=>typeof value==='string'&&/^[a-z0-9_-]{1,192}$/i.test(value);
const index=value=>Number.isInteger(value)&&value>=0&&value<65_536;
const revision=value=>typeof value==='string'&&/^folio-bergamot-[a-z]{2}-[a-z]{2}-[\d.]+-packed$/.test(value)&&value.length<=80;
const valueText=value=>typeof value==='string'&&value.length>0&&value.length<=MAX_TEXT&&!!value.trim();
const validEntry=entry=>titleId(entry?.id)&&validGeneration(entry.generation)&&index(entry.ci)&&index(entry.pi)&&revision(entry.model)&&valueText(entry.text);
const keyOf=(id,generation,{ci,pi,model})=>[PREFIX,id,generation,ci,pi,model];
const rangeFor=id=>IDBKeyRange.bound([PREFIX,id],[PREFIX,id,[]],false,true);
const sameKey=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const recentRows=row=>Array.isArray(row?.keys)?row.keys.slice(-MAX_ROWS).filter(k=>
  Array.isArray(k)&&k.length===6&&k[0]===PREFIX&&titleId(k[1])&&validGeneration(k[2])&&index(k[3])&&index(k[4])&&revision(k[5])):[];
const sourceMatches=(book,entry)=>{
  const p=book?.chapters?.[entry.ci]?.paragraphs?.[entry.pi];
  return book?.kind!=='comic'&&p?.text===entry.text&&!p.translation;
};
const currentGeneration=(book,entry)=>book?.[GENERATION]===entry.generation&&sourceMatches(book,entry);
const freshGeneration=()=>globalThis.crypto?.randomUUID?.()||null;

/** Always stamp a new identity on a book imported, restored or replaced. */
export function stampTextBook(book){
  return {...book,[GENERATION]:freshGeneration()};
}

/** Call inside the same write transaction as deleting or replacing a book. */
export function clearTextBookTranslations(store,ids){
  const valid=new Set([...ids].filter(titleId));if(!valid.size)return;
  for(const id of valid)store.delete(rangeFor(id));
  const existing=store.get(RECENT);
  existing.onsuccess=()=>{
    const keys=recentRows(existing.result).filter(key=>!valid.has(key[1]));
    if(keys.length)store.put({id:RECENT,keys});else store.delete(RECENT);
  };
}

function transaction(db,mode,action){
  if(!db)return Promise.resolve(null);
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('books',mode);let result=null;
    tx.oncomplete=()=>resolve(result);
    tx.onabort=()=>reject(tx.error||new Error('Translation cache transaction aborted'));
    try{action(tx.objectStore('books'),value=>{result=value});}
    catch(error){try{tx.abort()}catch{}reject(error);}
  });
}

/** The returned ID is bound to a stored generation and exact source, not just an ID. */
export async function prepareParagraphCache(db,loc,model){
  const {book,ci,pi,p}=loc;
  if(!db||!titleId(book?.id)||!index(ci)||!index(pi)||!revision(model)||!valueText(p?.text)||p.translation)return null;
  const entry={id:book.id,ci,pi,model,text:p.text};
  if(validGeneration(book[GENERATION]))return Object.freeze({...entry,generation:book[GENERATION]});
  // An old installed book gets an identity once, on its first cache use.
  // If another tab has already replaced/stamped it, do not adopt that identity
  // merely because the ID is the same. Reload to read the new record normally.
  const newGeneration=freshGeneration();if(!validGeneration(newGeneration))return null;
  const saved=await transaction(db,'readwrite',(store,done)=>{
    const read=store.get(entry.id);
    read.onsuccess=()=>{
      const stored=read.result;
      if(stored?.[GENERATION]||stored?.createdAt!==book.createdAt||!sourceMatches(stored,entry))return;
      store.put({...stored,[GENERATION]:newGeneration});
      done(newGeneration);
    };
  });
  if(!saved)return null;
  book[GENERATION]=saved;
  return Object.freeze({...entry,generation:saved});
}

export function readParagraphCache(db,entry){
  if(!validEntry(entry))return Promise.resolve(null);
  return transaction(db,'readonly',(store,done)=>{
    const row=store.get(keyOf(entry.id,entry.generation,entry));
    row.onsuccess=()=>{
      const value=row.result?.value;
      // A cold cache miss should never clone the full book from IndexedDB.
      if(!valueText(value))return;
      const book=store.get(entry.id);
      book.onsuccess=()=>{if(currentGeneration(book.result,entry))done(value);};
    };
  });
}

export function writeParagraphCache(db,entry,value){
  if(!validEntry(entry)||!valueText(value))return Promise.resolve(false);
  return transaction(db,'readwrite',(store,done)=>{
    const book=store.get(entry.id),recent=store.get(RECENT);
    recent.onsuccess=()=>{
      // Recheck the live book after translation has completed. The book and sidecar
      // requests serialize with delete, replace and restore, including other tabs.
      if(!currentGeneration(book.result,entry)){done(false);return;}
      const key=keyOf(entry.id,entry.generation,entry),keys=recentRows(recent.result).filter(k=>!sameKey(k,key));
      keys.push(key);
      for(const expired of keys.splice(0,Math.max(0,keys.length-MAX_ROWS)))store.delete(expired);
      store.put({id:key,value});store.put({id:RECENT,keys});done(true);
    };
  });
}
