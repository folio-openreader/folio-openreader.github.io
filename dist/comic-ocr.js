// Comic OCR stays in the browser. The selected, fixed local model is the only
// language asset requested. Original page Blobs never enter a network request.
import { check, canvasAt, ocrSession } from './ocr-engine.js';
import { comicImageHeader, COMIC_LIMITS as L } from './comic-import.js';
import { COMIC_OCR_LANGUAGES } from './comic-languages.js';
export { COMIC_OCR_LANGUAGES };
const PAGE_WORDS=5000, PAGE_PARAGRAPHS=2000, PAGE_CHARS=160_000;
const lexical=/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’‐‑-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
const clean=s=>s.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,'').trim();
const tooDense=()=>new Error('На странице слишком много текста. Разделите её на части.');
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const japanese=lang=>lang==='jpn'||lang==='jpn_vert';
let jpSegmenter;
function tokens(line,lang){
  if(japanese(lang)&&typeof Intl.Segmenter==='function'){
    jpSegmenter??=new Intl.Segmenter('ja',{granularity:'word'});
    return Array.from(jpSegmenter.segment(line))
      .filter(i=>i.isWordLike).map(i=>({text:i.segment,offset:i.index}));
  }
  return Array.from(line.matchAll(lexical),m=>({text:m[0],offset:m.index}));
}
// Keep horizontal resolution on tall webtoons: recognize overlapping strips
// serially and take a word from the strip that owns its centre, not both strips.
export function comicOCRTiles(width,height){
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||!(width>0&&height>0)||width>L.side||height>L.side||width*height>L.imagePixels)throw new Error('Недопустимый размер страницы.');
  const scale=Math.min(1.6,Math.max(1,1200/width),2400/width);
  const w=Math.max(1,Math.floor(width*scale));
  const maxH=Math.max(1,Math.floor(Math.min(2600,4_000_000/w)/scale));
  const pad=Math.min(100,Math.floor(maxH/12)), count=height<=maxH?1:Math.ceil(height/(maxH-2*pad));
  return Array.from({length:count},(_,i)=>{
    const coreTop=Math.floor(i*height/count),coreEnd=Math.floor((i+1)*height/count);
    const top=Math.max(0,coreTop-pad),end=Math.min(height,coreEnd+pad),h=Math.max(1,Math.floor((end-top)*scale));
    return {top,end,coreTop,coreEnd,w,h,fullHeight:height};
  });
}
// A TSV coordinate describes a recognized fragment, not necessarily one word.
// In particular, Japanese often has several OCR fragments per linguistic word.
// Segment a full line, then map its actual UTF-16 ranges back onto its boxes.
export function comicTSVLayout(tsv,tile,language,plain=''){
  const {top,end,coreTop,coreEnd,h,w,fullHeight}=tile,groups=new Map();
  let cursor=0;
  if(typeof tsv!=='string'||tsv.length>5_000_000)throw tooDense();
  let seen=0,chars=0;
  for(const row of tsv.split('\n')){
    const f=row.split('\t');
    if(f[0]!=='5'||f.length<12)continue;
    let [x0,y0,dx,dy,conf]=f.slice(6,11).map(Number);
    if(![x0,y0,dx,dy,conf].every(Number.isFinite)||dx<=0||dy<=0||conf<12)continue;
    const text=clean(f.slice(11).join(' '));if(!text||text.length>512)continue;
    // Undo the 90° counterclockwise pass for top-to-bottom Japanese.
    if(language==='jpn_vert')[x0,y0,dx,dy]=[w-y0-dy,x0,dy,dx];
    const a=clamp(x0/w,0,1),b=clamp((x0+dx)/w,0,1);
    const c=top+clamp(y0/h,0,1)*(end-top), d=top+clamp((y0+dy)/h,0,1)*(end-top);
    if(a>=b||c>=d||(c+d)/2<coreTop||(c+d)/2>=coreEnd)continue;
    if(++seen>10_000||(chars+=text.length+1)>PAGE_CHARS)throw tooDense();
    const key=f.slice(1,4).join('.'),line=f[4];
    if(!groups.has(key)){
      if(groups.size>=PAGE_PARAGRAPHS)throw tooDense();
      groups.set(key,new Map());
    }
    const lines=groups.get(key);
    if(!lines.has(line))lines.set(line,[]);
    let spaceBefore=null;
    if(language==='kor'&&plain){
      // Bounded local re-sync permits dropped low-confidence fragments.
      // Ignore the hint rather than fabricate a boundary on a mismatch.
      const j=plain.slice(cursor,cursor+1024).indexOf(text);
      if(j>=0){const at=cursor+j;spaceBefore=at>0&&/\s/u.test(plain[at-1]);cursor=at+text.length;}
    }
    lines.get(line).push({text,spaceBefore,x:a,y:c/fullHeight,w:b-a,h:(d-c)/fullHeight});
  }
  const paragraphs=[],words=[];
  for(const lines of groups.values()){
    let paragraph='',startCount=words.length;
    for(const boxes of lines.values()){
      // Some model tokens have a broad right/bottom edge that includes the
      // following recognized CJK fragment. Do not put a transparent hit target
      // over the next fragment when its start establishes a tighter boundary.
      if(japanese(language)||language==='kor'){
        const axis=language==='jpn_vert'?'y':'x',size=language==='jpn_vert'?'h':'w';
        for(let k=0;k+1<boxes.length;k++){
          const a=boxes[k],advance=boxes[k+1][axis]-a[axis];
          if(advance>0&&advance<a[size])a[size]=advance;
        }
      }
      let line='';
      for(const box of boxes){
        if(line&&(box.spaceBefore??(!japanese(language)||(/[A-Za-z0-9]$/.test(line)&&/^[A-Za-z0-9]/.test(box.text)))))line+=' ';
        box.at=line.length;line+=box.text;
      }
      if(!line)continue;
      if(paragraph&&!japanese(language))paragraph+=' ';
      const base=paragraph.length;paragraph+=line;
      let i=0;
      for(const token of tokens(line,language)){
        const a=token.offset,b=a+token.text.length;
        while(i<boxes.length&&boxes[i].at+boxes[i].text.length<=a)i++;
        let left=1,up=1,right=0,down=0;
        for(let j=i;j<boxes.length&&boxes[j].at<b;j++){
          const q=boxes[j],from=clamp((a-q.at)/q.text.length,0,1),to=clamp((b-q.at)/q.text.length,0,1);
          if(from>=to)continue;
          const vert=language==='jpn_vert';
          left=Math.min(left,q.x+q.w*(vert?0:from));right=Math.max(right,q.x+q.w*(vert?1:to));
          up=Math.min(up,q.y+q.h*(vert?from:0));down=Math.max(down,q.y+q.h*(vert?to:1));
        }
        if(left<right&&up<down){
          if(words.length>=PAGE_WORDS)throw tooDense();
          words.push({text:token.text,x:left,y:up,w:right-left,h:down-up,paragraphIndex:paragraphs.length,offset:base+a});
        }
      }
    }
    if(words.length!==startCount)paragraphs.push({text:paragraph});
  }
  return {paragraphs,words};
}
// Sparse Tesseract often emits each English line as its own paragraph, even
// inside the same balloon. Recover only unambiguous close single-line pairs;
// keep existing multi-line groups, separate columns, and distant rows intact.
export function stitchComicContext(paragraphs,words,language){
  if(language!=='eng'||paragraphs.length<2)return {paragraphs,words};
  const regions=Array(paragraphs.length).fill(null);
  for(const {paragraphIndex:i,x,y,w,h} of words){
    const region=regions[i]??={i,left:x,right:x+w,top:y,bottom:y+h,heights:[]};
    region.left=Math.min(region.left,x);region.right=Math.max(region.right,x+w);
    region.top=Math.min(region.top,y);region.bottom=Math.max(region.bottom,y+h);region.heights.push(h);
  }
  const lines=regions.flatMap(r=>{
    if(!r||r.heights.length<2)return [];
    r.heights.sort((a,b)=>a-b);r.height=r.heights[r.heights.length>>1];
    return r.bottom-r.top<=1.55*r.height?[r]:[];
  }).sort((a,b)=>a.top-b.top||a.left-b.left||a.i-b.i);
  const outgoing=new Map(),incoming=new Map();
  for(let i=0;i<lines.length;i++){
    const a=lines[i],aw=a.right-a.left;
    for(let j=i+1;j<lines.length;j++){
      const b=lines[j],gap=b.top-a.bottom;
      if(gap>a.height)break;
      if(gap<0||gap>0.95*Math.min(a.height,b.height)||b.height<.75*a.height||b.height>1.33*a.height)continue;
      const bw=b.right-b.left,overlap=Math.min(a.right,b.right)-Math.max(a.left,b.left);
      if(overlap<.82*Math.min(aw,bw)||Math.min(aw,bw)<.46*Math.max(aw,bw))continue;
      const edge=Math.min(Math.abs(a.left-b.left),Math.abs(a.right-b.right));
      const center=Math.abs((a.left+a.right-b.left-b.right)/2);
      if(edge>.07*Math.max(aw,bw)&&center>.12*Math.max(aw,bw))continue;
      uniqueCandidate(outgoing,a.i,b.i);uniqueCandidate(incoming,b.i,a.i);
    }
  }
  const next=new Map(),previous=new Map();
  for(const [a,b] of outgoing){
    if(b>=0&&incoming.get(b)===a){next.set(a,b);previous.set(b,a)}
  }
  if(!next.size)return {paragraphs,words};
  const grouped=[],indexes=[];
  for(let i=0;i<paragraphs.length;i++){
    if(indexes[i])continue;
    let line=i,text='',count=0;while(previous.has(line)&&count++<5)line=previous.get(line);
    // Avoid turning a dense page of independent, tightly stacked captions
    // into a single context. Leave long ambiguous sequences unchanged.
    count=0;for(let end=line;end!==undefined&&count<=4;end=next.get(end))count++;
    if(count>4||previous.has(line)){indexes[i]={page:grouped.length,offset:0};grouped.push(paragraphs[i]);continue;}
    while(line!==undefined){
      if(text)text+=' ';
      indexes[line]={page:grouped.length,offset:text.length};
      text+=paragraphs[line].text;
      line=next.get(line);
    }
    grouped.push({text});
  }
  return {paragraphs:grouped,words:words.map(w=>{
    const match=indexes[w.paragraphIndex];
    return {...w,paragraphIndex:match.page,offset:match.offset+w.offset};
  })};
}
function uniqueCandidate(map,key,value){map.set(key,map.has(key)?-1:value)}
async function decode(blob,signal){
  if(typeof createImageBitmap==='function'){
    const image=await createImageBitmap(blob,{imageOrientation:'from-image'});
    return {image,width:image.width,height:image.height,close:()=>image.close()};
  }
  if(typeof Image!=='function')throw new Error('Для распознавания страниц нужен современный браузер.');
  const image=new Image(),url=URL.createObjectURL(blob);
  const close=()=>{image.removeAttribute('src');URL.revokeObjectURL(url)};
  const stop=()=>image.removeAttribute('src');signal?.addEventListener('abort',stop,{once:true});
  try{image.src=url;await image.decode();check(signal);return {image,width:image.naturalWidth,height:image.naturalHeight,close};}
  catch(e){close();check(signal);throw e;}
  finally{signal?.removeEventListener('abort',stop);}
}
export async function recognizeComicPage(blob,{language='eng',signal,onProgress}={}){
  check(signal);
  if(!COMIC_OCR_LANGUAGES.includes(language))throw new Error('Выберите доступный язык OCR.');
  if(!(blob instanceof Blob)||!blob.size||blob.size>L.imageBytes)throw new Error('Выберите изображение до 16 МБ.');
  const bytes=new Uint8Array(await blob.arrayBuffer());check(signal);
  // Infer the real format, even when a drag-and-drop caller has no MIME type.
  const ext=bytes[0]===0xff?'jpg':bytes[0]===0x89?'png':'webp';
  const {type}=comicImageHeader(bytes,'page.'+ext);
  let source,session,canvas;
  try{
    onProgress?.({stage:'render',page:1,total:1,progress:0});check(signal);
    source=await decode(blob.type===type?blob:blob.slice(0,blob.size,type),signal);check(signal);
    const tiles=comicOCRTiles(source.width,source.height), paragraphs=[],words=[];
    let chars=0;
    session=ocrSession([language],signal,onProgress,{positioned:true});
    for(const [i,tile] of tiles.entries()){
      check(signal);
      const vertical=language==='jpn_vert';
      canvas=vertical?canvasAt(tile.h,tile.w):canvasAt(tile.w,tile.h);
      const ctx=canvas.getContext('2d');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
      // The vertical model reads rotated glyphs. Present vertical columns as
      // sparse horizontal lines instead of treating artwork as one text block.
      if(vertical){ctx.translate(0,tile.w);ctx.rotate(-Math.PI/2);}
      ctx.drawImage(source.image,0,tile.top,source.width,tile.end-tile.top,0,0,tile.w,tile.h);
      const raw=await session.read(canvas,i+1,tiles.length);
      check(signal);
      const found=comicTSVLayout(raw.tsv,tile,language,raw.text);
      const shift=paragraphs.length;chars+=found.paragraphs.reduce((n,p)=>n+p.text.length,0);
      if(shift+found.paragraphs.length>PAGE_PARAGRAPHS||words.length+found.words.length>PAGE_WORDS||chars>PAGE_CHARS)throw tooDense();
      paragraphs.push(...found.paragraphs);
      for(const word of found.words)words.push({...word,paragraphIndex:word.paragraphIndex+shift});
      canvas.width=canvas.height=0;canvas=null;
    }
    return {...stitchComicContext(paragraphs,words,language),status:words.length?'ready':'empty'};
  } catch(e){check(signal);throw e;}
  finally{session?.close();source?.close();if(canvas)canvas.width=canvas.height=0;}
}
