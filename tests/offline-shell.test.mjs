import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {makeOfflineWorker,workerName} from '../tools/update-offline-package.mjs';
import {startupModules} from '../tools/update-startup-hints.mjs';

test('verified offline package is reproducible, bounded, and covers the reader but not private data',async()=>{
  const root=new URL('../dist/',import.meta.url);
  const worker=await readFile(new URL(workerName,root),'utf8');
  assert.equal(worker,await makeOfflineWorker(root));
  const match=/const PACKAGE=(\{[\s\S]*?\});\n/.exec(worker);
  assert.ok(match);
  const {version,assets}=JSON.parse(match[1]);
  assert.match(version,/^[a-f0-9]{24}$/);
  const files=new Set(assets.map(x=>x.path));assert.equal(files.size,assets.length);
  const html=await readFile(new URL('app.html',root),'utf8');
  for(const path of await startupModules(html,p=>readFile(new URL(p,root),'utf8')))assert.ok(files.has(path),path);
  for(const [,path] of html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g))assert.ok(files.has(path),path);
  for(const path of ['app.html','boot.js','folio.webmanifest','epub-illustrations.js','comic-reader.js','comic-strip.js'])assert.ok(files.has(path),path);
  assert.ok([...files].every(path=>!path.includes('/')||path==='packs/catalog.js'||
    /^icons\/folio-(?:192|512|maskable|touch)\.png$/.test(path)||
    /^vendor\/(?:inter|reading-fonts)\/[a-z-]+\.woff2$/i.test(path)));
  assert.ok(!files.has(workerName)&&!files.has('index.html')&&assets.reduce((n,a)=>n+a.bytes,0)<3*1024*1024);
});
