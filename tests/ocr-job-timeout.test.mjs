import test from 'node:test';
import assert from 'node:assert/strict';
import {ocrSession} from '../dist/ocr-engine.js';

test('OCR setup and recognition deadlines keep their exact error and release the worker',async t=>{
  let active=0, stalled='load';
  const Original=globalThis.Worker, originalSetTimeout=globalThis.setTimeout;
  t.after(()=>{if(Original)globalThis.Worker=Original;else delete globalThis.Worker;globalThis.setTimeout=originalSetTimeout});
  class FakeWorker{
    constructor(){active++;}
    postMessage({jobId,action}){
      if(action!==stalled)queueMicrotask(()=>this.onmessage?.({data:{jobId,status:'resolve',data:{}}}));
    }
    terminate(){active--;}
  }
  globalThis.Worker=FakeWorker;
  globalThis.setTimeout=(fn,ms,...args)=>originalSetTimeout(fn,ms===90_000?0:ms,...args);
  const canvas={width:1,height:1,toBlob(cb){cb(new Blob([0]))}};
  for(const name of ['load','initialize','recognize']){
    stalled=name;
    const session=ocrSession(['eng'],new AbortController().signal,undefined,{preserveLoadDeadline:true});
    await assert.rejects(session.read(canvas,1,1),{code:'OCR_JOB_TIMEOUT',message:/вовремя/});
    assert.equal(active,0);
    session.close();
  }
  stalled='load';
  const standard=ocrSession(['eng'],new AbortController().signal);
  await assert.rejects(standard.read(canvas,1,1),{code:'OCR_MODEL_UNAVAILABLE'});
  assert.equal(active,0);
});
