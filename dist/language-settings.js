import {fillLanguages,pairCode,pairInfo} from './language-pairs.js';
import {recommendedPacks} from './packs/catalog.js';
export function installLanguages({prefs,save,model,runtime,installed,firstVisit}){
  const welcome=document.querySelector('#language-welcome'),page=document.querySelector('#language-settings');
  const panels=[welcome,page];
  const read=(panel,key)=>panel.querySelector('[data-lang-'+key+']');
  const values=panel=>({readingLanguage:read(panel,'source').value,dictionaryTarget:read(panel,'target').value});
  function capabilities(panel){
    const {readingLanguage:s,dictionaryTarget:t}=values(panel);
    const info=pairInfo(s,t,recommendedPacks,installed(),model(s,t),runtime());
    read(panel,'dictionary').textContent=info.dictionary;
    read(panel,'paragraphs').textContent=info.paragraphs;
  }
  function sync(){
    const {readingLanguage:source,dictionaryTarget:target,languageSetup}=prefs();
    document.querySelector('#profile-language-summary').textContent=pairCode(source,target);
    welcome.hidden=languageSetup!=='pending';
    for(const panel of panels){
      read(panel,'source').value=source;read(panel,'target').value=target;
      capabilities(panel);
    }
  }
  for(const panel of panels){
    fillLanguages(read(panel,'source'),prefs().readingLanguage);fillLanguages(read(panel,'target'),prefs().dictionaryTarget);
    for(const field of ['source','target'])read(panel,field).onchange=()=>{
      if(panel===welcome){capabilities(panel);return}
      save({...values(panel),languageSetup:'done'});sync();
    };
  }
  function finish(change){
    save({...change,languageSetup:'done'});sync();
    document.querySelector(document.querySelector('#library-view').hidden?'#home-title':'#library-title').focus({preventScroll:true});
  }
  read(welcome,'continue').onclick=()=>finish(values(welcome));
  read(welcome,'skip').onclick=()=>finish({});
  // Existing profiles before this release never see onboarding. A fresh, unfinished
  // card survives reload without blocking direct links, the library, or any other tab.
  if(prefs().languageSetup==='unset')save({languageSetup:firstVisit?'pending':'done'});
  function place(view){
    if(welcome.hidden||!['home','library'].includes(view))return;
    const title=document.querySelector('#'+view+'-title').closest('.section-intro');
    if(title.nextElementSibling!==welcome)title.after(welcome);
  }
  sync();return {sync,place,refresh:()=>panels.forEach(capabilities)};
}
