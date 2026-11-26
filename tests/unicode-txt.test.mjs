import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBook} from '../dist/importers.js';

const file=bytes=>new File([bytes],'unicode.txt');
const utf8=text=>new TextEncoder().encode(text);
const utf16=(text,littleEndian)=>{
  const bytes=new Uint8Array((text.length+1)*2),view=new DataView(bytes.buffer);
  view.setUint16(0,0xfeff,littleEndian);
  for(let i=0;i<text.length;i++)view.setUint16((i+1)*2,text.charCodeAt(i),littleEndian);
  return bytes;
};
test('TXT recognizes explicit UTF-16LE/BE BOM and retains paragraphs and Unicode',async()=>{
  const text='Таң атты. 🌅\r\n\r\nКітап оқимыз.';
  for(const bytes of [utf16(text,true),utf16(text,false),utf8(text),utf8('\ufeff'+text)]){
    const book=await parseBook(file(bytes));
    assert.equal(book.format,'TXT');
    assert.deepEqual(book.chapters[0].paragraphs,['Таң атты. 🌅','Кітап оқимыз.']);
  }
});
test('TXT rejects malformed UTF-8/UTF-16, unmarked binary and empty input',async()=>{
  for(const bytes of [[0xff,0xfe,0xd8],[0xfe,0xff,0xd8,0],[0xff,0x03,0x06], [0xff,0xfe,0,0,0x42,0,0,0]]){
    await assert.rejects(parseBook(file(Uint8Array.from(bytes))),/Не удалось прочитать текст|не обычный текст/);
  }
  await assert.rejects(parseBook(file(utf16('Plain text',true).slice(2))),/не обычный текст/);
  await assert.rejects(parseBook(file(utf16('',false))),/пуст/);
});
