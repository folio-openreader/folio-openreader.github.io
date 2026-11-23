import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createGithubSync,GITHUB_SYNC_FILE,GITHUB_SEALED_LIMIT} from '../dist/sync-github.js';

const TOKEN='github_pat_MOCK_only_01234567890123456789012345678';
const owner='FolioTest',repo='sync-test',root='/repos/'+owner+'/'+repo, file=root+'/contents/'+GITHUB_SYNC_FILE;
const vault='b'.repeat(32), foreign='c'.repeat(32);
const sealed=(seed=1,{id=vault,bytes=17}={})=>JSON.stringify({format:'folio-sync',version:1,alg:'A256GCM',vault:id,
  iv:Buffer.alloc(12,seed).toString('base64url'),ciphertext:Buffer.alloc(bytes,seed).toString('base64url')});
const shaOf=text=>createHash('sha1').update('blob '+text.length+'\0'+text).digest('hex');
const responds=(code,value,headers={})=>new Response(JSON.stringify(value),{status:code,headers});
const metadata={id:54321,full_name:owner+'/'+repo,default_branch:'main',private:true,visibility:'private',fork:false,archived:false,disabled:false};
const expectCode=(p,code)=>assert.rejects(p,error=>error?.code===code&&!String(error).includes(TOKEN));

function server(initial=null) {
  let latest=initial, checked=[];
  const state={metadata:{...metadata},missingStatus:200,missingListing:[{path:'README.md'}],conflict:409};
  const safeUrl=x=>{const u=new URL(x);assert.equal(u.origin,'https://api.github.com');assert.equal(u.username,'');assert.equal(u.password,'');
    assert.equal(u.hash,'');assert.ok(!x.includes(TOKEN));return u;};
  async function fetcher(url,init){
    const u=safeUrl(url);
    assert.equal(init.mode,'cors');assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');
    assert.equal(init.cache,'no-store');assert.equal(init.referrerPolicy,'no-referrer');
    assert.equal(init.headers.Authorization,'Bearer '+TOKEN);
    assert.deepEqual(Object.keys(init.headers).sort(),(init.method==='PUT'?['Accept','Authorization','Content-Type']:['Accept','Authorization']));
    if(init.body)assert.ok(!init.body.includes(TOKEN));
    const step={method:init.method,path:u.pathname,ref:u.searchParams.get('ref')};
    checked.push(step);
    const handled=await state.intercept?.(step,init);
    if(handled)return handled;
    if(step.path===root&&step.method==='GET')return responds(200,state.metadata);
    if(step.path===root+'/contents'&&step.method==='GET'){
      assert.equal(step.ref,state.metadata.default_branch);
      return responds(state.missingStatus,state.missingListing);
    }
    assert.equal(step.path,file);
    if(step.method==='GET'){
      assert.equal(step.ref,state.metadata.default_branch);
      return latest?responds(200,{path:GITHUB_SYNC_FILE,type:'file',size:latest.length,encoding:'base64',
        content:Buffer.from(latest).toString('base64').replace(/.{1,60}/g,'$&\n'),sha:shaOf(latest)}):responds(404,{message:'not found'});
    }
    assert.equal(step.method,'PUT');
    const payload=step.payload=JSON.parse(init.body);
    assert.equal(step.ref,null);assert.equal(payload.branch,state.metadata.default_branch);
    assert.equal(payload.message,'Update encrypted Folio vault');
    if((latest&&payload.sha!==shaOf(latest))||(!latest&&payload.sha))return responds(state.conflict,{message:'secret error details '+TOKEN});
    const nextCode=latest?200:201;
    latest=Buffer.from(payload.content,'base64').toString('utf8');
    assert.ok(!latest.includes(TOKEN));
    return responds(nextCode,{content:{path:GITHUB_SYNC_FILE,sha:shaOf(latest)}});
  }
  const newAdapter=(opts={})=>createGithubSync({owner,repo,token:TOKEN,vaultId:vault,fetcher,...opts});
  return {state,checked,newAdapter,current:()=>latest,setCurrent:next=>{latest=next;},writes:()=>checked.filter(x=>x.method==='PUT')};
}

