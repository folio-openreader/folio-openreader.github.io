// Deliberate release operation. Inspect the resulting diff before accepting it.
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {join,relative,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {writeOfflineWorker} from './update-offline-package.mjs';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
async function files(dir){let result=[];for(const entry of await readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);if(entry.name.startsWith('.')||entry.isSymbolicLink())throw Error('No hidden files or links in site'); if(entry.isDirectory())result.push(...await files(p));else if(entry.isFile())result.push(p);else throw Error('Only regular files allowed');}return result;}
await writeOfflineWorker();
let output='';for(const p of (await files(root)).sort()){const rel=relative(root,p).split(sep).join('/');if(!/^[a-z0-9_.,+@/ -]+$/i.test(rel))throw Error('Unexpected path '+rel);output+=createHash('sha256').update(await readFile(p)).digest('hex')+'  '+rel+'\n';}
await writeFile(new URL('../ASSET-SHA256.txt',import.meta.url),output);
