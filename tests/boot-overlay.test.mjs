import test from 'node:test';import assert from 'node:assert/strict';import {runInNewContext} from 'node:vm';import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../dist/boot.js',import.meta.url),'utf8'),css=readFileSync(new URL('../dist/boot.css',import.meta.url),'utf8'),app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
function fixture(){const button={hidden:true},copy={},state={removed:false,reloaded:false};let tick,ready;
runInNewContext(code,{document:{getElementById:()=>({querySelector:k=>k==='button'?button:copy,remove(){state.removed=true}})},setTimeout(f,n){assert.equal(n,8000);tick=f;return 13},clearTimeout(n){assert.equal(n,13);tick=null},window:{addEventListener(k,f){assert.equal(k,'folio:ready');ready=f}},location:{reload(){state.reloaded=true}}});
return{state,button,copy,tick:()=>tick?.(),ready}}
test('fast readiness skips any mandatory animation wait',()=>{const f=fixture();f.ready();assert.ok(f.state.removed);f.tick();assert.ok(f.button.hidden)});
test('watchdog offers retry without treating a slow start as successful',()=>{const f=fixture();f.tick();assert.ok(!f.state.removed&&!f.button.hidden);f.button.onclick();assert.ok(f.state.reloaded);f.ready();assert.ok(f.state.removed)});
test('reduced motion is static and initial restoration and routing precede readiness',()=>{assert.match(css,/@media\(prefers-reduced-motion:reduce\).*?animation:none/);assert.ok(app.lastIndexOf('await openDB()')<app.lastIndexOf('readHash();'));assert.ok(app.lastIndexOf('readHash();')<app.lastIndexOf("new Event('folio:ready')"))});
