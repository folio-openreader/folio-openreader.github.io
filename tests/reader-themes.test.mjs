import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {ACCENTS, DEFAULT_PREFS, THEMES, accentPalette, contrast, sanitizePrefs} from '../dist/release-core.js';

const read=path=>readFile(new URL('../dist/'+path,import.meta.url),'utf8');
const [html,css,boot,manifest]=await Promise.all(['app.html','study.css','boot.css','folio.webmanifest'].map(read));
const executable=html.match(/<script id="folio-startup-theme">([\s\S]*?)<\/script>/)[1];
const startup=(theme,{hash='',injectStorage,osDark=false}={})=>{
  const dataset={theme:'paper'},meta=Object.fromEntries(['color-scheme','theme-color'].map(name=>[name,{}]));
  runInNewContext(executable,{
    localStorage:{getItem:name=>{assert.equal(name,'folio-v2');return injectStorage?injectStorage():theme===undefined?null:JSON.stringify({prefs:{theme}})}},
    location:{hash},
    matchMedia:()=>({matches:osDark}),
    document:{documentElement:{dataset},querySelector:s=>meta[s.match(/"([^"]+)"/)[1]]}
  });
  return [dataset.theme,meta['theme-color'].content,meta['color-scheme'].content];
};

test('Paper is the only new default, unrelated preference defaults stay unchanged',()=>{
  assert.equal(DEFAULT_PREFS.theme,'paper');
  assert.equal(sanitizePrefs().theme,'paper');
  assert.equal(sanitizePrefs({theme:'__proto__'}).theme,'paper');
  assert.equal(sanitizePrefs({theme:['night']}).theme,'paper');
  const previous={theme:'night',size:29,font:'source-serif',accent:'#1b61a5',readingLanguage:'fr',dictionaryTarget:'ru',languageSetup:'done',autoSaveWords:false,haptics:false,practiceSound:true,iphoneCheckHaptic:true};
  const from=sanitizePrefs(previous),to=sanitizePrefs({...previous,theme:'ink'});
  assert.deepEqual({...to,theme:'night'},from);
  for(const key of ['light','paper','night','linen','ink'])assert.equal(sanitizePrefs({theme:key}).theme,key);
});

test('startup never follows operating-system dark mode over Paper, and all saved modes are honored before CSS',()=>{
  assert.ok(html.indexOf('id="folio-startup-theme"')<html.indexOf('rel="stylesheet"'));
  assert.deepEqual(startup(undefined,{osDark:true}),['paper','#f4efdf','light']);
  assert.deepEqual(startup(undefined,{osDark:true,hash:'#read/folio-night-ferry'}),['paper','#fcf8ec','light']);
  assert.deepEqual(startup(null,{injectStorage:()=>'{invalid'}),['paper','#f4efdf','light']);
  assert.deepEqual(startup(null,{injectStorage:()=>{throw Error('Storage unavailable')}}),['paper','#f4efdf','light']);
  for(const [key,t] of Object.entries(THEMES)){
    assert.deepEqual(startup(key),[key,t.bg,t.scheme]);
    assert.deepEqual(startup(key,{hash:'#read/example'}),[key,t.surface,t.scheme]);
    assert.ok(html.includes(`:root[data-theme="${key}"]{--boot-bg:${t.bg};--boot-ink:${t.ink};color-scheme:${t.scheme}}`));
  }
});
test('both theme selectors expose the same five local keys and manifest matches Paper',()=>{
  const opts=[...html.matchAll(/<select id="(?:profile-theme|reading-theme)">([^]+?)<\/select>/g)].map(([,s])=>[...s.matchAll(/<option value="([^"]+)"/g)].map(([,key])=>key));
  assert.equal(opts.length,2);assert.deepEqual(opts[1],opts[0]);assert.deepEqual(new Set(opts[0]),new Set(Object.keys(THEMES)));
  const m=JSON.parse(manifest);assert.equal(m.theme_color,THEMES.paper.bg);assert.equal(m.background_color,THEMES.paper.bg);
  assert.ok(boot.includes('var(--boot-bg,#f4efdf)'));assert.ok(boot.includes('var(--boot-ink,#36342d)'));
});

test('both new palettes have AA prose, metadata, notice and user accent contrast',()=>{
  for(const key of ['linen','ink']){
    const t=THEMES[key];
    const block=css.match(new RegExp(`data-theme="${key}"\\] body\\{([^]+?)\\}`))[1];
    const colors=Object.fromEntries([...block.matchAll(/--([a-z-]+):(#\w{6})/g)].map(([,name,color])=>[name,color]));
    assert.equal(colors.surface,t.surface);assert.equal(colors.subtle,t.subtle);
    for(const b of [t.bg,t.surface,colors.subtle]){
      assert.ok(contrast(t.ink,b)>=7,key);
      assert.ok(contrast(colors.muted,b)>=4.5,key);
    }
    assert.ok(contrast(colors['hero-ink'],colors.hero)>=7,key);
    assert.ok(contrast(colors['hero-secondary'],colors.hero)>=4.5,key);
    for(const status of ['success','error'])assert.ok(contrast(colors[status],colors[status+'-bg'])>=4.5,key);
    for(const accent of [...ACCENTS.map(x=>x.value),'#000000','#ffffff','#e4e9de','#181c22']){
      const palette=accentPalette({theme:key,accent});
      assert.ok(Math.min(contrast(palette.accent,t.bg),contrast(palette.accent,t.surface),contrast(palette.accent,t.subtle))>=4.9);
      assert.ok(contrast(palette.onAccent,palette.accent)>=4.5);
      assert.ok(contrast(t.ink,palette.selection)>=4.5);
    }
  }
});
