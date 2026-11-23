// Model IDs are fixed local asset names. The displayed source language is
// independent of the OCR layout variant (Japanese horizontal vs. vertical).
export const COMIC_OCR_OPTIONS=Object.freeze({
  eng:Object.freeze({tag:'en',label:'Английский'}),
  jpn:Object.freeze({tag:'ja',label:'Японский'}),
  jpn_vert:Object.freeze({tag:'ja',label:'Японский · вертикальный'}),
  kor:Object.freeze({tag:'ko',label:'Корейский'}),
  rus:Object.freeze({tag:'ru',label:'Русский'}),
  kaz:Object.freeze({tag:'kk',label:'Казахский'}),
});
export const COMIC_OCR_LANGUAGES=Object.freeze(Object.keys(COMIC_OCR_OPTIONS));
const hasModel=value=>Object.hasOwn(COMIC_OCR_OPTIONS,value);
export function comicPageModel(book,index) {
  const model=book?.chapters?.[index]?.ocrLanguage;
  return hasModel(model)?model:hasModel(book?.ocrLanguage)?book.ocrLanguage:'eng';
}
export function comicModelTag(model){return hasModel(model)?COMIC_OCR_OPTIONS[model].tag:'en'}
