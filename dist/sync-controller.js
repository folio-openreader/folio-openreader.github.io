import {generateRecoveryCode,newDeviceId,unlockVault,lockVault,sealVault,openVault,emptySnapshot,VAULT_LIMITS} from './sync-vault.js';
import {captureLocal,finishLocal} from './sync-state.js';
import {packLearning} from './learning-core.js';
import {stop} from './sync-local.js';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const alive=s=>s?.throwIfAborted();
const blank={positions:{},bookmarks:{}};
const args=learning=>({state:blank,learning,editions:[]}); // no implicit book/position bindings
function effects(draft,before){
  const prior=new Map(packLearning(before).rows.map(r=>[r[1]+':'+r[0],r]));
  const next=new Map(packLearning(draft.learning).rows.map(r=>[r[1]+':'+r[0],r]));
  const list=[];
  // Include materialized field content, not just counts. A tombstone approval is also bound
  // to local evidence that would be removed. New cards' local creation timestamps are not consent.
  for(const k of new Set([...prior.keys(),...next.keys()])){
    const a=prior.get(k),b=next.get(k);
    if(!b)list.push([k,a,null]);
    else if(!a||!same(a.slice(3,8),b.slice(3,8)))list.push([k,a?.slice(3,8)??null,b.slice(3,8)]);
  }
  return JSON.stringify(list.sort((x,y)=>x[0]<y[0]?-1:1));
}
export function createSyncController({disk,liveWords,githubFactory}){
  const fallbackDevice=newDeviceId();
  async function begin(code,signal){
    alive(signal);const session=await unlockVault(code);
    try{
      const src=await disk.source();alive(signal);
      const prior=disk.current(session.vault),device=prior.device||fallbackDevice;
      const staged=captureLocal({...args(liveWords()),...prior,device});
      return {session,src,prior,device,staged};
    }catch(e){lockVault(session);throw e}
  }
  function fresh(b){
    disk.validSource(b.src);
    const p=disk.current(b.session.vault);
    if(!same(b.prior.snapshot,p.snapshot)||!same(b.prior.previous,p.previous)||!same(b.prior.github,p.github)||
       (p.device&&p.device!==b.device))stop('local-changed');
    return liveWords();
  }
  async function reserve(signal){
    if(!await disk.own())stop('local-busy');
    try{alive(signal)}catch(e){if(!disk.enrolled)disk.close();throw e}
  }
  function cleanup(b,adapter){
    lockVault(b.session);adapter?.disconnect();
    if(!disk.enrolled)disk.close();
  }
  async function exportFile({code,signal}){
    const b=await begin(code,signal);let ok=false;
    try{
      const sealed=await sealVault(b.session,b.staged.snapshot);
      await reserve(signal);fresh(b);alive(signal);
      lockVault(b.session);let done=false;
      const out={sealed,finalize(){
        if(done)stop('local-changed');done=true;
        const learning=fresh(b);
        const latest=captureLocal({...args(learning),...b.prior,device:b.device});
        if(!same(latest.snapshot,b.staged.snapshot))stop('local-changed');
        disk.commitExport({vault:b.session.vault,src:b.src,device:b.device,learning,...b.staged});
      },discard(){done=true;cleanup(b)}};
      ok=true;return out;
    }finally{if(!ok)cleanup(b)}
  }
  async function makePlan(b,remote,network){
    const {adapter,seen,binding}=network||{};
    const compute=()=>{const before=fresh(b);const draft=finishLocal({...args(before),device:b.device,staged:b.staged,remote});
      return {draft,impact:effects(draft,before)}};
    const planned=compute(), github=network?{repo:binding.repo,id:binding.id,branch:binding.branch}:undefined;
    const remoteNeeds=!!network&&(seen.kind==='missing'||!same(planned.draft.snapshot,remote));
    // Even if applied counts are zero, a newer journal/tombstone/pending edition or new
    // GitHub binding may need an explicitly confirmed local save.
    if(!remoteNeeds&&same(b.prior.snapshot,planned.draft.snapshot)&&same(b.prior.previous,planned.draft.projection)&&
       (!network||same(b.prior.github,github))&&planned.impact==='[]'){
      cleanup(b,adapter);return {kind:'unchanged'};
    }
    let spent=false;
    const getApproved=()=>{
      const now=compute();
      if(now.impact!==planned.impact||now.draft.counts.deferred!==planned.draft.counts.deferred||
         network&&!same(now.draft.snapshot,planned.draft.snapshot))stop('local-changed');
      return now.draft;
    };
    return {kind:seen?.kind==='missing'?'create':'merge',summary:{...planned.draft.counts,
      ...(network?{sending:remoteNeeds?planned.draft.snapshot.records.length:0}:{})},
      discard(){spent=true;cleanup(b,adapter)},
      async apply({signal}={}){
        if(spent)stop('local-changed');spent=true;let wrote=false;
        try{
          await reserve(signal);
          // While unenrolled, the same tab may have saved ordinary edits to v1. A
          // fresh cursor/digest verifies those bytes before rebasing; an external
          // write, changed vault journal or unapproved impact still fails closed.
          b.src=await disk.source();alive(signal);
          let draft=getApproved();alive(signal);
          if(network){
            // Recheck the confirmed branch and revision even when we would skip PUT.
            const check=await adapter.read({signal});alive(signal);
            if(check.kind!==seen.kind||check.kind==='found'&&check.revision!==seen.revision)stop('stale-revision');
            if(remoteNeeds){
              const sealed=await sealVault(b.session,draft.snapshot);alive(signal);getApproved();
              await adapter.write(sealed,seen.kind==='missing'?{allowCreate:true,signal}:{revision:seen.revision,signal});
              wrote=true;
            }
            alive(signal);draft=getApproved();
          }
          disk.commit({vault:b.session.vault,src:b.src,device:b.device,...draft,github});
        }catch(err){if(wrote)stop('remote-only');throw err}
        finally{cleanup(b,adapter)}
      }};
  }
  async function previewFile({file,code,signal}){
    if(!file||!Number.isSafeInteger(file.size)||file.size<1||file.size>VAULT_LIMITS.envelope)stop('VAULT_LIMIT');
    const b=await begin(code,signal);
    try{const text=await file.text();alive(signal);const remote=await openVault(b.session,text);alive(signal);
      return await makePlan(b,remote);
    }catch(e){cleanup(b);throw e}
  }
  async function previewGithub({repo,token,code,signal}){
    const b=await begin(code,signal);let adapter;
    try{
      const [owner,name,...extra]=repo.split('/');if(extra.length)stop('bad-target');
      const established=b.prior.github;
      if(established&&established.repo.toLowerCase()!==repo.toLowerCase())stop('repo-changed');
      const create=githubFactory||(await import('./sync-github.js')).createGithubSync;alive(signal);
      adapter=create({owner,repo:name,token,vaultId:b.session.vault,expectedRepoId:established?.id,expectExisting:!!established});
      const meta=await adapter.activate({signal});
      if(established&&established.branch!==meta.branch)stop('repo-changed');
      const seen=await adapter.read({signal});
      const remote=seen.kind==='found'?await openVault(b.session,seen.sealed):emptySnapshot();
      alive(signal);return await makePlan(b,remote,{adapter,seen,binding:{repo,id:meta.id,branch:meta.branch}});
    }catch(e){cleanup(b,adapter);throw e}
  }
  return {generateCode:generateRecoveryCode,exportFile,previewFile,previewGithub};
}
