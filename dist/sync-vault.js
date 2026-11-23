// Optional compact sync format. No storage, network, permissions or side effects on import.
import {wordKey} from './learning-core.js';

export const VAULT_LIMITS=Object.freeze({plaintext:512*1024,envelope:768*1024,records:12000});
const MAX_N=2**48-1, MAX_DATE=8.64e15, DATE_STEP=14*86400000;
const enc=new TextEncoder(), dec=new TextDecoder('utf-8',{fatal:true});
const sessions=new WeakMap();
const format='folio-sync',version=1,alg='A256GCM';
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const bad=()=>fail('VAULT_INVALID'), large=()=>fail('VAULT_LIMIT');
const uint=(x,max)=>Number.isSafeInteger(x)&&x>=0&&x<=max;
const exact=(x,fields)=>x&&typeof x==='object'&&!Array.isArray(x)&&
  (Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null)&&
  Object.keys(x).length===fields.length&&fields.every(k=>Object.hasOwn(x,k));
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const id=x=>typeof x==='string'&&x.length===32&&/^[a-f0-9]{32}$/.test(x);
function wc(){const c=globalThis.crypto;if(!c?.subtle||!c.getRandomValues)fail('VAULT_CRYPTO_UNAVAILABLE');return c}
function b64(bytes){
  let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
}
// Canonical unpadded base64url; reject nonzero unused bits and alternative spellings.
function un64(s,min,max,err){
  if(typeof s!=='string'||s.length<Math.ceil(min*4/3)||s.length>Math.ceil(max*4/3)||
    s.length%4===1||!/^[a-zA-Z0-9_-]+$/.test(s))fail(err);
  const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', last=abc.indexOf(s.at(-1));
  if(s.length%4===2&&(last&15)||s.length%4===3&&(last&3))fail(err);
  const raw=atob(s.replace(/-/g,'+').replace(/_/g,'/'));
  if(raw.length<min||raw.length>max)fail(err);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export function newDeviceId(){return hex(wc().getRandomValues(new Uint8Array(16)))}
export function generateRecoveryCode(){
  const raw=wc().getRandomValues(new Uint8Array(32));
  try{return 'folio1.'+b64(raw)}finally{raw.fill(0)}
}
export async function unlockVault(code){
  if(typeof code!=='string'||code.length!==50||!code.startsWith('folio1.'))fail('VAULT_KEY_FORMAT');
  const raw=un64(code.slice(7),32,32,'VAULT_KEY_FORMAT');
  const prefix=enc.encode('Folio compact sync key ID v1\0'), input=new Uint8Array(prefix.length+32);
  input.set(prefix);input.set(raw,prefix.length);
  try{
    const c=wc(),hash=await c.subtle.digest('SHA-256',input);
    const vault=hex(new Uint8Array(hash,0,16));
    const key=await c.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
    const session=Object.freeze({vault});sessions.set(session,key);return session;
  }finally{raw.fill(0);input.fill(0)}
}
export function lockVault(session){sessions.delete(session)}
function sessionKey(session){const k=sessions.get(session);if(!k)fail('VAULT_LOCKED');return k}

const edRE=/^starter-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function editionKey(catalogId,sha256){
  if(typeof catalogId!=='string'||catalogId.length>100||!edRE.test(catalogId)||
     typeof sha256!=='string'||sha256.length!==64||!/^[0-9a-f]{64}$/.test(sha256))bad();
  return catalogId+'@'+sha256;
}
function checkEdition(ed){
  if(typeof ed!=='string'||ed.length>165)bad();
  const p=ed.split('@');if(p.length!==2||editionKey(...p)!==ed)bad();
}
const coord=n=>uint(n,65535), fraction=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=.99;
function spec(key){
  if(typeof key!=='string'||key.length>190)bad();
  const [type,...p]=key.split(':');
  if(type==='w'&&p.length===2&&p[0].length<=40&&wordKey(p[1],p[0])===p.join(':'))return type;
  if(type==='p'&&p.length===1){checkEdition(p[0]);return type}
  if(type==='b'&&p.length===3&&p.slice(1).every(s=>/^(?:0|[1-9][0-9]{0,4})$/.test(s)&&coord(Number(s)))){
    checkEdition(p[0]);return type;
  }
  bad();
}
function change(key,v){
  const t=spec(key);
  if(v===null)return {key,value:null};
  if(t==='w'&&Array.isArray(v)&&v.length===5){
    const [wins,manual,lapsed,last,next]=v;
    if(uint(wins,3)&&typeof manual==='boolean'&&typeof lapsed==='boolean'&&
       !(lapsed&&(wins!==0||manual))&&uint(last,MAX_DATE)&&uint(next,MAX_DATE)&&next>=last&&
       (!last||next<=last+DATE_STEP))return {key,value:[wins,manual,lapsed,last,next]};
  }
  if(t==='p'&&Array.isArray(v)&&v.length===3&&coord(v[0])&&coord(v[1])&&fraction(v[2]))return {key,value:[v[0],v[1],v[2]]};
  if(t==='b'&&fraction(v))return {key,value:v};
  bad();
}
// The only app-facing projections. Deliberately pick fields instead of copying records.
export function wordChange(r){
  if(!r||typeof r.language!=='string'||!r.language.length||r.language.length>40)bad();
  return change('w:'+wordKey(r.word,r.language),[r.wins,r.manual,r.lapsed,r.lastActionAt,r.nextReviewAt]);
}
export function progressChange(edition,pos){
  checkEdition(edition);return change('p:'+edition,[pos?.chapter,pos?.paragraph,pos?.fraction??0]);
}
export function bookmarkChange(edition,pos){
  checkEdition(edition);if(!coord(pos?.chapter)||!coord(pos?.paragraph))bad();
  return change('b:'+edition+':'+pos.chapter+':'+pos.paragraph,pos.fraction??0);
}
export function removeChange(key){return change(key,null)}

export function emptySnapshot(){return {version,records:[]}}
const cmp=(a,b)=>a<b?-1:a>b?1:0;
function validated(raw){
  if(!exact(raw,['version','records'])||raw.version!==version||!Array.isArray(raw.records))bad();
  if(raw.records.length>VAULT_LIMITS.records)large();
  const records=[],seen=new Set();let size=enc.encode('{"version":1,"records":[]}').length;
  for(const r of raw.records){
    if(!exact(r,['key','n','d','value'])||!uint(r.n,MAX_N)||r.n<1||!id(r.d)||seen.has(r.key))bad();
    const {key,value}=change(r.key,r.value), row={key,n:r.n,d:r.d,value};
    size+=enc.encode(JSON.stringify(row)).length+(records.length?1:0);if(size>VAULT_LIMITS.plaintext)large();
    seen.add(key);records.push(row);
  }
  records.sort((a,b)=>cmp(a.key,b.key));return {version,records};
}
// Total order independent of input order/clock. At simultaneous generation a removal
// beats an update; two updates break ties by device, then canonical value if IDs collide.
function rank(a,b){return cmp(a.n,b.n)||cmp(a.value===null,b.value===null)||cmp(a.d,b.d)||
  cmp(JSON.stringify(a.value),JSON.stringify(b.value))}
export function mergeSnapshots(left,right){
  const m=new Map(validated(left).records.map(r=>[r.key,r]));
  for(const r of validated(right).records){const old=m.get(r.key);if(!old||rank(r,old)>0)m.set(r.key,r)}
  return validated({version,records:[...m.values()]});
}
export function editSnapshot(snapshot,device,changes){
  if(!id(device)||!Array.isArray(changes))bad();
  if(changes.length>VAULT_LIMITS.records)large();
  const m=new Map(validated(snapshot).records.map(r=>[r.key,r])), touched=new Set();
  for(const c of changes){
    if(!exact(c,['key','value'])||touched.has(c.key))bad();
    const {key,value}=change(c.key,c.value);touched.add(key);
    const prev=m.get(key);
    if(prev&&JSON.stringify(prev.value)===JSON.stringify(value))continue;
    if(prev?.n===MAX_N)fail('VAULT_CLOCK_LIMIT');
    m.set(key,{key,n:(prev?.n||0)+1,d:device,value});
  }
  return validated({version,records:[...m.values()]});
}
function envelope(text){
  if(typeof text!=='string')bad();
  if(text.length>VAULT_LIMITS.envelope||enc.encode(text).length>VAULT_LIMITS.envelope)large();
  let e;try{e=JSON.parse(text)}catch{bad()}
  if(!exact(e,['format','version','alg','vault','iv','ciphertext'])||
     e.format!==format||e.version!==version||e.alg!==alg||!id(e.vault))bad();
  return {vault:e.vault,iv:un64(e.iv,12,12,'VAULT_INVALID'),
    bytes:un64(e.ciphertext,17,VAULT_LIMITS.plaintext+16,'VAULT_INVALID')};
}
// Structural check only: must always openVault before trusting content or merging.
export function inspectEnvelope(text){return {vault:envelope(text).vault}}
function params(vault,iv){return {name:'AES-GCM',iv,tagLength:128,
  additionalData:enc.encode(JSON.stringify([format,version,alg,vault]))}}
export async function sealVault(session,snapshot){
  const key=sessionKey(session),plain=enc.encode(JSON.stringify(validated(snapshot))),c=wc();
  try{
    const iv=c.getRandomValues(new Uint8Array(12));
    const ct=await c.subtle.encrypt(params(session.vault,iv),key,plain);
    sessionKey(session);
    return JSON.stringify({format,version,alg,vault:session.vault,iv:b64(iv),ciphertext:b64(new Uint8Array(ct))});
  }finally{plain.fill(0)}
}
export async function openVault(session,text){
  const key=sessionKey(session),{vault,iv,bytes}=envelope(text);
  if(vault!==session.vault)fail('VAULT_AUTH');
  let plain;
  try{plain=new Uint8Array(await wc().subtle.decrypt(params(vault,iv),key,bytes))}
  catch{fail('VAULT_AUTH')}
  try{
    sessionKey(session);
    let raw;try{raw=JSON.parse(dec.decode(plain))}catch{bad()}
    return validated(raw);
  }finally{plain.fill(0)}
}
