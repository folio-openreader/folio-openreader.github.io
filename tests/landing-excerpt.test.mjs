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

test('the social preview uses the real catalogue demo and an optimized 1200×630 asset', async () => {
  for (const [key,attr] of [['og','property'],['twitter','name']]) {
    const image = html.match(new RegExp('<meta '+attr+'="'+key+':image" content="([^"]+)"'))[1];
    const alt = html.match(new RegExp('<meta '+attr+'="'+key+':image:alt" content="([^"]+)"'))[1];
    assert.equal(image,'https://folio-openreader.github.io/landing/share.png?v=secret-garden');
    assert.match(alt,/The Secret Garden.*wintry.*по-зимнему/);
  }
  const source = await readFile(new URL('../tools/landing-share-garden.svg',import.meta.url),'utf8');
  const drawing = source.match(/<g id="share-excerpt"[^>]*>([^]*?)<\/g>/)[1];
  const rendered = [...drawing.matchAll(/<text[^>]*>([^]*?)<\/text>/g)].slice(1).map(m=>textOnly(m[1])).join(' ');
  assert.ok(book.chapters[3].paragraphs.some(p=>p.text.endsWith(rendered)));
  const png = await readFile(new URL('landing/share.png',dist));
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.deepEqual([png.readUInt32BE(16),png.readUInt32BE(20)],[1200,630]);
  assert.ok(png.length < 128 * 1024);
});
