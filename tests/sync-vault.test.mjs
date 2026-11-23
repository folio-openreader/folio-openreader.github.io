import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {wordChange,editionKey,progressChange,bookmarkChange,removeChange,emptySnapshot,editSnapshot,mergeSnapshots,
  newDeviceId,generateRecoveryCode,unlockVault,lockVault,inspectEnvelope,sealVault,openVault,VAULT_LIMITS} from '../dist/sync-vault.js';
import {trackWord,loadLearning,recordEncounter} from '../dist/learning-core.js';

const a='a'.repeat(32), b='b'.repeat(32), sha='1'.repeat(64), ed=editionKey('starter-ferry',sha);
const ed2=editionKey('starter-ferry','2'.repeat(64));
const word=(word='ferry',language='en',wins=1)=>wordChange({word,language,wins,manual:false,lapsed:false,lastActionAt:1000,nextReviewAt:86401000});
const progress=(p,edition=ed)=>progressChange(edition,{chapter:0,paragraph:p,fraction:.5});
const mark=p=>bookmarkChange(ed,{chapter:0,paragraph:p,fraction:0});
const write=(s,d,...cs)=>editSnapshot(s,d,cs);
const fresh=(...cs)=>write(emptySnapshot(),a,...cs);
const err=code=>({code});
const merge=mergeSnapshots;
const find=(s,c)=>s.records.find(r=>r.key===c.key);
const flip=s=>(s[0]==='A'?'B':'A')+s.slice(1);
const max=VAULT_LIMITS;
test('128-bit device IDs; 256-bit keys; wrong format or noncanonical base64 fails closed',async()=>{
  assert.match(newDeviceId(),/^[a-f0-9]{32}$/);assert.notEqual(newDeviceId(),newDeviceId());
  const code=generateRecoveryCode();assert.match(code,/^folio1\.[a-zA-Z0-9_-]{43}$/);assert.notEqual(code,generateRecoveryCode());
  const s=await unlockVault(code);assert.deepEqual(await unlockVault(code),s);assert.match(s.vault,/^[a-f0-9]{32}$/);
  assert.deepEqual(Object.keys(s),['vault']);assert.equal(Object.isFrozen(s),true);
  await assert.rejects(unlockVault('password'),err('VAULT_KEY_FORMAT'));
  await assert.rejects(unlockVault('folio1.'+'A'.repeat(42)+'B'),err('VAULT_KEY_FORMAT'));
  await assert.rejects(sealVault({...s},emptySnapshot()),err('VAULT_LOCKED'));
});
test('independent sessions roundtrip including Cyrillic, accents & tombstones; fresh IV even for unchanged input',async()=>{
  const code=generateRecoveryCode(), s=await unlockVault(code), s2=await unlockVault(code);
  const seed=fresh(word('Ёж','ru'),word('café','fr'),progress(2),mark(3));
  const snap=write(seed,b,removeChange(mark(3).key));
  const sealed=await sealVault(s,snap), again=await sealVault(s,snap);
  assert.notEqual(JSON.parse(sealed).iv,JSON.parse(again).iv);assert.notEqual(sealed,again);
  assert.deepEqual(inspectEnvelope(sealed),{vault:s.vault});
  assert.deepEqual(await openVault(s2,sealed),snap);
  assert.deepEqual(await openVault(s2,await sealVault(s,emptySnapshot())),emptySnapshot());
  lockVault(s);await assert.rejects(sealVault(s,snap),err('VAULT_LOCKED'));
  await assert.rejects(openVault(s,sealed),err('VAULT_LOCKED'));
  assert.deepEqual(await openVault(s2,sealed),snap);
});
test('tamper, substituted public ID/IV, and wrong recovery code do not decrypt; no mutation',async()=>{
  const s=await unlockVault(generateRecoveryCode()), other=await unlockVault(generateRecoveryCode());
  const snap=fresh(word()), old=structuredClone(snap), e=JSON.parse(await sealVault(s,snap));
  for(const o of [{...e,ciphertext:flip(e.ciphertext)},{...e,iv:flip(e.iv)},{...e,vault:other.vault}]){
    await assert.rejects(openVault(s,JSON.stringify(o)),err('VAULT_AUTH'));
  }
  await assert.rejects(openVault(other,JSON.stringify(e)),err('VAULT_AUTH'));
  await assert.rejects(openVault(other,JSON.stringify({...e,vault:other.vault})),err('VAULT_AUTH'));
  assert.deepEqual(snap,old);
});
test('unsupported/extra envelope fields, malformed encodings and oversized blobs rejected pre-decryption',async()=>{
  const s=await unlockVault(generateRecoveryCode()), e=JSON.parse(await sealVault(s,fresh(word())));
  for(const patch of [{format:'folio-backup'},{version:2},{alg:'plain'},{iv:e.iv.slice(1)},{ciphertext:'abc='},{providerToken:'sample'},{vault:'q'.repeat(32)}])
    assert.throws(()=>inspectEnvelope(JSON.stringify({...e,...patch})),err('VAULT_INVALID'));
  assert.throws(()=>inspectEnvelope('{}'),err('VAULT_INVALID'));
  assert.throws(()=>inspectEnvelope(' '.repeat(max.envelope+1)),err('VAULT_LIMIT'));
  assert.throws(()=>inspectEnvelope('猫'.repeat(max.envelope/2)),err('VAULT_LIMIT'));
  assert.throws(()=>inspectEnvelope(JSON.stringify({...e,ciphertext:'A'.repeat(Math.ceil((max.plaintext+17)*4/3))})),err('VAULT_INVALID'));
});
test('per-word/local-position projection strips even very large private fields; raw full objects are not serializable here',async()=>{
  const learning=loadLearning(),r=trackWord(learning,'FERRY','en',1000);
  recordEncounter(r,{bookId:'private-novel',chapter:0,paragraph:2,offset:9});
  const privateProps={bookBytes:'BASE64_PRIVATE',ocr:'OCR_PRIVATE',gloss:'GLOSS_PRIVATE',providerCredential:'TOKEN_PRIVATE',
    prefs:'VOICE_PRIVATE',translationParagraph:'PASSAGE_PRIVATE',title:'TITLE_PRIVATE',seen:r.seen};
  const wc=wordChange({...r,...privateProps}), pc=progressChange(ed,{chapter:0,paragraph:2,...privateProps}),
    bc=bookmarkChange(ed,{chapter:2,paragraph:0,...privateProps});
  const snap=fresh(wc,pc,bc);
  assert.deepEqual(wc,{key:'w:en:ferry',value:[0,false,false,0,1000]});
  const s=await unlockVault(generateRecoveryCode()), sealed=await sealVault(s,snap);
  const decoded=JSON.stringify(await openVault(s,sealed));
  for(const token of ['BASE64_PRIVATE','OCR_PRIVATE','GLOSS_PRIVATE','TOKEN_PRIVATE','VOICE_PRIVATE','PASSAGE_PRIVATE','TITLE_PRIVATE','private-novel','seen','encounter','providerCredential'])
    {assert.ok(!decoded.includes(token));assert.ok(!sealed.includes(token))}
  assert.ok(!sealed.includes('ferry'));
  await assert.rejects(sealVault(s,{...snap,...privateProps}),err('VAULT_INVALID'));
  const copy=structuredClone(snap);copy.records[0].private='prose';
  await assert.rejects(sealVault(s,copy),err('VAULT_INVALID'));
});
test('concurrent devices retain independent words, editions and marks; exact replay is idempotent',()=>{
  const base=fresh(word(),progress(10)), a1=write(base,a,word('цвет','ru'),progress(10,ed2)),
    b1=write(base,b,mark(2),word('orchard'));
  const joined=merge(a1,b1);assert.equal(joined.records.length,6);
  assert.deepEqual(merge(b1,a1),joined);assert.deepEqual(merge(joined,joined),joined);
  assert.deepEqual(merge(merge(a1,base),b1),merge(a1,merge(base,b1)));
  assert.deepEqual(merge(joined,base),joined);
  assert.deepEqual(write(joined,b,progress(10)),joined); // No spurious revisions/sync loops.
});
test('re-reading goes backwards, tombstones survive stale replay, later explicit re-add works',()=>{
  const base=fresh(progress(10),mark(5),word());
  const dropped=write(base,b,progress(1),removeChange(mark(5).key),removeChange(word().key));
  const s=merge(dropped,base);
  assert.deepEqual(find(s,progress(0)).value,[0,1,.5]);assert.equal(find(s,mark(5)).value,null);
  assert.equal(find(s,word()).value,null);assert.equal(find(s,word()).n,2);
  assert.deepEqual(merge(s,base),s);
  const again=write(s,a,word());assert.equal(find(merge(again,s),word()).n,3);
  assert.deepEqual(find(merge(again,s),word()).value,word().value);
});
test('same-generation conflicts converge; delete wins; pathological duplicated device ID converges',()=>{
  const base=fresh(word()), A=write(base,a,word('ferry','en',2)), B=write(base,b,word('ferry','en',3));
  const del=write(base,a,removeChange(word().key)), clash=write(base,a,word('ferry','en',3));
  assert.deepEqual(merge(A,B),B);assert.deepEqual(merge(B,A),B);
  assert.equal(merge(del,B).records[0].value,null);assert.deepEqual(merge(del,B),merge(B,del));
  assert.deepEqual(merge(A,clash),merge(clash,A));assert.deepEqual(merge(A,merge(B,del)),merge(merge(A,B),del));
});
test('malformed word/edition/record blocked atomically; local imports and unsupported editions rejected',()=>{
  const base=fresh(word()), snap=structuredClone(base), badrow=p=>({version:1,records:[{...base.records[0],...p}]});
  const malformed=[badrow({n:2**48}),badrow({d:'__proto__'}),badrow({key:'w:en:two words'}),
    badrow({key:'w:EN:Case'}),badrow({key:'w:xx:__proto__'}),badrow({value:[4,false,false,1,2]}),
    badrow({value:[1,true,true,1,2]}),badrow({value:[1,false,false,2,1]}),
    badrow({key:'p:my-pdf',value:[0,0,0]}),badrow({key:'b:'+ed+':01:0',value:0}),
    badrow({key:'b:'+ed+':0:90000',value:0}),badrow({key:'p:'+ed,value:[NaN,0,0]}),
    badrow({key:'p:'+ed,value:[0,0,1]}),JSON.parse('{"version":1,"records":[],"__proto__":{}}'),
    {version:1,records:[base.records[0],base.records[0]]}];
  for(const bad of malformed)assert.throws(()=>merge(base,bad),err('VAULT_INVALID'));
  assert.throws(()=>editionKey('imported-uuid',sha),err('VAULT_INVALID'));
  assert.throws(()=>editionKey('starter-valid','not-a-digest'),err('VAULT_INVALID'));
  assert.throws(()=>write(base,a,word(),word()),err('VAULT_INVALID'));assert.deepEqual(base,snap);
});
test('record and plaintext byte caps, including a merge of two individually valid sets',()=>{
  assert.throws(()=>merge(emptySnapshot(),{version:1,records:Array(max.records+1)}),err('VAULT_LIMIT'));
  const letters=n=>Array.from({length:4},(_,i)=>String.fromCharCode(97+Math.floor(n/26**i)%26)).join('');
  const chunk=(begin,count)=>({version:1,records:Array.from({length:count},(_,i)=>({
    key:'w:en:'+letters(begin+i)+'ж'.repeat(90),n:1,d:a,value:null}))});
  const l=merge(emptySnapshot(),chunk(0,1300)), r=merge(emptySnapshot(),chunk(1300,1300));
  assert.throws(()=>merge(l,r),err('VAULT_LIMIT'));
});
test('authenticated but unsupported payloads rejected; a legacy backup is never imported',async()=>{
  const s=await unlockVault(generateRecoveryCode());
  await assert.rejects(openVault(s,JSON.stringify({format:'folio-backup',version:1})),err('VAULT_INVALID'));
  // Model valid producer with the same recovery key emitting an unsupported object, not a tag failure.
  const raw=new Uint8Array(32), code='folio1.'+Buffer.from(raw).toString('base64url'), s2=await unlockVault(code);
  const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12)), te=new TextEncoder();
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:te.encode(JSON.stringify(['folio-sync',1,'A256GCM',s2.vault])),tagLength:128},
    key,te.encode('{"version":1,"records":[],"books":["private"]}'));
  const e={format:'folio-sync',version:1,alg:'A256GCM',vault:s2.vault,iv:Buffer.from(iv).toString('base64url'),ciphertext:Buffer.from(ct).toString('base64url')};
  await assert.rejects(openVault(s2,JSON.stringify(e)),err('VAULT_INVALID'));
});
test('no transport, persistence, third-party dependencies or telemetry in vault module',async()=>{
  const source=await readFile(new URL('../dist/sync-vault.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|sessionStorage|localStorage|indexedDB|XMLHttpRequest|sendBeacon|console)\b/);
  assert.deepEqual([...source.matchAll(/from '([^']+)'/g)].map(m=>m[1]),['./learning-core.js']);
});
