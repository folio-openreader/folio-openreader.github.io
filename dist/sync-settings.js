// Local-first sync UI. I/O, crypto, and durable state belong to the injected controller.
const LIMIT=768*1024;
const RECOVERY=/^folio1\.[A-Za-z0-9_-]{43}$/;
const REPO=/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const PAT=/^github_pat_[A-Za-z0-9_]{20,240}$/;
const COUNTS=[['words','Слова'],['added','Добавится'],['updated','Обновится'],['removed','Будет удалено'],['deferred','Останется в зашифрованной копии без применения'],['sending','Записей в копии для GitHub']];
const ERRORS=Object.freeze({
  'local-locks':'Для безопасного переноса нужен современный браузер с Web Locks по HTTPS.',
  'local-busy':'Словарь занят другой вкладкой. Закройте её, перезагрузите эту страницу и проверьте копию снова.',
  'local-invalid':'Локальный словарь не удалось проверить. Перенос остановлен. Сохраните обычную резервную копию перед восстановлением.',
  'export-journal-limit':'Достигнут предел местных журналов переноса. Используйте прежний код. Если его журнал тоже заполнен, сохраните обычную резервную копию. Старые записи не удалялись.',
  'local-quota':'Не хватает места в браузере. Старый словарь сохранён; освободите место и повторите.',
  'local-vault-limit':'На этом устройстве уже восемь отдельных кодов. Продолжите с существующим кодом.',
  'legacy-fork':'Прежняя вкладка изменила словарь. Закройте её и проверьте её изменения ниже. Обе версии сохранены.',
  'local-capacity':'Словарь не вмещает обе версии без потерь. Ничего не изменено.',
  'SYNC_WORD_CAPACITY':'Лимит слов на устройстве. Перенос не выполнен.',
  'remote-only':'Копия на GitHub записана, но локальное объединение не подтверждено. Проверьте GitHub ещё раз.',
  VAULT_KEY_FORMAT:'Код Folio должен начинаться с folio1. Скопируйте его целиком.',
  VAULT_AUTH:'Код не подошёл или копия повреждена. Проверьте код с другого устройства.',
  VAULT_INVALID:'Копия повреждена или создана в неподдерживаемой версии Folio.',
  VAULT_LIMIT:'Копия слишком большая. Предел для одного файла: 768 КБ.',
  VAULT_CRYPTO_UNAVAILABLE:'Шифрование недоступно. Откройте Folio по HTTPS в современном браузере.',
  'bad-target':'Укажите репозиторий в виде владелец/название, без ссылки.',
  'bad-token':'Нужен fine-grained token GitHub для этого репозитория.',
  'wrong-vault':'Для этой копии нужен другой код. Возьмите код с устройства, создавшего копию.',
  'repo-unverified':'Не удалось проверить репозиторий. Проверьте название и доступ токена.',
  'repo-not-private':'Нужен отдельный приватный репозиторий. Публичный использовать нельзя.',
  'repo-read-only':'Нужен активный репозиторий с файлами. При создании добавьте README.',
  'repo-changed':'Репозиторий или ветка по умолчанию изменились. Проверьте настройки GitHub.',
  'unauthorized':'GitHub не принял токен. Возможно, срок его действия истёк.',
  'forbidden':'GitHub не разрешил операцию. Проверьте доступ токена и права Contents.',
  'rate-limited':'GitHub ограничил число запросов. Попробуйте чуть позже.',
  'quota':'GitHub отклонил запрос из-за лимита.',
  'network':'Не удалось связаться с GitHub. Проверьте интернет.',
  'invalid-remote':'Файл на GitHub повреждён или записан в другом формате.',
  'missing-unverified':'GitHub не подтвердил, что файла ещё нет. Не удалось подготовить запись.',
  'remote-disappeared':'Файл пропал из репозитория. Без проверки Folio не создаст его заново.',
  'stale-revision':'Копия на GitHub изменилась. Проверьте её снова, прежде чем продолжать.',
  'write-conflict':'GitHub сообщил о конфликте. Проверьте копию снова.',
  'write-unknown':'Не удалось подтвердить запись. Сначала проверьте копию на GitHub.',
  'local-changed':'Данные на устройстве изменились. Проверьте копию ещё раз.'
});
const MARKUP=`
  <p class="sync-settings-lead">Перенесите слова и результаты повторения на другое устройство. Без аккаунта Folio и только по вашей команде.</p>
  <fieldset class="sync-choices" data-sync="choices">
    <legend class="sr-only">Способ переноса</legend>
    <label><input type="radio" name="folio-sync-mode" value="file" checked><span>Перенос файлом</span></label>
    <label><input type="radio" name="folio-sync-mode" value="github"><span>Приватный GitHub</span></label>
  </fieldset>
  <div class="sync-method" data-sync="file-info">
    <p>Без аккаунта. Скачайте зашифрованный файл и откройте его на другом устройстве. Храните его в «Файлах» или где вам удобно. Перед заменой общей копии сначала откройте её и объедините изменения. Это не автоматическая синхронизация.</p>
  </div>
  <div class="sync-method" data-sync="github-info" hidden>
    <p>Ваш отдельный приватный репозиторий на GitHub. Folio хранит там только зашифрованный файл.</p>
    <details class="sync-details">
      <summary>Как настроить GitHub</summary>
      <ol>
        <li>Создайте отдельный репозиторий: <b>Private</b>, с <b>README</b>, чтобы была ветка по умолчанию. Подойдёт бесплатный аккаунт.</li>
        <li>Создайте <b>fine-grained personal access token</b>. В <b>Repository access</b> выберите только этот репозиторий. Для <b>Contents</b> включите <b>Read and write</b>.</li>
        <li>Введите название, токен и код Folio. Нажмите «Проверить GitHub». Folio ничего не запишет без следующего подтверждения.</li>
      </ol>
      <a href="https://docs.github.com/en/get-started/start-your-journey/creating-a-repository-for-your-project-on-github" target="_blank" rel="noopener noreferrer">Создать репозиторий (GitHub Docs)</a>
      <a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token" target="_blank" rel="noopener noreferrer">Создать токен (GitHub Docs)</a>
    </details>
  </div>
  <fieldset class="sync-editor" data-sync="editor">
    <legend class="sr-only">Данные переноса</legend>
    <div class="sync-field sync-code-field">
      <label for="folio-sync-recovery">Код Folio</label>
      <input id="folio-sync-recovery" data-sync="code" type="password" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="80" aria-describedby="folio-sync-code-help" placeholder="Вставьте существующий код">
      <p id="folio-sync-code-help" class="sync-hint">Для первого переноса создайте код. На другом устройстве нужен тот же код. Folio его не сохраняет.</p>
      <div class="sync-actions sync-code-actions">
        <button class="quiet" type="button" data-sync="generate">Создать код</button>
        <button class="quiet" type="button" data-sync="copy" hidden>Копировать код</button>
        <button class="quiet" type="button" data-sync="reveal" aria-pressed="false" hidden>Показать код</button>
      </div>
      <div class="sync-remember" data-sync="generated" hidden>
        <p class="sync-hint">Сохраните код отдельно от файла, например в менеджере паролей. Восстановить его нельзя.</p>
        <label><input type="checkbox" data-sync="saved"> Я сохранил(а) код</label>
      </div>
    </div>
    <div data-sync="file-fields" class="sync-fields">
      <div class="sync-actions">
        <button class="primary" type="button" data-sync="export">Подготовить файл</button>
      </div>
      <div class="sync-file">
        <label class="sync-field" for="folio-sync-file">Получить данные из файла</label>
        <input id="folio-sync-file" data-sync="file" type="file" accept=".folio-sync,.json,application/json" aria-describedby="folio-sync-file-help">
        <p id="folio-sync-file-help" class="sync-hint">После первого подтверждённого объединения словарь редактируется из одной вкладки Folio за раз. Скачивание файла ничего не меняет в словаре. Книги и их резервные копии не меняются.</p>
        <div class="sync-actions">
          <button class="quiet sync-secondary" type="button" data-sync="import">Проверить файл</button>
        </div>
      </div>
    </div>
    <div data-sync="github-fields" class="sync-fields" hidden>
      <label class="sync-field">Репозиторий
        <input data-sync="repo" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="140" placeholder="владелец/репозиторий">
      </label>
      <label class="sync-field">Токен GitHub
        <input data-sync="token" type="password" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore autocapitalize="none" autocorrect="off" spellcheck="false" maxlength="260" aria-describedby="folio-sync-token-help" placeholder="Вставьте fine-grained token">
      </label>
      <p class="sync-hint" id="folio-sync-token-help">Токен нужен только для запроса к GitHub. Folio его не сохраняет.</p>
      <div class="sync-actions">
        <button class="primary" type="button" data-sync="github">Проверить GitHub</button>
      </div>
    </div>
  </fieldset>
  <p class="sync-status" data-sync="status" role="status" aria-live="polite" aria-atomic="true" tabindex="-1"></p>
  <div class="sync-actions" data-sync="running" hidden>
    <button class="quiet sync-secondary" type="button" data-sync="stop">Прервать ожидание</button>
  </div>
  <div class="sync-actions" data-sync="download-wrap" hidden>
    <a class="primary sync-download" data-sync="download" download="folio-sync.folio-sync">Скачать файл</a>
  </div>
  <section class="sync-review" data-sync="review" aria-labelledby="folio-sync-review-heading" hidden>
    <h2 id="folio-sync-review-heading" data-sync="review-title" tabindex="-1">Проверьте копию</h2>
    <p data-sync="review-copy"></p>
    <dl class="sync-review-stats" data-sync="counts"></dl>
    <div class="sync-actions">
      <button class="primary" type="button" data-sync="apply">Объединить данные</button>
      <button class="quiet" type="button" data-sync="discard">Закрыть без изменений</button>
    </div>
  </section>
  <div class="sync-footer">
    <details class="sync-details">
      <summary>Что переносится</summary>
      <p>Переносятся слова, их статус и расписание повторения. Примеры, встречи со словами, книги, PDF, OCR, настройки и ключи ИИ остаются здесь. Места чтения и закладки с этого устройства пока не переносятся. Записи об изданиях из другой копии сохранятся в ней, но не применятся.</p>
    </details>
    <button type="button" class="quiet" data-sync="legacy-check" hidden>Проверить изменения прежней вкладки</button>
    <button type="button" class="quiet sync-clear" data-sync="clear" hidden>Заблокировать и очистить поля</button>
  </div>
`;