test('the optional adapter is input-only before activation and fail-closed on unscoped inputs',async()=>{
  const s=server(), c=s.newAdapter();
  assert.equal(s.checked.length,0);
  await expectCode(c.read(),'not-active');
  await expectCode(c.write(sealed(),{allowCreate:true}),'not-active');
  assert.equal(s.checked.length,0);
  for(const opt of [{owner:'https://abc'}, {owner:'fake\n'},{repo:'../sync'}, {repo:'x%2Ftest'},{repo:'ok\n'},
    {repo:'x?ref=main'},{owner:'a@github.com'},{owner:'a--b'},{repo:'/'},{repo:'__proto__?'}])assert.throws(()=>s.newAdapter(opt),{code:'bad-target'});
  for(const token of ['ghp_wrong_scope_token',TOKEN+'\n','github_pat_'+'x'.repeat(300)])
    assert.throws(()=>s.newAdapter({token}),{code:'bad-token'});
  assert.throws(()=>s.newAdapter({vaultId:vault+'\n'}),{code:'wrong-vault'});
});

test('safe first creation requires activation, confirmed same-branch readable absence and explicit consent',async()=>{
  const s=server(),c=s.newAdapter();
  assert.deepEqual(await c.activate(),{id:54321,branch:'main'});
  await expectCode(c.write(sealed(),{allowCreate:true}),'not-observed');
  assert.deepEqual(await c.read(),{kind:'missing'});
  await expectCode(c.write(sealed()),'create-not-confirmed');
  await expectCode(c.write(sealed(),{allowCreate:true,revision:'a'.repeat(40)}),'create-not-confirmed');
  assert.deepEqual(await c.write(sealed(),{allowCreate:true}),{revision:shaOf(sealed())});
  assert.equal(Object.hasOwn(s.writes()[0].payload,'sha'),false);
  assert.equal(s.current(),sealed());
  await expectCode(c.write(sealed(2),{revision:shaOf(sealed())}),'not-observed');
});

test('two devices submit observed SHA; stale update is proved by GET, not retried or blindly applied',async()=>{
  const s=server(sealed()),a=s.newAdapter(),b=s.newAdapter();
  await Promise.all([a.activate(),b.activate()]);
  const [beforeA,beforeB]=await Promise.all([a.read(),b.read()]);
  assert.deepEqual(beforeA,beforeB);
  assert.equal(beforeA.revision,shaOf(sealed()));
  assert.deepEqual(await a.write(sealed(2),{revision:beforeA.revision}),{revision:shaOf(sealed(2))});
  await expectCode(b.write(sealed(3),{revision:beforeB.revision}),'stale-revision');
  assert.equal(s.writes().length,2);
  assert.equal(s.current(),sealed(2));
  await expectCode(b.write(sealed(3),{revision:beforeB.revision}),'not-observed');
  const latest=await b.read();assert.equal(latest.sealed,sealed(2));
  // Synthetic stand-in for a caller performing decrypt/merge/reseal.
  await b.write(sealed(4),{revision:latest.revision});
  assert.equal(s.writes().length,3);assert.equal(s.current(),sealed(4));
});

test('two first-creation races never overwrite the other device; 422 gets a confirmation read',async()=>{
  const s=server(),a=s.newAdapter(),b=s.newAdapter();s.state.conflict=422;
  await Promise.all([a.activate(),b.activate()]);
  await Promise.all([a.read(),b.read()]);
  await a.write(sealed(),{allowCreate:true});
  await expectCode(b.write(sealed(2),{allowCreate:true}),'stale-revision');
  assert.equal(s.writes().length,2);assert.equal(s.current(),sealed());
});

