// UI only. Never persist, log, or display the key; only the selected provider
// session receives the value, from a deliberate connect action.
const messageFor={
  auth:'Провайдер не принял ключ. Проверьте его и попробуйте ещё раз.',
  key:'Формат ключа не подходит для выбранного провайдера.',
  rate_limit:'Провайдер ограничил запросы. Попробуйте чуть позже.',
  offline:'Нет подключения к интернету.',
  invalid_key:'Провайдер не принял ключ. Проверьте его и попробуйте ещё раз.',
  unauthorized:'Провайдер не принял ключ. Проверьте его и попробуйте ещё раз.',
  forbidden:'Нет доступа к API или списку моделей. Проверьте разрешения ключа у провайдера.',
  no_models:'Ключ проверен, но Folio не нашёл совместимых текстовых моделей.',
  quota:'Проверьте баланс и лимит расходов у провайдера.',
  backend:'У провайдера временный сбой. Попробуйте позже.',
  protocol:'Провайдер вернул неожиданный ответ. Не удалось завершить проверку.',
  model:'Провайдер не вернул список моделей. Попробуйте позже или выберите другой сервис.',
  rate_limited:'Провайдер ограничил запросы. Попробуйте чуть позже.',
  network:'Провайдер не ответил. Проверьте интернет или выберите другой сервис.',
  cors:'Этот браузер не смог подключиться к провайдеру напрямую.',
  timeout:'Провайдер не ответил вовремя. Попробуйте ещё раз.',
};
const fallbackMessage='Не удалось проверить подключение. Попробуйте позже.';
const modelId=m=>typeof m==='string'?m:m?.id;
const modelLabel=m=>typeof m==='string'?m:(m?.label||m?.id)+(m?.free?' · free':'');
const normalizeCode=code=>typeof code==='string'?code.toLowerCase().replace(/[- ]/g,'_'):'';
const validHttps=url=>{
  try{const parsed=new URL(url);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password?parsed.href:''}
  catch{return ''}
};
const el=(tag,text,klass)=>{
  const n=document.createElement(tag);
  if(text!=null)n.textContent=text;
  if(klass)n.className=klass;
  return n;
};
const button=(text,klass)=>{
  const n=el('button',text,klass);n.type='button';return n;
};
const option=(value,text=value)=>{
  const n=el('option',text);n.value=value;return n;
};
const label=(title,control)=>{
  const n=el('label',null,'byok-field');n.append(el('span',title),control);return n;
};
const link=text=>{
  const n=el('a',text);n.target='_blank';n.rel='noopener noreferrer';n.referrerPolicy='no-referrer';return n;
};

