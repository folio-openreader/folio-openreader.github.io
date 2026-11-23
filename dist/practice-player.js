// Vanilla adapter for Gradelyy's authored practice pages. All answers live in this
// view; only Folio's separate spaced-review action changes the learning ledger.
import {lessonCheckContact} from './lesson-contact.js';
import {gradeLearningTask,orderMatchTiles,selectMatchTile,linkedLeftId,taskLanguages,keepCorrectPairs,spellingClue,missedPracticePages} from './practice-engine.js';

function el(tag,text,cls){
  const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;
}
function button(label,cls){const n=el('button',label,cls);n.type='button';return n}
function labelButton(n,label){
  if(n.textContent!==label)n.textContent=label;
  if(n.getAttribute('aria-label')!==label)n.setAttribute('aria-label',label);
}
const textIn=(tag,text,lang,cls)=>{const n=el(tag,text,cls);if(lang)n.lang=lang;return n};
const focus=(n,preventScroll=true)=>n?.focus({preventScroll});
const kinds={choice:'Выбор значения',match:'Пары',cloze:'Слово в контексте',typed:'Написание'};
function icon(name,markup){const n=el('i',null,'icon-glyph');n.setAttribute('aria-hidden','true');n.innerHTML=markup(name);return n}

export function practicePlayer({game,feedback,iconMarkup,onExit,onAgain,allowNativeCheck=()=>false}){
  const stage=game.querySelector('#lesson-stage'),meter=game.querySelector('progress'),position=game.querySelector('#lesson-progress');
  const announcement=el('p',null,'sr-only');
  announcement.setAttribute('role','status');announcement.setAttribute('aria-atomic','true');game.append(announcement);
  const announce=(text='')=>{announcement.textContent=text};
  let doc=null,pages=[],index=0,firstTry=0,reviewTry=0,attempted=false,subsetNote='',reviewing=false,refreshContact=()=>{};
  const missed=new Set();
  function stop(){
    doc=null;pages=[];missed.clear();refreshContact=()=>{};announce();stage.replaceChildren();game.hidden=true;
  }
  function start(lesson,{scopeNote=''}={}){
    doc=lesson;pages=lesson.pages;index=0;firstTry=0;reviewTry=0;attempted=false;subsetNote=scopeNote;
    reviewing=false;missed.clear();game.hidden=false;draw();
  }
  function setMeter(value){
    meter.max=pages.length;meter.value=value;
    position.textContent=(index<pages.length?index+1:index)+' / '+pages.length;
  }
  function finish(){
    refreshContact=()=>{};setMeter(pages.length);announce();
    const done=el('div',null,'lesson-finish'),mark=el('span',null,'lesson-win');
    mark.append(icon('check',iconMarkup));
    const heading=el('h2',reviewing?'Разбор завершён':'Серия завершена');heading.tabIndex=-1;
    const note=el('p','С первого раза: '+(reviewing?reviewTry:firstTry)+' из '+pages.length+'.','lesson-finish-score');
    done.append(mark,heading,note);
    if(!reviewing){
      const words=el('div',null,'lesson-chips');words.setAttribute('aria-label','Слова этой серии');
      for(const w of doc.words)words.append(textIn('span',w.word,w.language));
      done.append(words);
    }
    const again=button('Новая серия',!reviewing&&missed.size?'quiet lesson-follow-up':'primary lesson-primary');
    const back=button('К упражнениям','quiet');again.id='lesson-again';again.onclick=onAgain;back.onclick=onExit;
    if(!reviewing&&missed.size){
      const followUp=el('p','В разбор войдут только задания, где вы ошиблись.','lesson-source-note');
      const repeat=button('Повторить ошибки','primary lesson-primary');repeat.id='lesson-review-missed';
      repeat.onclick=e=>{
        if(!doc||reviewing)return;
        feedback(e,'step');pages=missedPracticePages(doc.pages,missed);index=0;attempted=false;reviewing=true;draw();
      };
      done.append(followUp,repeat);
    }
    done.append(again,back);stage.replaceChildren(done);focus(heading);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function draw(){
    if(!doc)return;
    if(index>=pages.length){finish();return}
    announce();
    const {task}=pages[index],{source,target}=taskLanguages(doc,task),isMatch=task.kind==='match';
    setMeter(index);stage.dataset.kind=task.kind;
    const shell=el('article',null,'lesson-task'),kind=kinds[task.kind]||'Упражнение';
    const type=el('p',reviewing?'Разбор ошибок · '+kind:kind,'lesson-kicker');
    const prompt=el('h2',task.prompt,'lesson-prompt');prompt.tabIndex=-1;prompt.id='lesson-prompt';
    shell.setAttribute('aria-labelledby',prompt.id);shell.append(type,prompt);
    if(!reviewing&&index===0&&subsetNote)shell.append(el('p',subsetNote,'lesson-source-note'));
    const answers=el('div',null,'lesson-answers'),result=el('div',null,'lesson-verdict');
    const cta=button('Проверить','primary lesson-primary'),footer=el('div',null,'lesson-task-footer');
    const canAsk=task.kind==='typed', reveal=button(canAsk?'Не помню':'Показать ответ','quiet lesson-reveal');
    cta.id='lesson-check';cta.disabled=true;reveal.hidden=!canAsk;footer.append(cta);
    cta.onkeydown=e=>{if(e.repeat&&(e.key==='Enter'||e.key===' '))e.preventDefault()};
    let value=isMatch?{}:'',pending=null,graded=null,mark=null,locked={},revealed=false;
    let sync=()=>{},firstControl=()=>null,field=null;
    const ready=()=>isMatch?task.pairs.every(p=>Object.hasOwn(value,p.id)):!!String(value).trim();
    const syncContact=lessonCheckContact(footer,cta,()=>!graded&&allowNativeCheck(),e=>check(e));
    refreshContact=syncContact;
    function update(){sync();if(!graded)cta.disabled=!ready();syncContact()}
    if(isMatch){
      const hint=el('p','Нажмите слово и его значение. Чтобы разъединить пару, нажмите её ещё раз.','lesson-hint');
      const grid=el('div',null,'lesson-pairs');grid.setAttribute('role','group');grid.setAttribute('aria-label','Свяжите слова и значения');
      grid.append(el('span','Слова','lesson-column'),el('span','Значения','lesson-column'));
      const right=orderMatchTiles(task.pairs),tiles=[];
      const foot=el('div',null,'lesson-match-foot'),count=el('span'),clear=button('Сбросить','quiet');
      count.setAttribute('role','status');foot.append(count,clear);
      task.pairs.forEach((p,i)=>{
        for(const [side,row] of [['left',p],['right',right[i]]]){
          const b=button(null,'lesson-answer lesson-tile'),label=textIn('span',row[side],side==='left'?source:target),badge=el('span',null,'lesson-number');
          badge.setAttribute('aria-hidden','true');const tile={side,id:row.id};
          b.append(label,badge);tiles.push({b,badge,tile,label:row[side]});grid.append(b);
          b.onclick=e=>{
            if(graded||Object.hasOwn(locked,tile.id))return;
            ({value,pending}=selectMatchTile(value,pending,tile));feedback(e,'lesson');update();
          };
        }
      });
      firstControl=()=>tiles.find(t=>t.tile.side==='left'&&!t.b.disabled)?.b;
      clear.onclick=e=>{if(graded)return;value={...locked};pending=null;feedback(e,'lesson');update();focus(firstControl())};
      sync=()=>{
        const n=Object.keys(value).length,kept=Object.keys(locked).length;
        count.textContent='Связано: '+n+' из '+task.pairs.length+(kept?' · Подтверждено: '+kept:'');
        for(const {b,badge,tile,label} of tiles){
          const left=linkedLeftId(value,tile),pair=task.pairs.findIndex(p=>p.id===left)+1;
          const picked=pending?.side===tile.side&&pending.id===tile.id,confirmed=Object.hasOwn(locked,tile.id);
          b.setAttribute('aria-pressed',String(picked));b.toggleAttribute('data-linked',!!pair);b.disabled=!!graded||confirmed;
          b.setAttribute('aria-label',label+(pair?', пара '+pair:'')+(confirmed?', подтверждена':''));
          badge.hidden=!pair;badge.textContent=pair?String(pair):'';
          if(confirmed||graded&&pair)b.dataset.grade=confirmed||value[left]===left?'yes':'no';else delete b.dataset.grade;
        }
        labelButton(clear,kept?'Сбросить новые пары':'Сбросить');
        clear.disabled=!!graded||(n===kept&&!pending);
      };
      answers.append(hint,grid,foot);
    }else if(task.kind==='typed'){
      const lab=el('label','Слово в оригинале','lesson-field'),input=el('input');field=input;
      input.type='text';input.lang=source;input.autocomplete='off';input.autocapitalize='none';input.spellcheck=false;input.maxLength=128;
      input.setAttribute('autocorrect','off');input.enterKeyHint='done';input.placeholder='Введите слово';
      lab.append(input);answers.append(lab);firstControl=()=>input;
      input.oninput=()=>{value=input.value;update()};
      input.onkeydown=e=>{if(e.key==='Enter'&&!e.repeat&&!e.isComposing&&ready()&&!graded){e.preventDefault();check(e)}};
      sync=()=>{input.disabled=!!graded;if(graded)input.dataset.grade=graded.correct?'yes':'no';else delete input.dataset.grade};
    }else{
      if(task.kind==='cloze'){
        const quote=el('blockquote',null,'lesson-context');quote.lang=source;mark=el('mark','___');
        quote.append(document.createTextNode(task.before),mark,document.createTextNode(task.after));answers.append(quote);
      }
      const choices=el('div',null,'lesson-choices');choices.setAttribute('role','group');choices.setAttribute('aria-label','Варианты ответа');
      const buttons=task.options.map((o,i)=>{
        const b=button(null,'lesson-answer lesson-option'),n=el('span',String(i+1),'lesson-option-no');n.setAttribute('aria-hidden','true');
        b.append(n,textIn('span',o.label,task.kind==='cloze'?source:target));choices.append(b);
        b.onclick=e=>{if(graded||value===o.id)return;value=o.id;feedback(e,'lesson');update()};
        return b;
      });
      firstControl=()=>buttons[0];answers.append(choices);
      sync=()=>{
        task.options.forEach((o,i)=>{
          const b=buttons[i];b.setAttribute('aria-pressed',String(value===o.id));b.disabled=!!graded;
          if(graded&&(value===o.id || (graded.correct||revealed)&&o.id===task.correctId))b.dataset.grade=o.id===task.correctId?'yes':'no';else delete b.dataset.grade;
        });
        if(mark)mark.textContent=task.options.find(o=>o.id===(revealed?task.correctId:value))?.label||'___';
      };
    }
    function showFeedback(title,detail,outcome,symbol){
      result.dataset.outcome=outcome;
      result.replaceChildren(icon(symbol,iconMarkup),el('strong',title),detail);
      announce(title+' '+detail.textContent);
    }
    function answerDetail(){
      // Use the reviewed source sentence verbatim for the cloze. The original
      // spelling and its dictionary language stay distinct in short answers.
      if(task.kind==='cloze')return textIn('p',task.explanation,source);
      if(task.kind==='match'){
        const rows=el('p');
        for(const [i,p] of task.pairs.entries()){
          if(i)rows.append(document.createTextNode('\n'));
          rows.append(textIn('span',p.left,source),document.createTextNode(' · '),textIn('span',p.right,target));
        }
        return rows;
      }
      const word=task.kind==='typed'?doc.words.find(w=>w.language===source&&w.target===target&&w.word===task.expected):
        doc.words[Number(/^w(\d+)-/u.exec(task.id)?.[1])-1];
      if(!word)return el('p',task.explanation);
      const detail=el('p');detail.append(textIn('span',word.word,source),document.createTextNode(' · '),textIn('span',word.meaning,target));return detail;
    }
    function firstHint(){
      if(isMatch){
        const any=Object.keys(keepCorrectPairs(task,value)).length>0;
        return el('p',any?'Верные пары сохранятся. Исправьте остальные.':'Сравните слова со значениями и попробуйте связать их заново.');
      }
      if(task.kind==='typed'){
        const clue=spellingClue(task.expected,source);
        if(clue){
          const p=el('p','Первая буква: «');
          p.append(textIn('span',clue.initial,source),document.createTextNode('». Букв в слове: '+clue.letters+'.'));
          return p;
        }
        return el('p','Проверьте клавиатуру и точное написание.');
      }
      return el('p',task.kind==='cloze'?'Перечитайте фразу целиком, учитывая подсказку о значении.':'Попробуйте выбрать другое значение.');
    }
    function nextLabel(){return index+1===pages.length?'Завершить':'Дальше'}
    function check(e,unsure=false){
      if(graded||!doc||(!unsure&&!ready()))return;
      graded=gradeLearningTask(task,unsure?'':value,{source});
      if(!attempted){
        if(graded.correct){if(reviewing)reviewTry++;else firstTry++}
        else if(!reviewing)missed.add(index);
      }
      attempted=true;
      feedback(e,graded.correct?'correct':'incorrect');update();
      const head=graded.correct?'Верно!':isMatch?'Верных пар: '+Math.round(graded.score*task.pairs.length)+' из '+task.pairs.length:'Пока не так';
      showFeedback(head,graded.correct?answerDetail():firstHint(),graded.correct?'yes':'no',graded.correct?'check':'repeat');
      labelButton(cta,graded.correct?nextLabel():'Попробовать ещё раз');
      labelButton(reveal,'Показать ответ');reveal.hidden=graded.correct;cta.disabled=false;focus(cta,false);
    }
    reveal.onclick=e=>{
      if(!graded){if(canAsk)check(e,true);return}
      if(graded.correct||revealed)return;
      revealed=true;reveal.hidden=true;labelButton(cta,nextLabel());
      feedback(e,'step');update();showFeedback('Правильный ответ',answerDetail(),'shown','check');focus(cta,false);
    };
    cta.onclick=e=>{
      if(!graded){check(e);return}
      if(graded.correct||revealed){feedback(e,index+1===pages.length?'complete':'step');index++;attempted=false;draw();return}
      feedback(e,'step');
      if(isMatch){locked=keepCorrectPairs(task,value);value={...locked};pending=null}
      else if(!field)value='';
      graded=null;reveal.hidden=!canAsk;labelButton(reveal,'Не помню');labelButton(cta,'Проверить');update();
      // Keep the clue readable while the learner edits in place. In a live
      // region announce the new action separately from the previous verdict.
      const hint=result.querySelector('p');if(hint)showFeedback('Подсказка',hint,'hint','repeat');
      const editor=firstControl();focus(editor,false);if(field)field.select();
    };
    shell.append(answers,result,footer,reveal);stage.replaceChildren(shell);update();focus(prompt);
    window.scrollTo({top:0,behavior:'instant'});
  }
  game.querySelector('#lesson-exit').onclick=onExit;
  return {start,stop,refreshContact:()=>refreshContact()};
}
