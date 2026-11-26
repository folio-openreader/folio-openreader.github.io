import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createStarterSource,parseStarterCatalog,parseStarterBook} from '../dist/starter-core.js';
import {parseBackup,serializeBackup,DEMO_ID} from '../dist/release-core.js';

const id='starter-test-book';
const book={id,title:'Test book',author:'Test Author',language:'en',level:'A2',format:'TXT',alignment:'none',chapters:[{title:'Chapter 1',paragraphs:[{text:'An apple is on the table.'}]}]};
const content=JSON.stringify(book);
const entry={...book,chapters:undefined,genres:['Приключения'],asset:'starter/books/'+id+'.json',byteLen:Buffer.byteLength(content),
  sha256:createHash('sha256').update(content).digest('hex'),
  edition:{source:'Standard Ebooks',sourceUrl:'https://standardebooks.org/ebooks/test-author/test-book'}};
const catalog={version:1,books:[entry]};
const digest=b=>createHash('sha256').update(b).digest();
const demo={...book,id:DEMO_ID};
test('fetches metadata first and deduplicates the single chosen text request',async()=>{
 const requests=[];
 const source=createStarterSource({digest,fetcher:async (url,opts)=>{
   requests.push(url.pathname);assert.equal(opts.mode,'same-origin');assert.equal(opts.redirect,'error');
   return new Response(url.pathname.endsWith('/manifest.json')?JSON.stringify(catalog):content);
 }});
 assert.equal((await source.loadCatalog()).length,1);assert.equal(requests.length,1);
 const books=await Promise.all([source.loadBook(id),source.loadBook(id)]);
 assert.equal(books[0],books[1]);assert.equal(requests.length,2);assert.equal(books[0].chapters[0].paragraphs[0].translation,null);
});
test('rejects cross-origin assets, duplicate ids, uncertain content and bad digest',async()=>{
 assert.throws(()=>parseStarterCatalog({version:1,books:[entry,entry]}));
 assert.throws(()=>parseStarterCatalog({version:1,books:[{...entry,asset:'https://example.com/leak'}]}));
 assert.throws(()=>parseStarterCatalog({version:1,books:[{...entry,edition:{...entry.edition,sourceUrl:'https://example.com/bogus'}}]}));
 assert.throws(()=>parseStarterBook({...book,chapters:[{title:'Chapter',paragraphs:[{text:'x',translation:'y'}]}]},entry));
 const source=createStarterSource({digest,fetcher:async u=>new Response(u.pathname.endsWith('/manifest.json')?JSON.stringify(catalog):content.replace('apple','camel'))});
 await assert.rejects(source.loadBook(id));
});
test('starter backup roundtrip preserves reading state and citation',()=>{
 const saved=parseStarterBook(book,entry);
 const state={positions:{[id]:{chapter:0,paragraph:0,fraction:.4}},bookmarks:{},lastBook:id,prefs:{}};
 const backup=parseBackup(serializeBackup([demo,saved],state,[]),demo);
 assert.equal(backup.books[0].edition.sourceUrl,entry.edition.sourceUrl);
 assert.equal(backup.positions[id].fraction,.4);
 assert.equal(backup.lastBook,id);
});

test('catalog and local backup preserve validated historical publication dates and ranges',()=>{
 const withYear=value=>({...entry,edition:{...entry.edition,publicationYear:value}});
 const label=value=>parseStarterCatalog({version:1,books:[withYear(value)]})[0].edition.publicationYear;
 assert.equal(label('1903'),1903,'the manifest stores ordinary years as strings');
 assert.equal(label(1903),1903);
 assert.equal(label('1868–1869'),'1868–1869');
 for(const invalid of [null,true,'1869–1868','circa 1880','1903.0','2200','1399','1890–2200'])
  assert.equal(label(invalid),null);
 const record=parseStarterCatalog({version:1,books:[withYear('1868–1869')]})[0];
 const saved=parseStarterBook(book,record);
 assert.equal(parseBackup(serializeBackup([saved],{positions:{},bookmarks:{},lastBook:id,prefs:{}},[]),demo)
  .books[0].edition.publicationYear,'1868–1869');
});
