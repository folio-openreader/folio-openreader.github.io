import test from 'node:test';
import assert from 'node:assert/strict';
import {pairBooks} from '../dist/importers.js';

const makeBook=(format,pageCount,chapters)=>({
  title:'Fixture', language:'en', warnings:[], format,pageCount,
  chapters:chapters.map(([page,...paragraphs])=>({title:'Страница '+page,paragraphs}))
});
const texts=book=>book.chapters.map(ch=>ch.paragraphs.map(p=>p.translation));

test('PDF matching uses physical page numbers and drops only unreadable or unequal pages',()=>{
  const left=makeBook('PDF',5,[[1,'one'],[2,'two'],[3,'three'],[5,'five']]);
  const right=makeBook('PDF',5,[[1,'un'],[3,'trois','extra'],[4,'quatre'],[5,'cinq']]);
  const book=pairBooks(left,right);
  assert.deepEqual(texts(book),[['un'],[null],[null],['cinq']]);
  assert.equal(book.alignmentReport.pdfPagesMatch,true);
  assert.equal(book.alignmentReport.paragraphCountsMatch,false);
  assert.equal(book.alignmentReport.matchedCount,2);
  assert.equal(book.alignmentReport.unmatchedTranslation,3);
  assert.equal(book.alignment,'positional-unverified');
});

test('different physical PDF page counts do not silently pair even when readable counts equal',()=>{
  const left=makeBook('PDF',4,[[1,'one'],[2,'two']]);
  for(const pageCount of [undefined,2,5]){
    const right=makeBook('PDF',pageCount,[[1,'un'],[2,'deux']]);
    const book=pairBooks(left,right);
    assert.deepEqual(texts(book),[[null],[null]]);
    assert.equal(book.alignmentReport.chapterCountsMatch,true);
    assert.equal(book.alignmentReport.pdfPagesMatch,false);
  }
});

test('EPUB with translated chapter titles still matches by chapter order',()=>{
  const left=makeBook('EPUB',undefined,[[1,'one'],[2,'two']]);
  const right=makeBook('EPUB',undefined,[[12,'un'],[14,'deux']]);
  assert.deepEqual(texts(pairBooks(left,right)),[['un'],['deux']]);
  assert.deepEqual(texts(pairBooks(left,{...right,chapters:right.chapters.slice(1)})),[[null],[null]]);
});
