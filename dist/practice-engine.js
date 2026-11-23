// Folio practice documents contain data, never templates, code, storage handles or grades.
// The Gradelyy course-v1 practice page, tasks, grading and pair interaction are
// ported from 64bb4831dd367622d1aaedaedd0d9a12777f159d. See PRACTICE-ENGINE.md.
import {shuffle} from './practice-core.js';

export const PRACTICE_VERSION = 1;
export const PRACTICE_LIMITS = Object.freeze({words:8, pages:16, options:4, candidates:240});
const {words:MAX_WORDS, pages:MAX_PAGES, options:MAX_OPTIONS} = PRACTICE_LIMITS;
const own = (r,k) => Object.prototype.hasOwnProperty.call(r,k);
const textSafe = v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(v);
const bounded = (v,max) => typeof v === 'string' && v.length <= max && !!v.trim() && textSafe(v);
const language = s => typeof s === 'string' && s.length <= 35 && /^[a-z]{2,8}(?:-[a-zA-Z0-9]{2,8})*$/u.test(s);
const sourceWord = s => bounded(s,128) && /^[\p{L}][\p{L}\p{M}]*(?:['’‘ʼ‐‑-][\p{L}][\p{L}\p{M}]*)*$/u.test(s);
const groupKey = c => c.language + ':' + c.target;
const compact = s => s.replace(/\s+/gu,' ').trim();
const wordTokens = s => s.matchAll(/[\p{L}][\p{L}\p{M}]*(?:['’‘ʼ‐‑-][\p{L}][\p{L}\p{M}]*)*/gu);
// Exact spelling: do not strip accents, punctuation within words, or Russian ё.
// Normalize keyboard variants of combining marks/apostrophes/hyphens, not typos.
function spelling(s,locale) {
  return s.trim().normalize('NFC').replace(/[‘’ʼ]/gu,"'").replace(/[‐‑]/gu,'-')
    .toLocaleLowerCase(locale).normalize('NFC');
}
// Conservative collision checks are deliberately broader than the spelling grader.
const visible = s => compact(s.normalize('NFKC').toLowerCase().replace(/ё/gu,'е')
  .replace(/[^\p{L}\p{M}\p{N}]+/gu,' '));
const sensePieces = s => [s,...s.split(/[,;|/]|\s+(?:или|or)\s+/iu)].map(visible).filter(Boolean);
const collision = (a,b) => a.head === b.head || a.head === b.term || a.term === b.head || a.term === b.term ||
  [...a.senses].some(s => b.senses.has(s));

function candidate(c) {
  if (!c || !bounded(c.id,180) || !sourceWord(c.word) || !bounded(c.meaning,240) ||
      !language(c.language) || !language(c.target)) return null;
  // A malformed language tag must never arrive at String#toLocaleLowerCase.
  try { new Intl.Locale(c.language); new Intl.Locale(c.target); } catch { return null; }
  const word = c.word, meaning = compact(c.meaning), term = visible(word);
  const head = bounded(c.head,160) ? visible(c.head) : term;
  const senses = new Set(sensePieces(meaning));
  // Folio's all-dictionary-entry alias set is deliberately not serialized into a lesson.
  if (c.meaningKeys instanceof Set || Array.isArray(c.meaningKeys)) {
    let count=0, characters=0;
    for (const s of c.meaningKeys) {
      // An unbounded polysemous or malformed entry is not a reliable short drill.
      // Reject rather than truncating unseen senses that might collide with a foil.
      if (++count > 256 || typeof s!=='string' || s.length>4000 || (characters+=s.length)>32768) return null;
      if (bounded(s,4000)) for (const k of sensePieces(s)) senses.add(k);
    }
  }
  if (!term || !head || !senses.size || senses.has(term) || senses.has(head) ||
      [...wordTokens(meaning)].some(m => visible(m[0])===term || visible(m[0])===head)) return null;
  return {id:c.id, word, meaning, language:c.language, target:c.target, term, head, senses,
    context:typeof c.context==='string' ? c.context : ''};
}

// Return a literal slice of the original, with exactly one complete saved token
// removed. No synthetic sentence, translation fragment, stem guess or regex interpolation.
export function contextBlank(context,word,locale='und') {
  if (!bounded(context,8000) || !sourceWord(word) || !language(locale)) return null;
  let segments;
  try {
    segments = typeof Intl.Segmenter==='function' ? [...new Intl.Segmenter(locale,{granularity:'sentence'}).segment(context)].map(s=>s.segment) : [context];
  } catch { return null; }
  const wanted=spelling(word,locale);
  for (let sentence of segments) {
    sentence=sentence.trim();
    if (sentence.length < 6 || sentence.length > 360) continue;
    const tokens=[...wordTokens(sentence)], match=tokens.filter(m=>spelling(m[0],locale)===wanted);
    if (tokens.length < 3 || match.length !== 1) continue;
    const m=match[0], before=sentence.slice(0,m.index), after=sentence.slice(m.index+m[0].length);
    return {before,after,surface:m[0]};
  }
  return null;
}

function compatible(focus,cards) {
  const picked=[focus];
  for (const c of cards) if (!picked.some(p=>collision(p,c))) {
    picked.push(c); if (picked.length===MAX_OPTIONS) break;
  }
  return picked;
}
function bestMatch(cards) {
  let best=[];
  for (const c of cards) {
    const set=compatible(c,cards); if (set.length>best.length) best=set;
    if (best.length===MAX_OPTIONS) break;
  }
  return best;
}
function safeTypedCue(c,group) {
  const base='Какое сохранённое слово соответствует значению «'+c.meaning+'»?';
  const related=group.filter(x=>x!==c && collision(c,x));
  if (!related.length && c.head===c.term) return base;
  // Inflections can share a lemma, and distinct saved words can share senses.
  // Cue the stored form, not "the only translation". Reveal just enough letters
  // to disambiguate within the candidate pool, while leaving something to recall.
  const units=x=>Array.from(spelling(x.word,c.language));
  const chars=units(c), peers=related.map(units).filter(v=>v.length===chars.length);
  if (chars.length < 2) return related.length ? null : base;
  const keep=new Set();
  for (const other of peers) {
    if ([...keep].some(i=>chars[i]!==other[i])) continue;
    const i=chars.findIndex((l,i)=>l!==other[i]);
    if (i < 0) return null;
    keep.add(i);
  }
  if (!keep.size) keep.add(0);
  if (keep.size>=chars.length) return null;
  return base+'\nФорма из книги: '+chars.map((ch,i)=>keep.has(i)||/^['-]$/u.test(ch)?ch:'_').join(' ') + '.';
}
const focusIndex = id => Number(/^w([1-8])-(?:choice|match|cloze|typed)$/u.exec(id)?.[1])-1;
export function taskLanguages(doc,task) {
  const w=doc?.words?.[focusIndex(task?.id)];
  return {source:w?.language || 'und',target:w?.target || 'und'};
}

// A Folio lesson is ephemeral. Accept only cards obtained from saved vocabulary
// and the active dictionary; input selection is an allowlist, not a preference.
export function buildPracticeLesson(cards,{random=Math.random,selectedIds,preservePriority=false}={}) {
  if (!Array.isArray(cards) || typeof random!=='function') return null;
  if (selectedIds !== undefined && !(Array.isArray(selectedIds) || selectedIds instanceof Set)) return null;
  const selected=selectedIds===undefined?null:new Set(selectedIds);
  const pool=[], ids=new Set(), forms=new Set();
  let checked=0;
  for (const input of cards) {
    if (selected && !selected.has(input?.id)) continue;
    if (++checked>PRACTICE_LIMITS.candidates) break;
    const c=candidate(input);
    if (!c || ids.has(c.id)) continue;
    const form=groupKey(c)+'|'+spelling(c.word,c.language);
    if (forms.has(form)) continue;
    ids.add(c.id); forms.add(form); pool.push(c);
  }
  const picked=shuffle(preservePriority?pool.slice(0,MAX_WORDS):pool,random).slice(0,MAX_WORDS);
  if (!picked.length) return null;
  const groups=new Map(), pages=[], words=[];
  for (const c of picked) {
    const key=groupKey(c);
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(c);
  }
  // Plan coverage per language pair. All available words get an actual task,
  // not merely a distractor. Only a genuinely impossible one-letter ambiguity
  // without a separate usable option may be omitted.
  const usedWords=new Set(), drafts=[];
  const draft=(focus,members,kind,title,fields)=>{
    drafts.push({focus,kind,title,fields}); for (const c of members) usedWords.add(c);
  };
  for (const [groupId,group] of groups) {
    const covered=new Set(), siblings=pool.filter(c=>groupKey(c)===groupId);
    const optionsFor=(cards,correct,label) => {
      const choices=shuffle(cards,random).map((card,i)=>({card,id:'o'+(i+1),label:label(card)}));
      return {options:choices.map(({id,label})=>({id,label})),correctId:choices.find(o=>o.card===correct).id};
    };
    const explanation=c=>'В вашем словаре: '+c.word+' · '+c.meaning+'.';
    const match=bestMatch(group), possible=match.length>=2;
    if (possible) {
      const focus=group.find(c=>!match.includes(c) && compatible(c,group).length>=2) || match[0];
      const alternatives=compatible(focus,group);
      draft(focus,alternatives,'choice','Выберите значение',{prompt:'Какое значение у слова «'+focus.word+'»?',
        explanation:explanation(focus),...optionsFor(alternatives,focus,c=>c.meaning)});
      covered.add(focus);
      // Vary pair IDs independently of left order: otherwise the upstream stable
      // hash would show exactly the same positional answer in every session.
      const pairIds=shuffle(match.map((_,i)=>'p'+(i+1)),random);
      draft(match[0],match,'match','Соедините пары',{prompt:'Соедините каждое слово с его словарным значением.',
        explanation:match.map(c=>c.word+' · '+c.meaning).join('\n'),
        pairs:match.map((c,i)=>({id:pairIds[i],left:c.word,right:c.meaning}))});
      match.forEach(c=>covered.add(c));
      // Prefer a fresh target. A gloss clue also disambiguates other words that
      // might grammatically fit a gap; we ask which word appeared in the book.
      const order=[...group].sort((a,b)=>Number(covered.has(a))-Number(covered.has(b)));
      for (const c of order) {
        const blank=contextBlank(c.context,c.word,c.language), alternatives=compatible(c,group);
        if (!blank || alternatives.length<2) continue;
        const initialCap=blank.surface[0]!==blank.surface[0].toLocaleLowerCase(c.language);
        const label=x=>x===c ? blank.surface : initialCap ? x.word[0].toLocaleUpperCase(c.language)+x.word.slice(1) : x.word;
        draft(c,alternatives,'cloze','Восстановите фразу',{prompt:'Какое слово было в этой фразе? Значение: «'+c.meaning+'».',
          explanation:blank.before+blank.surface+blank.after,before:blank.before,after:blank.after,...optionsFor(alternatives,c,label)});
        covered.add(c); break;
      }
    }
    const remaining=group.filter(c=>!covered.has(c));
    // End with retrieval. If all were tested by matching, pick a different
    // word than the most recent focus when possible.
    const typedTargets=remaining.length?remaining:[...group].sort((a,b)=>
      Number(a===drafts.at(-1)?.focus)-Number(b===drafts.at(-1)?.focus));
    for (const c of typedTargets) {
      const prompt=safeTypedCue(c,siblings);
      if (prompt) {
        draft(c,[c],'typed','Вспомните слово',{prompt,explanation:explanation(c),expected:c.word});
        if (!remaining.length) break;
      } else if (!covered.has(c) && compatible(c,group).length>=2) {
        const alternatives=compatible(c,group);
        draft(c,alternatives,'choice','Выберите значение',{prompt:'Какое значение у слова «'+c.word+'»?',
          explanation:explanation(c),...optionsFor(alternatives,c,x=>x.meaning)});
      }
    }
  }
  if (!drafts.length) return null;
  const subjects=picked.filter(c=>usedWords.has(c));
  for (const {id,word,meaning,language,target} of subjects) words.push({id,word,meaning,language,target});
  for (const {focus,kind,title,fields} of drafts) {
    const id='w'+(subjects.indexOf(focus)+1)+'-'+kind;
    pages.push({kind:'practice',id:'page-'+(pages.length+1),title,task:{id,kind,...fields}});
  }
  return validatePracticeLesson({format:'folio.practice',schemaVersion:PRACTICE_VERSION,words,pages});
}

function invalid(path) { throw new TypeError('Invalid practice lesson: '+path); }
function row(v,path,required) {
  if (!v || typeof v!=='object' || Array.isArray(v) ||
      !(Object.getPrototypeOf(v)===null || Object.getPrototypeOf(Object.getPrototypeOf(v))===null)) invalid(path);
  const keys=required.split(' ');
  if (Object.keys(v).length!==keys.length || keys.some(k=>!own(v,k))) invalid(path+' fields');
}
function list(v,path,min,max) {
  if (!Array.isArray(v)||v.length<min||v.length>max) invalid(path);
  for (let i=0;i<v.length;i++) if (!own(v,i)) invalid(path+' sparse');
  return v;
}
function uniqueId(v,set,path) {
  if (!bounded(v,80) || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(v) || (v in Object.prototype) || set.has(v)) invalid(path);
  set.add(v);
}
// Closed v1 validator, adapted from Gradelyy's course-format.ts with tighter
// Folio text/list budgets, pair-language checks, and option-to-vocabulary binding.
export function validatePracticeLesson(doc) {
  row(doc,'root','format schemaVersion words pages');
  if (doc.format!=='folio.practice'||doc.schemaVersion!==PRACTICE_VERSION) invalid('version');
  const ids=new Set(), forms=new Set();
  for (const w of list(doc.words,'words',1,MAX_WORDS)) {
    row(w,'word','id word meaning language target');
    if (!bounded(w.id,180)||ids.has(w.id)||!sourceWord(w.word)||!bounded(w.meaning,240)||
        !language(w.language)||!language(w.target)) invalid('word');
    try { new Intl.Locale(w.language);new Intl.Locale(w.target); } catch { invalid('word language'); }
    const form=groupKey(w)+'|'+spelling(w.word,w.language);
    if (forms.has(form)) invalid('duplicate word');
    ids.add(w.id);forms.add(form);
  }
  const pageIds=new Set(),taskIds=new Set();
  for (const p of list(doc.pages,'pages',1,MAX_PAGES)) {
    row(p,'page','kind id title task'); uniqueId(p.id,pageIds,'page id');
    if (p.kind!=='practice'||!bounded(p.title,100)) invalid('page');
    const t=p.task, base='kind id prompt explanation';
    if (!t || !['choice','cloze','match','typed'].includes(t.kind)) invalid('task kind');
    const suffix=t.kind==='match'?'pairs':t.kind==='typed'?'expected':t.kind==='cloze'?'options correctId before after':'options correctId';
    row(t,'task',base+' '+suffix); uniqueId(t.id,taskIds,'task id');
    const focus=doc.words[focusIndex(t.id)];
    if (!focus || !t.id.endsWith('-'+t.kind)||!bounded(t.prompt,640)||!bounded(t.explanation,1800)) invalid('task');
    const group=doc.words.filter(w=>groupKey(w)===groupKey(focus));
    if (t.kind==='typed') {
      if (t.expected!==focus.word) invalid('typed expected');
    } else if (t.kind==='match') {
      const ps=new Set(),ls=new Set(),rs=new Set();
      for (const pair of list(t.pairs,'pairs',2,MAX_OPTIONS)) {
        row(pair,'pair','id left right');uniqueId(pair.id,ps,'pair id');
        if (!bounded(pair.left,128)||!bounded(pair.right,240)||ls.has(visible(pair.left))||rs.has(visible(pair.right))||
            !group.some(w=>w.word===pair.left && w.meaning===pair.right)) invalid('pair labels');
        ls.add(visible(pair.left));rs.add(visible(pair.right));
      }
      if (!t.pairs.some(p=>p.left===focus.word && p.right===focus.meaning)) invalid('match focus');
    } else {
      const os=new Set(),labels=new Set(),choice=t.kind==='choice';
      const represents=(o,w)=>choice?o.label===w.meaning:spelling(o.label,focus.language)===spelling(w.word,focus.language);
      for (const opt of list(t.options,'options',2,MAX_OPTIONS)) {
        row(opt,'option','id label');uniqueId(opt.id,os,'option id');
        if (!bounded(opt.label,240)||labels.has(visible(opt.label))||!group.some(w=>represents(opt,w))) invalid('option label');
        labels.add(visible(opt.label));
      }
      if (!t.options.some(o=>o.id===t.correctId && represents(o,focus))) invalid('correct option');
      if (!choice) {
        if ([t.before,t.after].some(s=>typeof s!=='string'||s.length>360||!textSafe(s)) || !(t.before+t.after).trim()) invalid('cloze context');
        const surface=t.options.find(o=>o.id===t.correctId).label;
        const checked=contextBlank(t.before+surface+t.after,focus.word,focus.language);
        if (!checked || checked.before!==t.before || checked.after!==t.after) invalid('cloze anchor');
      }
    }
  }
  return doc;
}

// Gradelyy lib/school-learning.ts: choice/cloze and match grading are the same
// algorithm, including partial match scores and rejection of extra answer keys.
export function gradeLearningTask(task,answer,{source='und'}={}) {
  switch(task?.kind) {
    case 'cloze':
    case 'choice': {
      const correct=typeof answer==='string' && answer===task.correctId && task.options.some(option=>option.id===answer);
      return {correct,score:Number(correct)};
    }
    case 'match': {
      if (!answer || typeof answer!=='object' || Array.isArray(answer) || task.pairs.length===0) return {correct:false,score:0};
      const correctCount=task.pairs.filter(pair=>own(answer,pair.id) && answer[pair.id]===pair.id).length;
      const score=correctCount/task.pairs.length;
      return {correct:score===1 && Object.keys(answer).length===task.pairs.length,score};
    }
    case 'typed': {
      const correct=sourceWord(task.expected) && bounded(answer,256) && spelling(answer,source)===spelling(task.expected,source);
      return {correct,score:Number(correct)};
    }
    default:return {correct:false,score:0};
  }
}

// Direct JavaScript port of Gradelyy lib/lesson-match-pairs.ts. Choices are
// editable links; one end cannot belong to two pairs. Only Check grades them.
export function linkedLeftId(value,tile) {
  return tile.side==='left' ? own(value,tile.id)?tile.id:undefined : Object.keys(value).find(leftId=>value[leftId]===tile.id);
}
export function selectMatchTile(value,pending,tile) {
  const linked=linkedLeftId(value,tile);
  if (linked!==undefined) {
    const next={...value}; delete next[linked]; return {value:next,pending:tile};
  }
  if (!pending || pending.side===tile.side || linkedLeftId(value,pending)!==undefined) {
    return {value,pending:pending?.side===tile.side && pending.id===tile.id?null:tile};
  }
  const left=tile.side==='left'?tile:pending, right=tile.side==='right'?tile:pending;
  return {value:{...value,[left.id]:right.id},pending:null};
}
export function orderMatchTiles(pairs) {
  function key(id) {
    let hash=2166136261;
    for (let i=0;i<id.length;i++) hash=Math.imul(hash^id.charCodeAt(i),16777619);
    hash^=hash>>>16; hash=Math.imul(hash,0x45d9f3b);
    return (hash^(hash>>>16))>>>0;
  }
  const result=pairs.map(pair=>({pair,hash:key(pair.id)})).sort((a,b)=>a.hash-b.hash).map(({pair})=>pair);
  if (result.length>1 && result.every((pair,index)=>pair===pairs[index])) {
    const [first,...rest]=result; return [...rest,first];
  }
  return result;
}

// Session-only recovery helpers. A guided correction or retry never updates
// the spaced-review ledger. Never mutate a lesson document or submitted answer.

export function keepCorrectPairs(task, answer) {
  if (task?.kind!=='match' || !answer || typeof answer!=='object') return {};
  return Object.fromEntries(task.pairs.filter(p=>Object.hasOwn(answer,p.id)&&answer[p.id]===p.id)
    .map(p=>[p.id,p.id]));
}

export function spellingClue(word, language) {
  if (typeof word!=='string') return null;
  const normalized=word.normalize('NFC');
  let parts=Array.from(normalized);
  // Use graphemes so a decomposed accent or a conjunct is not counted twice.
  if (typeof Intl.Segmenter==='function') {
    try {parts=Array.from(new Intl.Segmenter(language,{granularity:'grapheme'}).segment(normalized),x=>x.segment)} catch {}
  }
  const letters=parts.filter(p=>/\p{L}/u.test(p));
  if (letters.length<2) return null; // A hint must not reveal a one-letter answer.
  return {initial:letters[0],letters:letters.length};
}

export function missedPracticePages(pages, missed, random=Math.random) {
  // Review only missed steps, in original order. For a choice, guarantee a
  // different correct position so recalling a button location won't suffice.
  return pages.flatMap((page,i)=>{
    if (!missed.has(i)) return [];
    const {task}=page;
    if (task.kind==='match') {
      const pairs=shuffle(task.pairs,random);
      if(pairs.every((p,j)=>p===task.pairs[j])) pairs.push(pairs.shift());
      return [{...page,task:{...task,pairs}}];
    }
    if (task.kind!=='choice'&&task.kind!=='cloze') return [page];
    const options=shuffle(task.options,random),before=task.options.findIndex(o=>o.id===task.correctId);
    if(options[before].id===task.correctId) options.push(options.shift());
    return [{...page,task:{...task,options}}];
  });
}
