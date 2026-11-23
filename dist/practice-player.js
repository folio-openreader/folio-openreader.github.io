// Vanilla adapter for Gradelyy's authored practice pages. All answers live in this
// view; only Folio's separate spaced-review action changes the learning ledger.
import {lessonCheckContact} from './lesson-contact.js';
import {gradeLearningTask,orderMatchTiles,selectMatchTile,linkedLeftId,taskLanguages} from './practice-engine.js';

function el(tag,text,cls){
  const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;
}
function button(label,cls){const n=el('button',label,cls);n.type='button';return n}
const textIn=(tag,text,lang,cls)=>{const n=el(tag,text,cls);if(lang)n.lang=lang;return n};
const focus=(n)=>n?.focus({preventScroll:true});
const kinds={choice:'Выбор значения',match:'Пары',cloze:'Слово в контексте',typed:'Написание'};
function icon(name,markup){const n=el('i',null,'icon-glyph');n.innerHTML=markup(name);return n}

export function practicePlayer({game,feedback,iconMarkup,onExit,onAgain,allowNativeCheck=()=>false}){
  const stage=game.querySelector('#lesson-stage'),meter=game.querySelector('progress'),position=game.querySelector('#lesson-progress');
  let doc=null,index=0,firstTry=0,attempted=false,subsetNote='',refreshContact=()=>{};
  function stop(){
    doc=null;refreshContact=()=>{};stage.replaceChildren();game.hidden=true;
  }
  function start(lesson,{scopeNote=''}={}){
    doc=lesson;index=0;firstTry=0;attempted=false;subsetNote=scopeNote;game.hidden=false;draw();
  }
  function setMeter(value){
    meter.max=doc.pages.length;meter.value=value;
    position.textContent=(index<doc.pages.length?index+1:index)+' / '+doc.pages.length;
  }
  function finish(){
    refreshContact=()=>{};setMeter(doc.pages.length);
    const done=el('div',null,'lesson-finish'),mark=el('span',null,'lesson-win');
    mark.append(icon('check',iconMarkup));
    const heading=el('h2','Серия завершена');heading.tabIndex=-1;
    const note=el('p','С первого раза: '+firstTry+' из '+doc.pages.length+'.','lesson-finish-score');
    const words=el('div',null,'lesson-chips');words.setAttribute('aria-label','Слова этой серии');
    for(const w of doc.words)words.append(textIn('span',w.word,w.language));
    const again=button('Новая серия','primary lesson-primary'),back=button('К упражнениям','quiet');
    again.id='lesson-again';again.onclick=onAgain;back.onclick=onExit;
    done.append(mark,heading,note,words,again,back);stage.replaceChildren(done);focus(heading);
    window.scrollTo({top:0,behavior:'instant'});
  }
  function draw(){
    if(!doc)return;
    if(index>=doc.pages.length){finish();return}
    const {task}=doc.pages[index],{source,target}=taskLanguages(doc,task),isMatch=task.kind==='match';
    setMeter(index);stage.dataset.kind=task.kind;
    const shell=el('article',null,'lesson-task'),type=el('p',kinds[task.kind]||'Упражнение','lesson-kicker');
    const prompt=el('h2',task.prompt,'lesson-prompt');prompt.tabIndex=-1;prompt.id='lesson-prompt';
    shell.setAttribute('aria-labelledby',prompt.id);shell.append(type,prompt);
    if(index===0&&subsetNote)shell.append(el('p',subsetNote,'lesson-source-note'));
    const answers=el('div',null,'lesson-answers');
    const result=el('div',null,'lesson-verdict');result.setAttribute('role','status');result.setAttribute('aria-atomic','true');
    const cta=button('Проверить','primary lesson-primary'),footer=el('div',null,'lesson-task-footer');
    cta.id='lesson-check';cta.disabled=true;footer.append(cta);
    let value=isMatch?{}:'',pending=null,graded=null,mark=null;
    let sync=()=>{},firstControl=null;
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
            if(graded)return;
            ({value,pending}=selectMatchTile(value,pending,tile));feedback(e,'lesson');update();
          };
        }
      });
      firstControl=tiles[0]?.b;
      clear.onclick=e=>{if(graded)return;value={};pending=null;feedback(e,'lesson');update();focus(firstControl)};
      sync=()=>{
        const n=Object.keys(value).length;
        count.textContent='Связано: '+n+' из '+task.pairs.length;
        for(const {b,badge,tile,label} of tiles){
          const left=linkedLeftId(value,tile),pair=task.pairs.findIndex(p=>p.id===left)+1;
          const picked=pending?.side===tile.side&&pending.id===tile.id;
          b.setAttribute('aria-pressed',String(picked));b.toggleAttribute('data-linked',!!pair);b.disabled=!!graded;
          b.setAttribute('aria-label',label+(pair?', пара '+pair:''));
          badge.hidden=!pair;badge.textContent=pair?String(pair):'';
          if(graded&&pair)b.dataset.grade=value[left]===left?'yes':'no';else delete b.dataset.grade;
        }
        clear.disabled=!!graded||(!n&&!pending);
      };
      answers.append(hint,grid,foot);
    }else if(task.kind==='typed'){
      const lab=el('label','Слово в оригинале','lesson-field'),input=el('input');
      input.type='text';input.lang=source;input.autocomplete='off';input.autocapitalize='none';input.spellcheck=false;input.maxLength=128;
      input.setAttribute('autocorrect','off');input.enterKeyHint='done';input.placeholder='Введите слово';
      lab.append(input);answers.append(lab);firstControl=input;
      input.oninput=()=>{value=input.value;update()};
      input.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&ready()&&!graded){e.preventDefault();check(e)}};
      sync=()=>{input.disabled=!!graded;if(graded)input.dataset.grade=graded.correct?'yes':'no'};
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
      firstControl=buttons[0];answers.append(choices);
      sync=()=>{
        task.options.forEach((o,i)=>{
          const b=buttons[i];b.setAttribute('aria-pressed',String(value===o.id));b.disabled=!!graded;
          if(graded&&(o.id===task.correctId||value===o.id))b.dataset.grade=o.id===task.correctId?'yes':'no';else delete b.dataset.grade;
        });
        if(mark)mark.textContent=task.options.find(o=>o.id===value)?.label||'___';
      };
    }
    function check(e){
      if(!ready()||graded||!doc)return;
      graded=gradeLearningTask(task,value,{source});if(!attempted&&graded.correct)firstTry++;attempted=true;
      feedback(e,graded.correct?'correct':'incorrect');update();
      const head=el('strong',graded.correct?'Верно!':isMatch?'Верных пар: '+Math.round(graded.score*task.pairs.length)+' из '+task.pairs.length:'Пока не так'),detail=el('p',task.explanation);
      result.dataset.outcome=graded.correct?'yes':'no';result.replaceChildren(icon(graded.correct?'check':'repeat',iconMarkup),head,detail);
      cta.textContent=graded.correct?(index+1===doc.pages.length?'Завершить':'Дальше'):'Попробовать ещё раз';
      cta.disabled=false;focus(cta);
    }
    cta.onclick=e=>{
      if(!graded){check(e);return}
      if(graded.correct){feedback(e,index+1===doc.pages.length?'complete':'step');index++;attempted=false;draw()}
      else{feedback(e,'step');draw()}
    };
    shell.append(answers,result,footer);stage.replaceChildren(shell);update();focus(prompt);
    window.scrollTo({top:0,behavior:'instant'});
  }
  game.querySelector('#lesson-exit').onclick=onExit;
  return {start,stop,refreshContact:()=>refreshContact()};
}