// generateCode() -> string or Promise<string>; exportFile({code,signal}) -> sealed string or Blob.
// previewFile({file,code,signal}) / previewGithub({repo,token,code,signal})
// -> {kind?: 'create'|'merge'|'unchanged', summary?: {words,progress,bookmarks},
//      apply({signal}): Promise, discard?(): void}. Counts describe the proposed result.
// Preview never writes, and discard must drop any retained state/connection. The controller
// revalidates local/remote revisions before apply. 'unchanged' may omit apply. Only GitHub can create.
export function mountSyncSettings(host,hooks={}){
  if(!host?.ownerDocument||typeof host.querySelector!=='function')throw new TypeError('Expected Folio settings host');
  const doc=host.ownerDocument,win=doc.defaultView;
  host.classList.add('sync-settings');
  host.innerHTML=MARKUP;
  const q=name=>host.querySelector('[data-sync="'+name+'"]');
  const [choices,editor,code,repo,token,file,status,review,counts,download]=
    ['choices','editor','code','repo','token','file','status','review','counts','download'].map(q);
  const modeFile=choices.querySelector('input[value=file]'),modeGithub=choices.querySelector('input[value=github]');
  if(!hooks.previewGithub){modeGithub.closest('label').hidden=true;choices.hidden=true}
  const lifetime=new AbortController();
  const listen=(node,event,callback)=>node?.addEventListener(event,callback,{signal:lifetime.signal});
  let mode='file',operation=null,preview=null,downloadUrl='',downloadLease=null,generation=false,revision=0;

  function setStatus(message='',tone=''){
    status.textContent=message;
    if(tone)status.dataset.tone=tone;
    else delete status.dataset.tone;
  }
  function showError(err,fallback){
    if(err?.code==='legacy-fork')q('legacy-check').hidden=false;
    setStatus(Object.hasOwn(ERRORS,err?.code)?ERRORS[err.code]:fallback,'error');
  }
  function paint(){
    if(lifetime.signal.aborted)return;
    const remote=mode==='github',busy=!!operation;
    for(const part of ['info','fields']){
      q('file-'+part).hidden=remote;
      q('github-'+part).hidden=!remote;
    }
    choices.disabled=busy;editor.disabled=busy;
    host.toggleAttribute('data-sync-busy',busy);
    q('running').hidden=!busy;
    q('generate').hidden=Boolean(code.value);
    q('copy').hidden=!code.value;
    q('reveal').hidden=!code.value;
    q('generated').hidden=!generation;
    q('clear').hidden=!(busy||preview||downloadUrl||code.value||repo.value||token.value||file.files?.length);
    q('download-wrap').hidden=!downloadUrl;
    review.hidden=!preview||busy;
  }
  function conceal(){
    code.type='password';
    q('reveal').textContent='Показать код';
    q('reveal').setAttribute('aria-pressed','false');
  }
  function wipeCode(){
    code.value='';generation=false;
    q('saved').checked=false;conceal();
  }
  function clearSecrets(){wipeCode();token.value=''}
  function release(result){
    try{result?.discard?.()}catch{/* Always clear UI references. */}
  }
  function dropPreview(){
    const old=preview;
    preview=null;review.hidden=true;counts.replaceChildren();
    release(old?.result);
  }
  function dropDownload(){
    release(downloadLease);downloadLease=null;
    if(downloadUrl)win.URL.revokeObjectURL(downloadUrl);
    downloadUrl='';download.removeAttribute('href');
  }
  function invalidate(){
    revision++;
    const pending=operation;
    operation=null;pending?.ctl.abort();
    dropPreview();dropDownload();setStatus();
  }
  function clear(){
    const pending=operation;
    operation=null;revision++;
    pending?.ctl.abort();
    clearSecrets();repo.value='';file.value='';
    dropPreview();dropDownload();setStatus();paint();
    return pending;
  }
  function reset(){
    if(lifetime.signal.aborted)return;
    clear();mode='file';modeFile.checked=true;modeGithub.checked=false;
    host.querySelectorAll('details[open]').forEach(el=>{el.open=false});
    paint();
  }
  function cancel(note){
    const pending=clear();
    setStatus(pending?.writing
      ? 'Ожидание прервано. Если запрос уже дошёл до GitHub, запись могла пройти. Проверьте копию перед повтором.'
      : note);
    status.focus();
  }
  function run(label,callback,complete,fallback,{writing=false}={}){
    if(operation)return;
    const ctl=new AbortController(),ticket={ctl,writing};
    operation=ticket;setStatus(label,'busy');paint();q('stop').focus();
    void(async()=>{
      let result;
      try{
        result=await callback(ctl.signal);
        if(operation!==ticket){release(result);return}
        operation=null;
        complete(result);
      }catch(error){
        if(ctl.signal.aborted||lifetime.signal.aborted){release(result);return}
        operation=null;release(result);dropPreview();
        showError(error,fallback);status.focus();
      }finally{paint()}
    })();
  }
  function checkRecovery(){
    const value=code.value.trim();
    if(!RECOVERY.test(value)){
      setStatus(value?ERRORS.VAULT_KEY_FORMAT:'Введите код Folio или создайте его для первого переноса.','error');
      code.focus();return '';
    }
    if(generation&&!q('saved').checked){
      setStatus('Сначала сохраните код отдельно и отметьте это.','error');
      q('saved').focus();return '';
    }
    return value;
  }
  function previewResult(result,origin){
    const kind=result?.kind??'merge';
    if(!['create','merge','unchanged'].includes(kind)||(kind==='create'&&origin!=='github')||
      (kind!=='unchanged'&&typeof result?.apply!=='function'))throw new Error('Invalid sync preview');
    if(kind==='unchanged'){
      release(result);setStatus('Данные уже совпадают. Изменений нет.');status.focus();return;
    }
    dropPreview();preview={result,origin,kind};
    q('review-title').textContent=kind==='create'?'Первая копия на GitHub':'Проверьте копию';
    q('review-copy').textContent=kind==='create'
      ? 'В репозитории ещё нет файла Folio. После подтверждения Folio создаст зашифрованную копию.'
      : origin==='github'
        ? 'Folio объединит копию на GitHub с данными на этом устройстве, не заменяя всю библиотеку.'
        : 'Folio объединит данные из файла с вашими. Книги и другие данные на устройстве останутся на месте.';
    if(origin==='legacy'){
      q('review-title').textContent='Словарь прежней вкладки';
      q('review-copy').textContent='Добавить её слова и объединить местные встречи с ними? Текущие слова не удалятся. Ранее удалённые слова могут вернуться. Ничего не отправляется.';
    }
    if(result.summary?.removed>0)q('review-copy').textContent+=' Вместе с удалённым словом исчезнет и его история встреч на этом устройстве.';
    q('apply').textContent=kind==='create'?'Создать файл на GitHub':origin==='github'?'Синхронизировать':'Объединить данные';
    for(const [key,label] of COUNTS){
      const count=result.summary?.[key];
      if(!Number.isSafeInteger(count)||count<0)continue;
      const term=doc.createElement('dt'),value=doc.createElement('dd');
      term.textContent=label;value.textContent=count.toLocaleString('ru-RU');
      counts.append(term,value);
    }
    counts.hidden=!counts.childElementCount;
    setStatus();paint();q('review-title').focus();
  }
  function capture(){
    const value=checkRecovery();
    if(!value)return '';
    invalidate();clearSecrets();return value;
  }
  listen(choices,'change',event=>{
    const next=event.target.value;
    if(operation||!['file','github'].includes(next)||next===mode||next==='github'&&!hooks.previewGithub)return;
    clear();mode=next;paint();
  });
  listen(code,'input',()=>{
    invalidate();generation=false;q('saved').checked=false;
    if(!code.value)conceal();
    paint();
  });
  for(const input of [repo,token,file]){
    listen(input,'input',()=>{invalidate();paint()});
    listen(input,'change',()=>{invalidate();paint()});
  }

  listen(q('generate'),'click',()=>{
    if(code.value||operation)return;
    invalidate();
    run('Создаём код…',()=>hooks.generateCode(),result=>{
      if(typeof result!=='string'||!RECOVERY.test(result))throw new Error('Invalid recovery code');
      code.value=result;generation=true;q('saved').checked=false;conceal();
      setStatus('Код создан. Сохраните его отдельно.');
      paint();q('copy').focus();
    },'Не удалось создать код. Откройте Folio по HTTPS в современном браузере.');
  });
  listen(q('copy'),'click',async()=>{
    if(operation||!code.value)return;
    const now=revision;
    try{
      await win.navigator.clipboard.writeText(code.value.trim());
      if(revision===now)setStatus('Код скопирован. Сохраните его отдельно.');
    }catch{
      if(revision===now)setStatus('Не удалось скопировать. Нажмите «Показать код», чтобы скопировать вручную.','error');
    }
  });
  listen(q('reveal'),'click',()=>{
    if(code.type==='text'){conceal();return}
    code.type='text';
    q('reveal').textContent='Скрыть код';
    q('reveal').setAttribute('aria-pressed','true');
  });
  listen(q('export'),'click',()=>{
    if(operation||mode!=='file')return;
    const recovery=capture();
    if(!recovery)return;
    run('Шифруем файл…',signal=>hooks.exportFile({code:recovery,signal}),result=>{
      const value=result?.sealed??result;
      const blob=typeof value==='string'?new win.Blob([value],{type:'application/octet-stream'}):value;
      if(!(blob instanceof win.Blob)||!blob.size)throw new Error('Invalid encrypted download');
      if(blob.size>LIMIT)throw Object.assign(new Error(),{code:'VAULT_LIMIT'});
      downloadUrl=win.URL.createObjectURL(blob);downloadLease=result;download.href=downloadUrl;
      setStatus('Файл готов. Чтобы открыть его на другом устройстве, понадобится тот же код.');
      paint();download.focus();
    },'Не удалось подготовить файл. Попробуйте ещё раз.');
  });
  listen(download,'click',event=>{
    try{downloadLease?.finalize?.();release(downloadLease);downloadLease=null;setStatus('Браузеру передан файл для скачивания. Убедитесь, что он сохранён.')}
    catch(error){event.preventDefault();dropDownload();showError(error,'Не удалось подтвердить файл. Подготовьте его снова.');paint()}
  });
  listen(q('legacy-check'),'click',()=>{
    if(operation)return;invalidate();clearSecrets();
    run('Сравниваем локальные словари…',()=>hooks.legacyReview(),result=>previewResult(result,'legacy'),'Не удалось сравнить словари. Перезагрузите страницу.');
  });
  listen(q('import'),'click',()=>{
    if(operation||mode!=='file')return;
    const selected=file.files?.[0];
    if(!selected){setStatus('Сначала выберите файл Folio.','error');file.focus();return}
    if(!selected.size||selected.size>LIMIT){
      setStatus(selected.size?ERRORS.VAULT_LIMIT:'Выбранный файл пуст.','error');file.focus();return;
    }
    const recovery=capture();
    if(!recovery)return;
    file.value='';
    run('Читаем зашифрованный файл…',signal=>hooks.previewFile({file:selected,code:recovery,signal}),
      result=>previewResult(result,'file'),'Не удалось прочитать файл Folio. Проверьте файл и код.');
  });
  listen(q('github'),'click',()=>{
    if(operation||mode!=='github')return;
    const name=repo.value.trim(),access=token.value.trim();
    if(!REPO.test(name)){setStatus(ERRORS['bad-target'],'error');repo.focus();return}
    if(!PAT.test(access)){setStatus(ERRORS['bad-token'],'error');token.focus();return}
    const recovery=capture();
    if(!recovery)return;
    run('Проверяем репозиторий и зашифрованную копию…',
      signal=>hooks.previewGithub({repo:name,token:access,code:recovery,signal}),
      result=>previewResult(result,'github'),'Не удалось проверить GitHub. Проверьте интернет, репозиторий и токен.');
  });
  listen(q('apply'),'click',()=>{
    if(operation||!preview)return;
    const plan=preview,remote=plan.origin==='github';
    run(remote?'Объединяем данные с GitHub…':'Объединяем данные на устройстве…',
      signal=>plan.result.apply({signal}),()=>{
        if(plan.origin==='legacy')q('legacy-check').hidden=true;
        dropPreview();setStatus(remote
          ? plan.kind==='create'?'Зашифрованная копия сохранена на GitHub.':'Данные синхронизированы с GitHub.'
          : plan.origin==='legacy'?'Словари на устройстве объединены. Теперь снова проверьте перенос.':'Перенос завершён. Применены подтверждённые изменения.');
        status.focus();
      },remote?'Не удалось подтвердить синхронизацию. Проверьте копию на GitHub перед повтором.'
        :'Не удалось подтвердить перенос. Проверьте файл ещё раз.',{writing:remote});
  });
  listen(q('discard'),'click',()=>{dropPreview();setStatus('Данные не изменились.');paint();status.focus()});
  listen(q('stop'),'click',()=>cancel('Ожидание прервано. Поля очищены.'));
  listen(q('clear'),'click',()=>cancel('Код, токен и выбранный файл убраны из Folio.'));
  listen(host.closest('#profile-view'),'folio:profile-page',event=>{if(event.detail?.page!=='sync')reset()});
  listen(win,'pagehide',reset);
  paint();

  return {reset,dispose(){
    if(lifetime.signal.aborted)return;
    reset();lifetime.abort();host.replaceChildren();host.classList.remove('sync-settings');
  }};
}
