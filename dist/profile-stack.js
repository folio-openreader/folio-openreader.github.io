// The Folio profile is flat in the DOM and behaves like a navigation stack.
// Existing settings stay mounted; the current URL is the sole page selection.
const profile=document.querySelector('#profile-view');
const stage=profile?.querySelector('.profile-stack-stage');
if(stage) installProfileStack(profile,stage);

function installProfileStack(profile,stage) {
  const pages=new Map([...stage.children].map(el=>[el.dataset.stackPage,el]));
  const rows=new Map([...stage.querySelectorAll('[data-profile-open]')].map(el=>[el.dataset.profileOpen,el]));
  const root=pages.get('root'),home=document.querySelector('#home'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const ease='cubic-bezier(.22,.81,.23,1)';
  let current='root',profileRoute=false,pendingBack=false,running=[],leaving=null,label=null;
  const theme=document.querySelector('#profile-theme'),sound=document.querySelector('#pref-sound');
  const visible=()=>!profile.hidden&&!home.hidden;
  const inProfile=()=>/^#profile(?:\/|$)/.test(location.hash);
  function updateHints(){
    const values=[['#profile-theme-summary',theme.selectedOptions[0]?.textContent||''],
      ['#profile-sound-summary',sound.checked?'Звук включён':'']];
    for(const [id,value] of values){const el=root.querySelector(id);if(el.textContent!==value)el.textContent=value}
  }
  function pageFromHash(){
    const match=/^#profile\/([a-z]+)$/.exec(location.hash);
    return match&&rows.has(match[1])?match[1]:'root';
  }
  function clearExit(){
    if(leaving){leaving.hidden=true;leaving.inert=false;leaving.removeAttribute('aria-hidden');leaving.removeAttribute('data-leaving');leaving=null}
    if(label){label.removeAttribute('data-transfer');label=null}
  }
  function cancel(){
    for(const effect of running)effect.cancel();
    running=[];
    clearExit();
  }
  function activate(next,{animate=false,focus=false,scroll=false,source=null}={}){
    updateHints();
    if(next===current)return;
    cancel();
    const previous=current,old=pages.get(previous),now=pages.get(next);
    const forward=next!=='root';
    const motion=animate&&visible()&&!reduce.matches&&typeof now.animate==='function';
    const wasAtTop=stage.getBoundingClientRect().top>=-16;
    const sourceLabel=forward&&motion&&wasAtTop?source?.querySelector('.profile-row-label'):null;
    const from=sourceLabel?.getBoundingClientRect();
    const scaleFrom=from?parseFloat(getComputedStyle(sourceLabel).fontSize):0;
    now.hidden=false;current=next;stage.dataset.profilePage=next;
    if(scroll&&visible())window.scrollTo(0,0);
    if(focus&&visible()){
      const target=forward?now.querySelector('h1'):rows.get(previous);
      target?.focus({preventScroll:true});
    }
    if(motion&&wasAtTop){
      leaving=old;old.inert=true;old.setAttribute('aria-hidden','true');old.dataset.leaving='';
      if(sourceLabel&&from?.width){label=sourceLabel;label.dataset.transfer=''}
    }else old.hidden=true;
    if(motion){
      const body=forward?now.querySelector('.profile-stack-body'):now;
      const title=forward?now.querySelector('.profile-page-title'):null;
      if(title&&from?.width){
        const to=title.getBoundingClientRect(),scale=scaleFrom/parseFloat(getComputedStyle(title).fontSize);
        const dx=from.left-to.left,dy=(from.top+from.height/2)-(to.top+to.height/2);
        running.push(title.animate([{transform:`translate(${dx}px,${dy}px) scale(${scale})`},{transform:'none'}],{duration:360,easing:ease}));
      }else if(title){
        running.push(title.animate([{opacity:0,transform:'translateX(10px)'},{opacity:1,transform:'none'}],{duration:230,easing:ease}));
      }
      if(body)running.push(body.animate([{opacity:0.36,transform:forward?'translateX(13%)':'translateX(-6%)'},{opacity:1,transform:'none'}],{duration:330,easing:ease}));
      if(leaving)running.push(leaving.animate([{opacity:1},{opacity:0,transform:forward?'translateX(-4%)':'translateX(22%)'}],{duration:260,easing:ease,fill:'forwards'}));
      const batch=running;
      Promise.allSettled(batch.map(effect=>effect.finished)).then(()=>{if(running===batch)cancel()});
    }
    profile.dispatchEvent(new CustomEvent('folio:profile-page',{detail:{page:next}}));
  }
  function handleLocation(){
    const wasProfile=profileRoute;
    profileRoute=inProfile();pendingBack=false;
    const internal=wasProfile&&profileRoute&&visible();
    activate(profileRoute?pageFromHash():'root',{animate:internal,focus:internal,scroll:internal});
  }
  function back(){
    if(current==='root'||pendingBack)return;
    if(history.state?.folioProfileParent===true){
      pendingBack=true;history.back();
    }else{
      history.replaceState(history.state,'','#profile');
      handleLocation();
    }
  }
  stage.addEventListener('click',event=>{
    const link=event.target.closest('a[data-profile-open], a[data-profile-up]');
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();
    if(link.hasAttribute('data-profile-up')){back();return}
    const page=link.dataset.profileOpen;
    if(page===current)return;
    history.pushState({...history.state,folioProfileParent:current==='root'},'',link.hash);
    profileRoute=true;
    activate(page,{animate:true,focus:true,scroll:true,source:link});
  });
  window.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||event.defaultPrevented||current==='root'||!visible()||document.querySelector('dialog[open]'))return;
    // Leave Escape to the focused native control or an open explanation first.
    const target=event.target;
    if(target.closest?.('input,select,textarea,[contenteditable]'))return;
    const help=target.closest?.('.profile-stack-head .help-disclosure[open]');
    if(help){help.open=false;event.preventDefault();return}
    event.preventDefault();back();
  });
  window.addEventListener('hashchange',handleLocation);
  window.addEventListener('popstate',handleLocation);
  reduce.addEventListener?.('change',()=>{if(reduce.matches)cancel()});
  const visibility=new MutationObserver(()=>{
    if(!visible())cancel();
    else updateHints();
  });
  visibility.observe(profile,{attributeFilter:['hidden']});
  visibility.observe(home,{attributeFilter:['hidden']});
  profile.addEventListener('change',updateHints);
  stage.dataset.profilePage='root';
  handleLocation();
}