export function installByokSettings(panel,session,{providers,summary}={}){
  const allowed=new Map(Object.values(providers??{}).filter(p=>p?.id&&p.label&&p.hostname).map(p=>[p.id,p]));
  const lead=el('p','Добавьте свой ключ, чтобы по желанию получать подсказки о словах в книге.','byok-lead');
  const privacy=el('p','Ключ остаётся в памяти вкладки. Используйте отдельный ключ; платные запросы тарифицирует провайдер.','muted byok-privacy');
  privacy.id='byok-privacy-note';
  const status=el('p','','byok-status');status.id='byok-status';
  status.setAttribute('role','status');status.setAttribute('aria-atomic','true');

  const setup=el('div',null,'byok-connect');
  const provider=el('select');provider.id='byok-provider';provider.translate=false;
  provider.append(option('','Выберите сервис'));
  for(const p of allowed.values())provider.append(option(p.id,p.label));
  const providerHelp=el('p','','byok-provider-host muted');providerHelp.id='byok-provider-host';
  provider.setAttribute('aria-describedby',providerHelp.id);
  const key=el('input');
  key.id='byok-api-key';key.type='password';key.autocomplete='off';key.spellcheck=false;key.translate=false;
  key.setAttribute('autocapitalize','none');key.setAttribute('autocorrect','off');key.setAttribute('enterkeyhint','go');
  key.setAttribute('aria-describedby',privacy.id);key.maxLength=2048;
  const links=el('div',null,'byok-links'),issueKey=link('Получить ключ'),readPrivacy=link('Политика конфиденциальности');
  links.append(issueKey,readPrivacy);
  const setupActions=el('div',null,'byok-actions'),connect=button('Проверить ключ','primary'),cancel=button('Отменить','quiet');
  setupActions.append(connect,cancel);
  setup.append(label('Провайдер',provider),providerHelp,label('Ключ API',key),links,setupActions);

  const connected=el('div',null,'byok-connected');
  const activeProvider=el('p','','byok-active-provider');
  const model=el('select');model.id='byok-model';model.translate=false;
  const modelHint=el('p','Без выбранной модели Folio не отправляет запросы на подсказку.','muted byok-model-hint');
  modelHint.id='byok-model-note';model.setAttribute('aria-describedby',modelHint.id);
  const disconnect=button('Отключить ключ','quiet byok-disconnect');
  const activePlan=el('p','','byok-provider-host muted');
  connected.append(activeProvider,activePlan,label('Модель',model),modelHint,disconnect);
  panel.replaceChildren(lead,privacy,setup,connected,status);

  let attempt=null,selectedProvider='',modelsSignature='',committed=false;
  const announce=(text,error=false)=>{
    status.textContent=text;
    status.toggleAttribute('data-error',error);
  };
  const showLink=(node,value)=>{
    const href=validHttps(value);
    node.hidden=!href;
    if(href)node.href=href;else node.removeAttribute('href');
  };
  const allowNativeActivate=e=>e.isTrusted===true;
  function refresh(){
    const snapshot=session.snapshot();
    const active=allowed.get(snapshot?.provider);
    const p=active??allowed.get(selectedProvider);
    committed=!!active;
    setup.hidden=committed;connected.hidden=!committed;
    if(active){
      selectedProvider=active.id;
      activeProvider.textContent=active.label;activePlan.textContent=active.planNote||'';activePlan.hidden=!active.planNote;
      const models=(Array.isArray(snapshot?.models)?snapshot.models:[]).filter(x=>typeof modelId(x)==='string'&&modelId(x)).map(x=>[modelId(x),modelLabel(x)]);
      const next=JSON.stringify(models);
      if(next!==modelsSignature||!model.options.length){
        const placeholder=option('','Выберите модель');placeholder.disabled=true;
        model.replaceChildren(placeholder,...models.map(([id,label])=>option(id,label)));
        modelsSignature=next;
      }
      model.value=models.some(([id])=>id===snapshot?.model)?snapshot.model:'';
      model.disabled=!models.length;
    }else{model.replaceChildren();modelsSignature=''}
    provider.value=p?.id??'';
    providerHelp.textContent=p?(p.planNote||'У отдельных моделей OpenRouter есть бесплатная квота.').trim():'';
    providerHelp.hidden=!p;
    showLink(issueKey,p?.keyUrl);showLink(readPrivacy,p?.privacyUrl);links.hidden=issueKey.hidden&&readPrivacy.hidden;
    provider.disabled=!!attempt||!allowed.size;key.disabled=!!attempt||!p;connect.disabled=!!attempt||!p||!key.value.trim();
    cancel.hidden=!attempt;
    setup.setAttribute('aria-busy',String(!!attempt));
    if(summary)summary.textContent=active?(model.value?'Подключено':'Выберите модель'):'';
    return snapshot;
  }
  function stopCheck(message='',clearDraft=true){
    const current=attempt;
    if(clearDraft)key.value='';
    if(current){
      attempt=null;
      current.controller.abort();
      // Clears any staged connection and invalidates its eventual completion.
      session.clear();
    }
    refresh();
    if(message)announce(message);
    return !!current;
  }
  async function begin(e){
    if(!allowNativeActivate(e)||attempt||committed||!allowed.has(selectedProvider)||!key.value.trim())return;
    const controller=new AbortController(),attemptedProvider=selectedProvider;
    const current={controller};attempt=current;
    let secret=key.value.trim();key.value='';
    announce('Проверяем ключ и доступные модели…');refresh();cancel.focus({preventScroll:true});
    try{
      let check;
      try{check=session.connect({provider:attemptedProvider,key:secret,signal:controller.signal})}
      finally{secret=''}
      await check;
      if(attempt!==current||controller.signal.aborted)return;
      const state=session.snapshot();
      if(state?.provider!==attemptedProvider||!state.models?.length)throw Object.assign(new Error(),{code:'no_models'});
      attempt=null;
      refresh();
      announce(model.value?'Готово. Подсказки появятся только по вашему запросу.':'Ключ проверен. Выберите модель.');
      model.focus({preventScroll:true});
    }catch(error){
      if(attempt!==current||controller.signal.aborted)return;
      attempt=null;session.clear();refresh();
      announce(messageFor[normalizeCode(error?.code)]??fallbackMessage,true);
      key.focus({preventScroll:true});
    }
  }
  provider.addEventListener('change',e=>{
    if(!allowNativeActivate(e)||attempt||committed)return;
    selectedProvider=allowed.has(provider.value)?provider.value:'';
    key.value='';announce('');refresh();
  });
  key.addEventListener('input',()=>{if(!attempt){announce('');refresh()}});
  key.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.repeat||e.isComposing)return;
    e.preventDefault();void begin(e);
  });
  connect.addEventListener('click',begin);
  cancel.addEventListener('click',e=>{
    if(!allowNativeActivate(e)||!attempt)return;
    stopCheck('Проверка отменена. Введите ключ снова.');
    key.focus({preventScroll:true});
  });
  model.addEventListener('change',e=>{
    if(!allowNativeActivate(e)||attempt||!committed)return;
    // The placeholder isn't an executable model.
    const chosen=model.value;
    if(!chosen){refresh();return}
    try{
      session.select(chosen);refresh();
      announce('Модель выбрана. Подсказки появятся только по вашему запросу.');
    }catch{refresh();announce('Не удалось выбрать модель.',true)}
  });
  disconnect.addEventListener('click',e=>{
    if(!allowNativeActivate(e)||!committed)return;
    session.clear();stopCheck();announce('Ключ отключён.');
    key.focus({preventScroll:true});
  });

  const profile=panel.closest('#profile-view'),home=panel.closest('#home');
  function leaveIfHidden(){
    if(panel.closest('[hidden],[inert]')&&stopCheck())announce('Проверка отменена.');
  }
  profile?.addEventListener('folio:profile-page',e=>{
    if(e.detail?.page!=='ai'&&stopCheck())announce('Проверка отменена.');
  });
  // The root tab can change without pushing a new profile-stack page.
  const watcher=new MutationObserver(leaveIfHidden);
  for(const element of [profile,home])if(element)watcher.observe(element,{attributeFilter:['hidden']});
  window.addEventListener('pagehide',()=>{stopCheck();session.clear();refresh();announce('')});
  refresh();
  return {refresh};
}
