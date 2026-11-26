import test from 'node:test';
import assert from 'node:assert/strict';
import {comicBook,isComic,comicOCRChapter,updateComicPage} from '../dist/comic-storage.js';
import {comicModelTag,comicPageModel} from '../dist/comic-languages.js';
import {safePosition,serializeBackup,parseBackup} from '../dist/release-core.js';

test('comic metadata is light, can save the page position, and knows OCR language',()=>{
  const input={title:'Night train',format:'CBZ',pages:[
    {name:'Page 2.png',width:680,height:940,blob:new Blob(['fake'])},
    {name:'Page 10.png',width:680,height:940,blob:new Blob(['fake'])},
  ]};
  const b=comicBook('book-f76c53a5-b1ab-4f4b-a8bc-83c1d8a71e25',input,'jpn_vert',123);
  assert.equal(isComic(b),true);
  assert.equal(b.language,'ja');
  assert.equal(b.ocrLanguage,'jpn_vert');
  assert.deepEqual(b.comicPages[0],{name:'Page 2.png',width:680,height:940});
  assert.deepEqual(safePosition({chapter:1,paragraph:0,fraction:.5},b),{chapter:1,paragraph:0,fraction:.5});
  const position={chapter:1,paragraph:0,fraction:.99};
  for(const comicImageOffset of [0,.45,1]){
    const anchor={...position,comicImageOffset};
    assert.deepEqual(safePosition(anchor,b),anchor);
    assert.deepEqual(safePosition(anchor,{chapters:b.chapters}),position);
  }
  for(const value of [null,'0',NaN,Infinity,-.1,1.001]){
    assert.deepEqual(safePosition({...position,comicImageOffset:value},b),position);
  }
  assert.deepEqual(safePosition({...position,comicLayout:'strip'},b),{...position,comicLayout:'strip'});
  assert.deepEqual(safePosition({...position,comicLayout:'invalid'},b),position);
  assert.deepEqual(safePosition({...position,comicLayout:'strip'},{chapters:b.chapters}),position);
  assert.equal(safePosition({chapter:2,paragraph:0},b),null);
});
test('legacy JSON backup never writes empty or invalid image-based book entries',()=>{
  const b=comicBook('book-f76c53a5-b1ab-4f4b-a8bc-83c1d8a71e25',{title:'Comic',format:'CBZ',pages:[{name:'page.png',width:3,height:4}]},'eng');
  const portable=serializeBackup([b],{positions:{[b.id]:{chapter:0,paragraph:0,fraction:0}},bookmarks:{},lastBook:b.id,prefs:{}},[]);
  const demo={id:'folio-night-ferry',chapters:[]};
  const restored=parseBackup(portable,demo);
  assert.deepEqual(restored.books,[]);
  assert.equal(restored.lastBook,demo.id);
});
const baseComic=()=>comicBook('book-id',{title:'Pages',format:'PDF · комикс',pages:[{},{},{}]},'jpn_vert');
const result=(ocrLanguage,text)=>({ocrLanguage,paragraphs:[{text}],status:'ready'});
test('language correction is page-local and legacy books still use their import setting',()=>{
  const book=baseComic();
  assert.equal(comicPageModel(book,0),'jpn_vert');assert.equal(book.language,'ja');
  book.chapters[1]=comicOCRChapter(book.chapters[1],result('eng','Hello'));
  assert.equal(book.chapters[1].text,undefined);
  assert.deepEqual(book.chapters[1].paragraphs,[{text:'Hello',translation:null}]);
  assert.equal(book.ocrLanguage,'jpn_vert');
  assert.equal(comicPageModel(book,0),'jpn_vert');assert.equal(comicModelTag(comicPageModel(book,0)),'ja');
  assert.equal(comicPageModel(book,1),'eng');assert.equal(comicModelTag(comicPageModel(book,1)),'en');
  assert.equal(comicPageModel(book,2),'jpn_vert');assert.equal(comicModelTag(comicPageModel(book,2)),'ja');
  assert.throws(()=>comicOCRChapter(book.chapters[1],result('eng','')));
  assert.throws(()=>comicOCRChapter(book.chapters[1],result('__proto__','inapplicable')));
  assert.equal(book.chapters[1].paragraphs[0].text,'Hello');
});

// Test the transaction seam: reads occur on the latest committed snapshot;
// writes take effect on transaction completion only.
function idbStub(book){
  const rows=new Map([[book.id,book]]);
  let tail=Promise.resolve();
  return {rows,db:{transaction(){
    let aborted=false, read=null;const writes=[];
    const tx={abort(){aborted=true},objectStore:()=>({transaction:tx,
      get(key){const req={};read=()=>{req.result=structuredClone(rows.get(key));req.onsuccess?.()};return req},
      put(data){writes.push(data)},
    })};
    tail=tail.then(()=>{
      read?.();if(aborted){tx.onabort?.();return}
      for(const data of writes)rows.set(Array.isArray(data.id)?data.id.join('|'):data.id,structuredClone(data));
      tx.oncomplete?.();
    });
    return tx;
  }}};
}
test('separate page writes merge against latest stored book and invalid writes preserve old OCR',async()=>{
  const book=baseComic(),{db,rows}=idbStub(book);
  const page=(index,ocr)=>({index,ocr,blob:new Blob(['original']),id:['wrong key']});
  await Promise.all([
    updateComicPage(db,book.id,page(0,result('rus','Первый'))),
    updateComicPage(db,book.id,page(1,result('kor','물'))),
  ]);
  const latest=rows.get(book.id);
  assert.equal(latest.ocrLanguage,'jpn_vert');
  assert.equal(latest.chapters[0].paragraphs[0].text,'Первый');
  assert.equal(latest.chapters[1].paragraphs[0].text,'물');
  assert.equal(latest.chapters[2].paragraphs[0].text,'');
  assert.equal(await rows.get('comic-page|book-id|1').blob.text(),'original');
  await assert.rejects(updateComicPage(db,book.id,page(0,result('eng',''))));
  assert.equal(rows.get(book.id).chapters[0].ocrLanguage,'rus');
  rows.delete(book.id);
  await assert.rejects(updateComicPage(db,book.id,page(0,result('eng','Other'))));
  assert.equal(rows.has(book.id),false);
});
