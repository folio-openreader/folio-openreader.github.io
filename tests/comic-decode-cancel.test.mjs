import test from 'node:test';
import assert from 'node:assert/strict';
import {parseComicFiles} from '../dist/comic-import.js';
import {recognizeComicPage} from '../dist/comic-ocr.js';
import {parseImage} from '../dist/pdf-import.js';

const file=()=>new File([Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zz4cAAAAASUVORK5CYII=','base64')],
  '1.png',{type:'image/png'});
const modes={
  import:(f,signal)=>parseComicFiles([f],{signal}),
  OCR:(f,signal)=>recognizeComicPage(f,{signal}),
  'book scan':async(f,signal)=>parseImage(await f.arrayBuffer(),f.name,{signal})
};
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad});return {promise,resolve,reject}};
function setGlobal(t,name,value){
  const old=Object.getOwnPropertyDescriptor(globalThis,name);
  Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  t.after(()=>{if(old)Object.defineProperty(globalThis,name,old);else delete globalThis[name]});
}
const nextTurn=()=>new Promise(setImmediate);
// Verify rejection without releasing the blocked browser API; don't wait forever
// on a broken implementation. The test releases the native promise in finally.
async function expectPromptAbort(job){
  const outcome=await Promise.race([job.then(()=> 'returned',e=>e.name),nextTurn().then(()=> 'still decoding')]);
  assert.equal(outcome,'AbortError');
}

for(const [name,run] of Object.entries(modes)){
  test(name+' cancels during a stalled native decode and closes the late bitmap',async t=>{
    const native=deferred(),started=deferred(),controller=new AbortController();let closed=0,fallback=0;
    setGlobal(t,'Image',class{constructor(){fallback++;}});
    setGlobal(t,'createImageBitmap',(_blob,options)=>{
      assert.deepEqual(options,{imageOrientation:'from-image'});started.resolve();return native.promise;
    });
    const job=run(file(),controller.signal);
    await started.promise;controller.abort();
    try{await expectPromptAbort(job);}
    finally{native.resolve({width:1,height:1,close(){closed++}});await job.catch(()=>{});}
    await nextTurn();assert.equal(closed,1);assert.equal(fallback,0,'aborting must not start a fallback decode');
  });
  test(name+' cancels and cleans up a fallback HTML image even if decode never settles',async t=>{
    const started=deferred(),native=deferred(),controller=new AbortController(),revoked=[];let dropped=0;
    const original=URL.revokeObjectURL;
    URL.revokeObjectURL=url=>{revoked.push(url);original.call(URL,url);};
    t.after(()=>{URL.revokeObjectURL=original;});
    setGlobal(t,'createImageBitmap',undefined);
    setGlobal(t,'Image',class{
      decode(){started.resolve(this.src);return native.promise;}
      removeAttribute(name){assert.equal(name,'src');dropped++;}
    });
    const job=run(file(),controller.signal),url=await started.promise;
    controller.abort();
    try {
      await expectPromptAbort(job);
      assert.equal(dropped,1);assert.deepEqual(revoked,[url]);
    } finally {native.reject(new Error('late decoder failure'));await job.catch(()=>{});}
  });
}

test('completed native and fallback decoding still import correctly and release their resources',async t=>{
  let bitmaps=0,dropped=0;
  setGlobal(t,'createImageBitmap',async()=>({width:1,height:1,close(){bitmaps++;}}));
  const first=await parseComicFiles([file()]);assert.equal(first.pages[0].width,1);assert.equal(bitmaps,1);
  globalThis.createImageBitmap=undefined;
  setGlobal(t,'Image',class{
    naturalWidth=1;naturalHeight=1;
    async decode(){}
    removeAttribute(){dropped++;}
  });
  const second=await parseComicFiles([file()]);assert.equal(second.pages[0].width,1);assert.equal(dropped,1);
});

test('a present bitmap decoder can reject a valid raster without blocking comic import',async t=>{
  let attempted=0,decoded=0,released=0;
  setGlobal(t,'createImageBitmap',async()=>{
    attempted++;throw new DOMException('Bitmap decoder rejected a valid image','NotSupportedError');
  });
  setGlobal(t,'Image',class{
    naturalWidth=1;naturalHeight=1;
    async decode(){assert.match(this.src,/^blob:/);decoded++;}
    removeAttribute(name){assert.equal(name,'src');released++;}
  });
  const book=await parseComicFiles([file()]);
  assert.equal(book.pages[0].width,1);
  assert.deepEqual([attempted,decoded,released],[1,1,1]);
});
