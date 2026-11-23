// IDs are serialized in Folio v1 backups. Keep old identifiers readable.
const row=(label,group)=>Object.freeze({label,group});
export const READING_FONTS=Object.freeze({
  'noto-serif':row('Noto Serif','serif'),
  'noto-serif-display':row('Noto Serif Display','serif'),
  'dejavu-serif':row('DejaVu Serif','serif'),
  'dejavu-serif-condensed':row('DejaVu Serif Condensed','serif'),
  'inter':row('Inter','sans-serif'),
  'open-sans':row('Open Sans','sans-serif'),
  'noto-sans':row('Noto Sans','sans-serif'),
  'dejavu-sans':row('DejaVu Sans','sans-serif'),
  'noto-sans-display':row('Noto Sans Display','sans-serif'),
  'noto-sans-mono':row('Noto Sans Mono','monospace'),
});
export const DEFAULT_READING_FONT='noto-serif';
export function normalizeReadingFont(value) {
  if(value==='sans')return 'inter';
  if(typeof value==='string'&&Object.hasOwn(READING_FONTS,value))return value;
  // Includes pre-v15 "serif", absent preferences, and older clients' defaults.
  return DEFAULT_READING_FONT;
}
export function readingFontStack(value) {
  const {label,group}=READING_FONTS[normalizeReadingFont(value)];
  return `"${label}", ${group==='serif'?'"Georgia", "Times New Roman", ':group==='sans-serif'?'system-ui, ':''}${group}`;
}
export function populateReadingFontPicker(select) {
  const doc=select.ownerDocument;
  const groups=new Map([['serif','С засечками'],['sans-serif','Без засечек'],['monospace','Моноширинный']].map(([key,label])=>{
    const group=doc.createElement('optgroup');group.label=label;return [key,group];
  }));
  for(const [value,{label,group}] of Object.entries(READING_FONTS)){
    const option=doc.createElement('option');option.value=value;option.textContent=label;groups.get(group).append(option);
  }
  select.replaceChildren(...groups.values());
}
