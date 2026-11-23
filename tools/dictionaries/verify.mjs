// Independent asset verification; no network, no browser, no user content.
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {recommendedPacks as catalog} from '../../dist/packs/catalog.js';

const base=new URL('../../dist/',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const norm=(s,lang)=>s.normalize('NFKC').toLowerCase().replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim().replace(lang==='ru'?/\u0301/g:/$^/g,'');
const fold=s=>s.normalize('NFD').replace(/\u0301/g,'').normalize('NFC');
const expected={'freedict-en-ru':[57076,57076],'wordnet-en-en':[147478,151378],'freedict-ru-en':[42282,42282],'freedict-en-hi':[22694,22694],'freedict-en-es':[58939,58939]};
assert.deepEqual([...catalog.map(p=>p.id)].sort(),Object.keys(expected).sort());
let combined=0;
for(const p of catalog){
  const u=new URL(p.manifest,base),mb=readFileSync(u);
  assert.equal(sha(mb),p.manifestSha256);
  const m=JSON.parse(mb); assert.equal(m.format,1);assert.equal(m.id,p.id);assert.equal(m.version,p.version);
  assert.deepEqual([m.count,m.keys],expected[p.id]);assert.equal(m.count,p.count);
  assert.equal(m.notice,readFileSync(new URL('NOTICE.txt',u),'utf8'));
  assert.equal(m.licenseUrl,p.licenseUrl);
  const license=readFileSync(new URL('LICENSE.txt',u),'utf8');
  assert.ok(license.length>=1400);
  assert.equal(readdirSync(new URL('.',u)).filter(s=>s.startsWith('part-')).length,m.shards.length,'stale shard');
  let last='', keys=0, heads=0, total=0;
  const wanted=new Set(['book','water','cat','run','library','river','school','read','although','obtain','hence','neither','converge','approach','odd','aardvark','photosynthesis','thermodynamics','serendipity','went','geese','better','saw','учебник','нечётный','осторожность','маршрут']);
  const fixtures=new Map();
  for(const sh of m.shards){
    assert.ok(/^part-\d{3}-[a-f\d]{12}\.json$/.test(sh.file));
    const bytes=readFileSync(new URL(sh.file,u));assert.equal(sha(bytes),sh.sha256);assert.equal(bytes.length,sh.bytes);assert.ok(bytes.length<512_001);
    const rows=JSON.parse(bytes);assert.equal(rows.length,sh.keys);total+=bytes.length;
    for(const [key,senses] of rows){
      assert.ok(key>last,'duplicate or unordered key: '+key);last=key;keys+=1;
      assert.ok(senses.length);
      assert.ok(senses.every(s=>s[0]&&(s[1]||s[2])&&s.length<=6&&s.every(x=>typeof x==='string')));
      if(senses.some(s=>norm(s[0],p.language)===key))heads+=1;
      if(p.target==='hi')assert.ok(senses.every(s=>/[ऄ-हक़-ॡ]/u.test(s[1])&&!/[a-zA-Z?~_]/.test(s[1])), 'no stray source-side glosses: '+key);
      if(p.target==='es')assert.ok(senses.every(s=>s[1].length>0), 'Spanish translations required');
      if(wanted.has(key))fixtures.set(key,senses);
    }
  }
  assert.deepEqual([heads,keys,total],[m.count,m.keys,p.bytes]);combined+=total;
  const has=(key,fn)=>assert.ok(fixtures.get(key)?.some(fn),p.id+': '+key);
  if(p.id==='freedict-en-ru'){
    for(const [k,to] of Object.entries({obtain:'получить',hence:'поэтому',neither:'ни один',converge:'сходиться',approach:'подход',odd:'нечётный',aardvark:'трубкозуб',photosynthesis:'фотосинтез',thermodynamics:'термодинамика',serendipity:'стечение обстоятельств'})){
      has(k,s=>fold(s[1]).includes(to));
    }
  }else if(p.id==='wordnet-en-en'){
    for(const k of ['obtain','hence','neither','converge','approach','odd','aardvark','photosynthesis','thermodynamics','serendipity'])has(k,s=>!s[1]&&s[2]?.length>5);
    has('went',s=>s[0]==='go'&&s[3]==='verb');
    has('geese',s=>s[0]==='goose'&&s[3]==='noun');
    has('saw',s=>s[0]==='saw'); has('saw',s=>s[0]==='see');
    has('better',s=>s[0]==='good'&&s[3]==='adjective');has('obtain',s=>s[4]?.includes('visa'));
  }else if(p.target==='hi'||p.target==='es'){
    const samples=p.target==='hi'?{book:'किताब',water:'पानी',cat:'बिल्ली',run:'दौड़ना',library:'पुस्तकालय',river:'नदी',school:'विद्यालय',read:'पढ़ना',although:'यद्यपि'}:{book:'libro',water:'agua',cat:'gato',run:'correr',library:'biblioteca',river:'río',school:'escuela',read:'leer',although:'aunque'};
    for(const [k,to] of Object.entries(samples))has(k,s=>s[1].includes(to));
    if(p.target==='hi'){assert.ok(readFileSync(new URL('corresponding-source.zip',u)).length>1e6);assert.ok(readFileSync(new URL('credits.html',u),'utf8').includes('href="corresponding-source.zip"'))}
  }else{
    for(const [k,to] of Object.entries({'учебник':'textbook','осторожность':'caution','маршрут':'route','нечётный':'odd'}))has(k,s=>s[1].includes(to));
  }
  console.log('PASS',p.id,heads,'headwords,',keys,'keys,',m.shards.length,'verified shards,',total,'bytes.');
}
console.log('PASS all catalogs, licenses, data SHA-256, ordering, coverage, polysemy and authentic irregular forms:',combined,'shard bytes.');
