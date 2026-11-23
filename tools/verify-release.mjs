import {readFile, readdir,lstat, access} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseStarterCatalog,parseStarterBook} from '../dist/starter-core.js';
import {parseResearchCatalog,parseResearchBook} from '../dist/research-core.js';
const dir=fileURLToPath(new URL('../dist/',import.meta.url)), sha=b=>createHash('sha256').update(b).digest('hex'),read=p=>readFile(join(dir,p)),str=async(p)=>(await read(p)).toString();
const origin='https://folio-openreader.github.io/', repo='https://github.com/folio-openreader/folio-openreader.github.io';
const index=await str('index.html'),reader=await str('app.html'),manifest=JSON.parse(await str('folio.webmanifest'));
assert.equal((index.match(/rel="canonical"/g)||[]).length,1);assert.ok(index.includes('rel="canonical" href="'+origin+'"'));for(const s of [repo,origin+'landing/share.png','application/ld+json','./LICENSE.txt','./credits.html'])assert.ok(index.includes(s),s);assert.ok(!/noindex/i.test(index));assert.match(reader,/noindex, follow/);assert.equal(manifest.start_url,'./app.html');assert.equal(manifest.scope,'./');assert.equal((await str('sitemap.xml')).match(/<loc>(.*?)<\/loc>/)[1],origin);assert.ok((await str('robots.txt')).includes(origin+'sitemap.xml'));
async function walk(folder){const acc=[];for(const d of await readdir(folder,{withFileTypes:true})){assert.ok(!d.isSymbolicLink()&&!d.name.startsWith('.'),d.name);let p=join(folder,d.name);if(d.isDirectory())acc.push(...await walk(p));else{assert.ok(d.isFile());acc.push(relative(dir,p).split(sep).join('/'));}}return acc;}
const inventory=new Map();for(const line of (await readFile(new URL('../ASSET-SHA256.txt',import.meta.url),'utf8')).trimEnd().split('\n')){const m=line.match(/^([a-f0-9]{64})  (.+)$/);assert.ok(m,line);assert.ok(!inventory.has(m[2]));inventory.set(m[2],m[1]);}
const files=await walk(dir);assert.deepEqual(files.sort(),[...inventory.keys()].sort());for(const f of files){assert.equal(sha(await read(f)),inventory.get(f),f);}
for(const html of [index,reader,await str('credits.html')])for(const m of html.matchAll(/\b(?:src|href)="([^"]+)"/g)){const u=m[1];if(/^(?:#|https?:|data:|mailto:)/i.test(u))continue;const path=u.split('#')[0].split('?')[0];if(path)await access(resolve(dir,path));}
for(const x of manifest.icons)await access(resolve(dir,x.src));
const books=parseStarterCatalog(JSON.parse(await str('starter/manifest.json')));for(const b of books){const bytes=await read(b.asset);assert.equal(bytes.length,b.byteLen);assert.equal(sha(bytes),b.sha256);parseStarterBook(JSON.parse(bytes),b);}
for(const m of index.matchAll(/app\.html#read\/(starter-[a-z-]+)/g))assert.ok(books.some(b=>b.id===m[1]),m[1]);
assert.equal(files.filter(f=>f.startsWith('starter/books/')).length,books.length);
const papers=parseResearchCatalog(JSON.parse(await str('research/manifest.json')));assert.equal(papers.length,5);for(const p of papers){const b=await read(p.asset);assert.equal(sha(b),p.sha256);assert.equal(b.length,p.byteLen);parseResearchBook(JSON.parse(b),p);}
assert.ok((await str('data.js')).includes('The last ferry'));assert.ok((await str('app.js')).includes("title:'The Night Ferry'"));assert.equal(await str('LICENSE.txt'),await readFile(new URL('../LICENSE',import.meta.url),'utf8'));
console.log('Verified',files.length,'static assets,',books.length,'book editions,',papers.length,'science papers, public routes, credits, PWA manifest and SHA-256 inventory.');
