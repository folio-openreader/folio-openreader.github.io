import test from 'node:test';
import assert from 'node:assert/strict';
import {imageDimensions} from '../dist/ocr-engine.js';
import {comicImageHeader} from '../dist/comic-import.js';
import {serializeBackup,parseBackup} from '../dist/release-core.js';

// Metadata-only fixture: only the header scanner receives these bytes.
function losslessHeader(w,h){
  const b=Buffer.alloc(26);
  b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WEBPVP8L',8);
  b.writeUInt32LE(5,16);b[20]=0x2f;b.writeUInt32LE(((h-1)<<14)|(w-1),21);
  return b;
}
test('scan and comic share bounded WebP header validation',()=>{
  const sample=losslessHeader(389,251);
  assert.deepEqual(imageDimensions(sample),{w:389,h:251,format:'WEBP'});
  assert.deepEqual(comicImageHeader(sample,'page.webp'),{w:389,h:251,format:'WEBP',type:'image/webp'});
  assert.throws(()=>imageDimensions(losslessHeader(8000,8000)),/32 мегапикселей/);
  assert.throws(()=>imageDimensions(sample.subarray(0,25)),/WebP/);
  assert.throws(()=>comicImageHeader(sample,'page.png'),/Расширение страницы/);
});
test('local backup preserves text and OCR metadata of a WebP scan',()=>{
  const book={id:'book-a45c1397-b71f-4cf8-aaff-55660c574919',title:'Scan',format:'WEBP',language:'en',
    chapters:[{title:'Страница 1',paragraphs:[{text:'Follow the river.'}]}],
    ocr:{pages:[1],uncertain:[],confidence:[{page:1,value:99}],languages:['eng']}};
  const copy=serializeBackup([book],{positions:{},bookmarks:{},lastBook:book.id,prefs:{}},[]);
  const restored=parseBackup(copy,{id:'demo',chapters:[]}).books[0];
  assert.equal(restored.format,'WEBP');
  assert.equal(restored.chapters[0].paragraphs[0].text,'Follow the river.');
  assert.deepEqual(restored.ocr.pages,[1]);
});
