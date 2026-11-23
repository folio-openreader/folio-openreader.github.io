// Build a bounded excerpt around the selected reader token. This does not send anything.
const CONTEXT_LIMIT=480, TOKEN_LIMIT=80;
const LANG=/^[a-z]{2,8}(?:-[a-z0-9]{2,8}){0,4}$/i;
function clipUtf16(text,start,end){
  // Do not leave lone surrogate code units when shortening a passage.
  if(start>0&&/[\uDC00-\uDFFF]/u.test(text.charAt(start)))start++;
  if(end<text.length&&/[\uD800-\uDBFF]/u.test(text.charAt(end-1)))end--;
  return text.slice(start,end).trim();
}
export function buildReadingHint({text,token,offset,sourceLanguage,targetLanguage}={}){
  if(typeof token!=='string'||!token.trim()||token.length>TOKEN_LIMIT||typeof text!=='string'||!Number.isSafeInteger(offset)||offset<0||text.slice(offset,offset+token.length)!==token)return null;
  let left=Math.max(0,offset-180),right=Math.min(text.length,left+CONTEXT_LIMIT);
  if(right<offset+token.length){right=Math.min(text.length,offset+token.length);left=Math.max(0,right-CONTEXT_LIMIT)}
  const sample=clipUtf16(text,left,right);
  const safeLang=tag=>typeof tag==='string'&&LANG.test(tag)?tag:'und';
  return {token,excerpt:sample,sourceLanguage:safeLang(sourceLanguage),targetLanguage:safeLang(targetLanguage)};
}