test('private repository verification is required for activation, reads and writes',async()=>{
  for(const invalid of [{private:false,visibility:'public'}, {private:true,visibility:'internal'},{private:true,visibility:undefined},
    {archived:true},{fork:true},{disabled:true},{default_branch:'../other'}, {full_name:'other/else'},{id:-1}]){
    const s=server(sealed()),c=s.newAdapter();
    Object.assign(s.state.metadata,invalid);
    await assert.rejects(c.activate(),error=>['repo-not-private','repo-unverified','repo-read-only'].includes(error.code));
    assert.equal(s.checked.length,1);assert.equal(s.writes().length,0);
  }
  for(const invalid of [{private:false,visibility:'public'},{id:54322},{default_branch:'switched'}]){
    const s=server(sealed()),c=s.newAdapter();await c.activate();
    const current=await c.read();
    Object.assign(s.state.metadata,invalid);
    await assert.rejects(c.write(sealed(2),{revision:current.revision}),error=>['repo-not-private','repo-changed'].includes(error.code));
    await assert.rejects(c.read(),error=>['repo-not-private','repo-changed'].includes(error.code));
    assert.equal(s.writes().length,0);
  }
});

test('ambiguous 404, branch visibility loss, and denied directories never become create permission',async()=>{
  for(const [status,listing] of [[404,null],[200,[{path:GITHUB_SYNC_FILE}]],[200,{unexpected:[]}],[200,Array.from({length:1000},(_,i)=>({path:String(i)}))]]){
    const s=server(),c=s.newAdapter();await c.activate();
    s.state.missingStatus=status;s.state.missingListing=listing;
    await expectCode(c.read(),'missing-unverified');
    await expectCode(c.write(sealed(),{allowCreate:true}),'not-observed');
    assert.equal(s.writes().length,0);
  }
  const s=server(sealed()),c=s.newAdapter();await c.activate();const old=await c.read();
  s.state.intercept=({path})=>path===root?responds(404,{message:TOKEN}):null;
  await expectCode(c.write(sealed(2),{revision:old.revision}),'repo-unverified');assert.equal(s.writes().length,0);
});

test('only the correct vault and strict encrypted wire shape can reach any PUT',async()=>{
  const s=server(sealed()),c=s.newAdapter();await c.activate();const old=await c.read();
  for(const text of ['{"books":[{"text":"private"}]}', sealed().replace('A256GCM','plaintext'),
    sealed().replace('"format":','"format":"untrusted duplicate secret","format":'),sealed()+' ',
    sealed().replace(',"iv":',',"key":"secret","iv":'),sealed().replace('b'.repeat(32),'b'.repeat(32)+'\\n')]){
    await expectCode(c.write(text,{revision:old.revision}),'invalid-envelope');
  }
  await expectCode(c.write(sealed(3,{id:foreign}),{revision:old.revision}),'wrong-vault');
  await expectCode(c.write('x'.repeat(GITHUB_SEALED_LIMIT+1),{revision:old.revision}),'size-limit');
  assert.equal(s.writes().length,0);
  for(const [data,error] of [['not-json','invalid-remote'], [sealed(3,{id:foreign}),'wrong-vault'],[sealed()+'\n','invalid-remote']]){
    const t=server(data), adapter=t.newAdapter();await adapter.activate();await expectCode(adapter.read(),error);
    assert.equal(t.writes().length,0);
  }
});

test('oversized response streams and noncanonical GitHub base64 fail safely',async()=>{
  const s=server(sealed()),c=s.newAdapter();await c.activate();
  const response={path:GITHUB_SYNC_FILE,type:'file',encoding:'base64',size:1,sha:'a'.repeat(40)};
  s.state.intercept=step=>step.path===file?responds(200,{...response,content:'AB=='}):null;
  await expectCode(c.read(),'invalid-remote');
  s.state.intercept=step=>step.path===file?responds(200,{...response,size:GITHUB_SEALED_LIMIT+1,content:'AA=='}):null;
  await expectCode(c.read(),'size-limit');
  s.state.intercept=step=>step.path===file?new Response('x'.repeat(1500*1024)):null;
  await expectCode(c.read(),'size-limit');
  s.state.intercept=step=>step.path===file?new Response('',{headers:{'Content-Length':'4000000'}}):null;
  await expectCode(c.read(),'size-limit');
});

