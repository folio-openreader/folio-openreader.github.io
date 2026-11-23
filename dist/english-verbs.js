// Folio-authored starter morphology and glosses, not a sentence translator.
// One row per lemma. Never add these forms to the user's saved vocabulary.
const rows=[
  ['be','am is are was were been being','быть; находиться','to exist, be present, or have a particular state'],
  ['have','has had having','иметь; обладать','to possess, hold, or experience something'],
  ['do','does did done doing','делать; выполнять','to perform an activity or task'],
  ['go','goes went gone going','идти; ехать; уходить','to move or travel somewhere'],
  ['come','came coming','приходить; приезжать','to move toward a person or place'],
  ['get','got gotten getting','получать; становиться','to obtain something or enter a new state'],
  ['make','made making','делать; создавать','to create or produce something'],
  ['take','took taken taking','брать; забирать','to get hold of something or carry it away'],
  ['give','gave given giving','давать; передавать','to transfer something to another person'],
  ['see','saw seen seeing','видеть; замечать','to perceive something with the eyes'],
  ['say','says said saying','говорить; сказать','to express something in words'],
  ['tell','told telling','рассказывать; сообщать','to give information to someone in words'],
  ['know','knew known knowing','знать','to be aware of a fact or familiar with something'],
  ['think','thought thinking','думать; считать','to use the mind or hold an opinion'],
  ['find','found finding','находить; обнаруживать','to discover something or learn where it is'],
  ['leave','left leaving','уходить; оставлять','to go away or let something remain'],
  ['feel','felt feeling','чувствовать; ощущать','to experience a sensation or emotion'],
  ['hear','heard hearing','слышать','to perceive sounds'],
  ['speak','spoke spoken speaking','говорить; разговаривать','to use the voice to express words'],
  ['hold','held holding','держать; удерживать','to keep something in your hand or in position'],
  ['keep','kept keeping','хранить; сохранять','to continue to have or retain something'],
  ['bring','brought bringing','приносить; привозить','to carry something to a person or place'],
  ['buy','bought buying','покупать','to obtain something by paying for it'],
  ['sell','sold selling','продавать','to exchange something for money'],
  ['eat','ate eaten eating','есть; кушать','to consume food'],
  ['drink','drank drunk drinking','пить','to consume liquid'],
  ['drive','drove driven driving','водить; вести машину','to operate a vehicle'],
  ['run','ran running','бежать; бегать','to move quickly on foot'],
  ['sit','sat sitting','сидеть; садиться','to rest with your weight supported by a seat'],
  ['stand','stood standing','стоять; вставать','to be upright on your feet'],
  ['write','wrote written writing','писать','to form words or compose a text'],
  ['read','reading','читать','to understand written text'],
  ['sleep','slept sleeping','спать','to rest in the state of sleep'],
  ['wake','woke woken waking','просыпаться; будить','to stop sleeping or make someone stop sleeping'],
  ['fall','fell fallen falling','падать','to move downward without support'],
  ['begin','began begun beginning','начинать','to start doing or happening'],
  ['break','broke broken breaking','ломать; разбивать','to cause something to come apart or stop working'],
  ['choose','chose chosen choosing','выбирать','to select one possibility from several'],
  ['lose','lost losing','терять; проигрывать','to stop having something or fail to win'],
  ['meet','met meeting','встречать; знакомиться','to come together with another person'],
  ['pay','paid paying','платить','to give money in exchange for something'],
  ['send','sent sending','отправлять; посылать','to cause something to go to another place'],
  ['understand','understood understanding','понимать','to grasp the meaning of something'],
  ['wear','wore worn wearing','носить одежду; быть одетым','to have clothing or an accessory on your body'],
  ['win','won winning','побеждать; выигрывать','to succeed in a game or competition'],
];
const definitions=new Map(), forms=new Map();
for(const [head,variants,ru,en] of rows){
  definitions.set(head,Object.freeze({ru,en}));
  for(const form of variants.split(' ')){
    const heads=forms.get(form)||[];
    if(!heads.includes(head))heads.push(head);
    forms.set(form,heads);
  }
}
export const commonEnglishVerb = head=>definitions.get(head)||null;
export const commonEnglishBaseForms = surface=>[...(forms.get(surface)||[])];

// Common alternative readings where a surface form is also a different word.
// Keep them alongside the verb alias. Do not guess which sense a sentence uses.
const homographs=new Map([
  ['saw',['пила','a tool with a toothed edge for cutting','noun']],
  ['left',['левый; левая сторона','on or relating to the side opposite the right','adjective']],
  ['found',['основывать; учреждать','to start an institution or organization','verb']],
  ['thought',['мысль; размышление','an idea or something considered in the mind','noun']],
  ['felt',['войлок; фетр','a dense fabric made by pressing fibers together','noun']],
  ['drunk',['пьяный','affected by alcohol','adjective']],
  ['fell',['рубить; валить','to cut down a tree','verb']],
]);
export const commonEnglishHomograph = surface=>homographs.get(surface)||null;
