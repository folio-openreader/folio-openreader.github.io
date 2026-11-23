import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {installNavMotion} from '../dist/shell-motion.js';

test('word statuses share the single catalog plate and still expose counts and the controlled list',async()=>{
  const html=await readFile(new URL('../dist/app.html',import.meta.url),'utf8');
  const markup=html.match(/<div id="word-stage-filters"[^>]+>([\s\S]*?)<\/div>/);
  assert.ok(markup);
  assert.match(markup[0],/class="catalog-switch stage-filters" role="group" aria-label="Статус слов"/);
  assert.equal((markup[1].match(/class="catalog-current" aria-hidden="true"/g)||[]).length,1);
  const controls=[...markup[1].matchAll(/data-stage-filter="(\w+)" aria-pressed="(true|false)" aria-controls="saved-list"[^>]*>.*?>([^<>]+) <small data-stage-count="(\w+)">0<\/small>/g)];
  assert.deepEqual(controls.map(([,key,pressed,label,count])=>[key,pressed,label,count]),[
    ['all','true','Все','all'],['new','false','Новое','new'],['learning','false','Учу','learning'],
    ['almost','false','Почти','almost'],['known','false','Знаю','known'],
  ]);
});

function sample(t,{keyAttribute='stage-filter',reduced=false}={}){
  const attr='data-'+keyAttribute,calls=[];
  const preferences={matches:reduced,addEventListener(){}};
  const previousWindow=globalThis.window;
  globalThis.window={matchMedia:()=>preferences,addEventListener(){}};
  t.after(()=>{if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow});
  const plate={
    style:{},
    getBoundingClientRect(){return {left:parseInt(this.style.left),top:parseInt(this.style.top),width:parseInt(this.style.width),height:parseInt(this.style.height)}},
    animate(frames,options){const flight={frames,options,cancel(){this.cancelled=true}};calls.push(flight);return flight},
  };
  const buttons=['all','new','known'].map((stage,i)=>({
    getAttribute:name=>{assert.equal(name,attr);return stage},
    offsetLeft:5+i*60,offsetTop:5,offsetWidth:57,offsetHeight:46,querySelector:()=>null,
  }));
  const box={
    querySelector:()=>plate,dataset:{},querySelectorAll:selector=>{assert.equal(selector,'button['+attr+']');return buttons},
  };
  return {select:installNavMotion(box,{keyAttribute}).select,buttons,plate,box,calls};
}

test('the shared motion helper slides a single plate on a hyphenated data key and refits it',t=>{
  const {select,buttons,plate,box,calls}=sample(t);
  buttons[0].offsetWidth=0;
  select('all'); // Start without motion when the section is first revealed.
  assert.equal(box.dataset.traveller,undefined);
  buttons[0].offsetWidth=57;
  select('all');
  assert.equal(plate.style.left,'5px');
  select('new',{animate:true});
  select('known',{animate:true});
  assert.equal(box.dataset.traveller,'');
  assert.equal(plate.style.left,'125px');
  assert.equal(calls.length,2);
  assert.equal(calls[0].cancelled,true);
  buttons[2].offsetWidth=74;
  select('known');
  assert.equal(plate.style.width,'74px');
  assert.equal(calls[1].cancelled,true);
});

test('existing catalog-style controls and word controls snap without animation in reduced motion',async t=>{
  for(const keyAttribute of ['catalog','stage-filter'])await t.test(keyAttribute,t=>{
    const {select,plate,calls}=sample(t,{keyAttribute,reduced:true});
    select('all');select('known',{animate:true});
    assert.equal(plate.style.left,'125px');
    assert.equal(calls.length,0);
  });
});
