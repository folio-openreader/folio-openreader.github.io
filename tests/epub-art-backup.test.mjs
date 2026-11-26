import assert from 'node:assert/strict';
import test from 'node:test';
import {collectEpubBackup,restoreEpubBackup} from '../dist/epub-art-backup.js';
import {DEMO_ID,serializeBackup,parseBackup} from '../dist/release-core.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zz4cAAAAASUVORK5CYII=','base64');
const book={id:'book-00000000-0000-0000-0000-000000000003',title:'Original text fixture',format:'EPUB',
  chapters:[{title:'Chapter',paragraphs:[{text:'A sample for reader regression.'}],illustrations:[
    {asset:7,before:0,alt:'Illustration',width:1,height:1},{asset:7,before:1,alt:'The same art',width:1,height:1},
  ]}]};
const demo={id:DEMO_ID,chapters:[]},state={positions:{},bookmarks:{},lastBook:book.id,prefs:{}};
const prepare=()=>collectEpubBackup([book],(id,i)=>{
  assert.equal(id,book.id);assert.equal(i,7);
  return new Blob([png],{type:'image/png'});
});
test('local EPUB backup retains image data only on opt-in, deduplicates sidecars and preserves the text layout',async()=>{
  const plain=serializeBackup([book],state,[]);
  assert.equal(Object.hasOwn(parseBackup(plain,demo),'epubArt'),false);
  const art=await prepare();
  assert.deepEqual(art[0].assets,[{type:'image/png',data:png.toString('base64')}]);
  const parsed=parseBackup(serializeBackup([book],state,[],null,art),demo);
  const restored=restoreEpubBackup(parsed.epubArt,parsed.books);
  assert.equal(restored.books[0].chapters[0].paragraphs[0].text,book.chapters[0].paragraphs[0].text);
  assert.deepEqual(restored.books[0].chapters[0].illustrations,book.chapters[0].illustrations.map(ref=>({...ref,asset:0})));
  assert.deepEqual(Buffer.from(await restored.assetsByBook.get(book.id)[0].arrayBuffer()),png);
  assert.equal(parsed.books[0].chapters[0].illustrations,undefined); // Parsing does not mutate the text books.
});
test('local EPUB backup refuses corrupt, unbounded or mismatched assets before returning any restore data',async()=>{
  const good=await prepare(),alter=mutate=>{const copy=structuredClone(good);mutate(copy[0]);return copy;};
  const huge=Buffer.from(png);huge.writeUInt32BE(3000,16);huge.writeUInt32BE(3000,20);
  for(const item of [
    null,[good[0],good[0]],alter(row=>{row.id='foreign-book'}),
    alter(row=>{row.assets[0].type='image/svg+xml'}),alter(row=>{row.assets[0].type='image/jpeg'}),
    alter(row=>{row.assets[0].data='a==!'}),alter(row=>{row.assets[0].data='x'.repeat(4*1024*1024+4)}),
    alter(row=>{row.assets[0].data=huge.toString('base64')}),
    alter(row=>{row.chapters[0].slots[0].asset=1}),alter(row=>{row.chapters[0].slots[1].before=2}),
  ])assert.throws(()=>restoreEpubBackup(item,[book]),/Иллюстрации/);
  assert.equal(await collectEpubBackup([book],()=>{assert.fail('Cancelled work should not read image bytes');},{active:()=>false}),null);
  await assert.rejects(collectEpubBackup([book],()=>null),/Иллюстрации/);
});


test('illustrated backups have an aggregate pixel ceiling, including repeated payloads',()=>{
  // Adjust only the header to test pre-decode budget accounting without
  // allocating a large raster in the test runner.
  const sample=Buffer.from(png);sample.writeUInt32BE(1000,16);sample.writeUInt32BE(8000,20);
  const data=sample.toString('base64');
  const assets=Array.from({length:11},()=>({type:'image/png',data}));
  const chapters=[{index:0,slots:assets.map((_,asset)=>({asset,before:0,alt:''}))}];
  assert.throws(()=>restoreEpubBackup([{id:book.id,assets,chapters}],[book]),/лимит/);
});