test('HTTP status, errors and redirect safeguards expose no raw token or provider message',async()=>{
  for(const [status,headers,error] of [[401,{},'unauthorized'],[403,{},'forbidden'],
    [403,{'x-ratelimit-remaining':'0'},'rate-limited'],[403,{'Retry-After':'5'},'rate-limited'],[429,{},'rate-limited'],
    [413,{},'size-limit'],[507,{},'quota'],[500,{},'write-unknown'],[409,{},'write-conflict'],
    [412,{},'write-conflict'],[422,{},'write-rejected']]){
    const s=server(sealed()),c=s.newAdapter();await c.activate();const {revision}=await c.read();
    s.state.intercept=step=>step.method==='PUT'?responds(status,{message:'leaked provider error '+TOKEN},headers):null;
    await expectCode(c.write(sealed(2),{revision}),error);
    assert.equal(s.writes().length,1);assert.equal(s.current(),sealed());
  }
  for(const bad of [new Response(null,{status:301}),Object.assign(responds(200,metadata),{}),new Error(TOKEN)]){
    const s=server(),c=s.newAdapter();
    if(bad instanceof Error)s.state.intercept=()=>{throw bad};
    else {if(bad.status===200)Object.defineProperty(bad,'redirected',{value:true});s.state.intercept=()=>bad;}
    await assert.rejects(c.activate(),error=>['network','repo-unverified'].includes(error.code)&&!String(error).includes(TOKEN));
    assert.equal(s.writes().length,0);
  }
});

test('a committed but lost write returns unknown and never retries; caller must read again',async()=>{
  const s=server(sealed()), c=s.newAdapter();await c.activate();
  const before=await c.read();
  s.state.intercept=(step,init)=>{
    if(step.method!=='PUT')return null;
    s.setCurrent(Buffer.from(JSON.parse(init.body).content,'base64').toString('utf8'));
    throw new Error(TOKEN); // commit succeeded, the HTTP response was lost
  };
  await expectCode(c.write(sealed(2),{revision:before.revision}),'write-unknown');
  await expectCode(c.write(sealed(2),{revision:before.revision}),'not-observed');
  assert.equal(s.writes().length,1);
  assert.equal((await c.read()).sealed,sealed(2));
});

test('disconnect ends outstanding operations and the memory-only token cannot be reused',async()=>{
  const s=server(sealed()),c=s.newAdapter();
  await c.activate();
  s.state.intercept=(_step,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>reject(new Error(TOKEN)),{once:true});
  });
  const pending=c.read();
  await expectCode(c.read(),'busy');
  c.disconnect();
  await expectCode(pending,'disconnected');
  const calls=s.checked.length;
  await expectCode(c.activate(),'disconnected');await expectCode(c.read(),'disconnected');
  assert.equal(s.checked.length,calls);
});

test('a deleted known vault stays missing, never recreated; stored private identity cannot change',async()=>{
  const s=server(sealed()),a=s.newAdapter();await a.activate();await a.read();
  s.setCurrent(null);
  await expectCode(a.read(),'remote-disappeared');
  await expectCode(a.write(sealed(),{allowCreate:true}),'not-observed');
  const returning=s.newAdapter({expectExisting:true,expectedRepoId:metadata.id});await returning.activate();
  await expectCode(returning.read(),'remote-disappeared');
  s.state.metadata.id++;
  await expectCode(s.newAdapter({expectedRepoId:metadata.id}).activate(),'repo-changed');
  assert.equal(s.writes().length,0);
});

test('the largest canonical v1 ciphertext transfers inside REST and local byte limits',async()=>{
  const big=sealed(9,{bytes:512*1024+16}), s=server(big),c=s.newAdapter();
  await c.activate();const got=await c.read();
  assert.equal(got.sealed,big);
  const next=sealed(7,{bytes:512*1024+16});
  const r=await c.write(next,{revision:got.revision});
  assert.equal(r.revision,shaOf(next));assert.equal(s.current(),next);
});
