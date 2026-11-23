import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const dist = new URL('../dist/',import.meta.url);
const read = path => readFile(new URL(path,dist),'utf8');
const html = await read('index.html');
const script = await read('landing/sample.js');
const book = JSON.parse(await read('starter/books/starter-secret-garden.json'));
const textOnly = markup => markup.replace(/<[^>]+>/g,'');
const excerpt = html.match(/<p class="excerpt" lang="en">([^]*?)<\/p>/)[1];
const labels = [...excerpt.matchAll(/<span data-gloss="([^"]+)"( data-featured)?>([^<]+)<\/span>/g)];

test('the two illustrated pages and demo quote the same exact catalogue paragraph', () => {
  const text = textOnly(excerpt);
  assert.ok(book.chapters[3].paragraphs.some(p => p.text === text));
  const pages = ['left','right'].map(side => {
    const mark = html.indexOf('class="book-'+side+' book-paper"');
    return textOnly(html.slice(mark).match(/<p>([^]*?)<\/p>/)[1]);
  });
  assert.equal(pages.join(' '),text);
  assert.match(html, /class="text-link demo-book-link" data-reader href="\.\/app\.html#read\/starter-secret-garden"/);
  assert.deepEqual(labels.map(m=>m[3]),text.match(/\b[A-Za-z]+\b/g));
  assert.equal(labels.filter(m=>m[3]==='and').length,3);
  assert.equal(labels.filter(m=>m[2]).length,1);
});

test('promoted word buttons preserve the passage and update exactly one selection', () => {
  const makeElement = () => ({
    attrs: new Map(), callbacks: new Map(),
    setAttribute(key,value){this.attrs.set(key,value)},
    addEventListener(key,callback){this.callbacks.set(key,callback)}
  });
  const created = [];
  const nodes = labels.map(([_,gloss,featured,text])=>({
    textContent:text,dataset:{gloss},hasAttribute:key=>key==='data-featured'&&Boolean(featured),
    replaceWith:b=>created.push(b)
  }));
  const result = {word:{},gloss:{},announcement:{}};
  const bySelector = {
    '.excerpt':{querySelectorAll:()=>nodes}, '#example-word':result.word,
    '#example-gloss':result.gloss, '#demo-announcement':result.announcement
  };
  runInNewContext(script,{
    document:{querySelector:s=>bySelector[s],createElement:makeElement},
    window:{matchMedia:()=>({matches:true})}
  });
  assert.equal(created.length,19);
  created.forEach((b,i)=>{
    const [,gloss,,word] = labels[i];
    assert.equal(b.type,'button');
    assert.equal(b.attrs.get('aria-controls'),'demo-note');
    b.callbacks.get('click')();
    assert.equal(result.word.textContent,word);
    assert.equal(result.gloss.textContent,gloss);
    assert.equal(result.announcement.textContent,word+': '+gloss+'.');
    assert.deepEqual(created.filter(b=>b.attrs.get('aria-pressed')==='true'),[b]);
  });
});

test('book showcase retains an intentional non-animated state', () => {
  assert.match(html, /class="book-replay"[^>]+hidden>/);
  assert.match(script, /if \(preference\.matches\) \{\s+stage\.classList\.remove\('book-ready', 'book-playing'\);/);
  assert.match(script, /new IntersectionObserver/);
});
