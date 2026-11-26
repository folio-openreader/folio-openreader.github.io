import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKUP_BOOK_LIMIT,DEMO_ID,parseBackup,serializeBackup} from '../dist/release-core.js';

const book=i=>({id:'book-00000000-0000-0000-0000-'+String(i).padStart(12,'0'),
 title:'Fixture '+i,format:'TXT',chapters:[{title:'Chapter 1',paragraphs:[{text:'A local sample.'}]}]});
const demo={id:DEMO_ID,chapters:[]},comic={id:'comic-test',kind:'comic'};
const state={positions:{},bookmarks:{},lastBook:DEMO_ID,prefs:{}};

test('local backup limits agree at the count boundary, excluding comic images and the bundled demo',()=>{
  const supported=Array.from({length:BACKUP_BOOK_LIMIT},(_,i)=>book(i+1));
  const file=serializeBackup([demo,comic,...supported],state,[]);
  assert.equal(parseBackup(file,demo).books.length,BACKUP_BOOK_LIMIT);
  const additional=book(BACKUP_BOOK_LIMIT+1);
  assert.throws(()=>serializeBackup([...supported,additional],state,[]),/больше 1000 текстовых книг/);
  const older=JSON.parse(file);older.books.push(additional);
  assert.throws(()=>parseBackup(JSON.stringify(older),demo),/больше 1000 текстовых книг/);
});

test('large backup support does not accept duplicate IDs or malformed individual text',()=>{
  const file=JSON.parse(serializeBackup([book(1),book(2)],state,[]));
  file.books[1].id=file.books[0].id;
  assert.throws(()=>parseBackup(JSON.stringify(file),demo),/повторяющиеся идентификаторы/);
  file.books[1]=book(2);file.books[1].chapters[0].paragraphs[0].text='';
  assert.throws(()=>parseBackup(JSON.stringify(file),demo),/повреждённым форматом/);
});

test('a text backup contains neither EPUB illustration slots nor asset data',()=>{
  const art=book(1);
  art.format='EPUB';
  art.chapters[0].illustrations=[{asset:0,before:0,width:120,height:160,alt:'Local illustration'}];
  const file=serializeBackup([art],state,[]);
  assert(!file.includes('illustrations'));
  assert(!file.includes('Local illustration'));
  assert.deepEqual(parseBackup(file,demo).books[0].chapters[0].paragraphs,[{text:'A local sample.',translation:null}]);
});
