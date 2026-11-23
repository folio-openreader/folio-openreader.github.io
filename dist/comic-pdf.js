// A comic PDF is rasterized one page at a time into immutable local Blobs.
// No PDF file, text or image goes to a service. Canvas renders only PDF content,
// not annotations, XFA, interactive controls or scripts.
import {pdfAssetBase,pdfBudget,pdfLocalOptions} from './pdf-import.js';

const MiB=1024*1024;
export const COMIC_PDF_LIMITS=Object.freeze({
  bytes:64*MiB, pages:320, side:4000, pagePixels:6_000_000, totalPixels:420_000_000,
  pageBytes:16*MiB, totalBytes:120*MiB, embeddedPixels:32_000_000, timeout:5*60*1000,
});
const L=COMIC_PDF_LIMITS;
class ComicPdfError extends Error {}
const issue=s=>new ComicPdfError(s);
const aborted=()=>new DOMException('Импорт отменён.','AbortError');
const protectedBook=()=>issue('Этот PDF защищён или зашифрован. Выберите незашифрованную версию.');
const split=()=>issue('Страницы PDF занимают больше 120 МБ. Разделите PDF на части.');
const unsupported=()=>issue('Не удалось запустить обработчик PDF. Откройте Folio в современном браузере.');

function pageView(page, pixels,side) {
  const {width,height}=page.getViewport({scale:1});
  if (!Number.isFinite(width*height) || width<=0 || height<=0)
    throw issue('У страницы PDF недопустимый размер.');
  const scale=Math.min(2.5,side/Math.max(width,height),Math.sqrt(pixels/(width*height)));
  if(Math.min(width,height)*scale<1) throw issue('У страницы PDF недопустимые пропорции.');
  return page.getViewport({scale});
}

function jpegBlob(canvas) {
  return new Promise((resolve,reject)=>{
    canvas.toBlob(blob=>{
      if(blob?.type==='image/jpeg' && blob.size) resolve(blob);
      else reject(issue('Браузер не смог сохранить изображение страницы PDF.'));
    },'image/jpeg',0.92);
  });
}

export async function rasterComicPdf(file,{signal,onProgress}={}) {
  if(signal?.aborted) throw aborted();
  if(!(file instanceof Blob) || !file.size) throw issue('Не удалось прочитать файл PDF.');
  if(file.size>L.bytes) throw issue('PDF комикса больше 64 МБ. Разделите книгу на части.');
  const run=pdfBudget(signal,L.timeout,'Обработка PDF заняла слишком много времени. Разделите книгу на части.');
  const check=()=>{if(run.signal.aborted)throw run.reason||aborted();};
  let port,worker,task,activeRender,canvas,finished=false,number=0;
  const stopRender=()=>activeRender?.cancel();
  run.signal.addEventListener('abort',stopRender,{once:true});
  const raster=async()=>{
    // The signature check also applies to PDFs with a short leading envelope.
    const header=await file.slice(0,1024).arrayBuffer();check();
    if(!new TextDecoder('latin1').decode(header).includes('%PDF-'))
      throw issue('Файл не похож на PDF. Проверьте его формат.');
    const bytes=new Uint8Array(await file.arrayBuffer());check();
    let pdf;
    try {
      pdf=await import('./vendor/pdfjs/pdf.min.js');check();
      port=new Worker(new URL('pdf.worker.min.js',pdfAssetBase),{type:'module'});
      worker=new pdf.PDFWorker({port,verbosity:0});
    } catch(e){check();throw unsupported();}
    port.onerror=()=>run.stop(unsupported());
    const options=pdfLocalOptions(L.embeddedPixels,true);
    task=pdf.getDocument({data:bytes,worker,...options});
    const doc=await task.promise;check();
    if(!Number.isSafeInteger(doc.numPages) || doc.numPages<1)throw issue('В PDF не найдено страниц.');
    if(doc.numPages>L.pages)throw issue('В PDF больше 320 страниц. Разделите книгу на части.');
    const {info}=await doc.getMetadata();check();
    if(info?.EncryptFilterName || (await doc.getPermissions())!==null)throw protectedBook();
    check();
    // Large books are rasterized with a smaller per-page target. Portrait, spread
    // and rotated pages each keep their original aspect ratio and page order.
    const pagePixels=Math.min(L.pagePixels,Math.floor(L.totalPixels/doc.numPages));
    let encoded=0,surface=0;
    const pages=[];
    canvas=document.createElement('canvas');
    for(let n=1;n<=doc.numPages;n++){
      number=n;check();onProgress?.({stage:'pages',page:n,total:doc.numPages});check();
      const page=await doc.getPage(n);
      try {
        check();
        const viewport=pageView(page,pagePixels,L.side);
        const w=Math.floor(viewport.width),h=Math.floor(viewport.height);
        if(w<1||h<1||Math.max(w,h)>L.side||w*h>L.pagePixels||(surface+=w*h)>L.totalPixels)
          throw issue('Недопустимый размер изображения страницы PDF.');
        canvas.width=w;canvas.height=h;
        const ctx=canvas.getContext('2d',{alpha:false});
        if(!ctx)throw unsupported();
        // Fractional viewports are scaled to the selected integer output size,
        // rather than cropping a thin strip or adding a border at the edges.
        const transform=[w/viewport.width,0,0,h/viewport.height,0,0];
        activeRender=page.render({canvas,canvasContext:ctx,viewport,transform,background:'#ffffff',
          annotationMode:pdf.AnnotationMode.DISABLE});
        try{await activeRender.promise;}finally{activeRender=null;}
        check();
        const blob=await jpegBlob(canvas);check();
        if(blob.size>L.pageBytes)throw issue('Изображение страницы превышает 16 МБ. Уменьшите разрешение исходного PDF.');
        if((encoded+=blob.size)>L.totalBytes)throw split();
        pages.push({name:'Страница '+n+'.jpg',blob,width:w,height:h});
      } finally {
        page.cleanup();
        canvas.width=canvas.height=0;
      }
    }
    return pages;
  };
  try {
    const pages=await Promise.race([run.stopped,raster()]);
    finished=true;
    return pages;
  } catch(e) {
    if(run.reason)throw run.reason;
    if(e instanceof ComicPdfError || e?.name==='AbortError')throw e;
    if(e?.name==='PasswordException'||/encryption|encrypted|password|security handler/i.test(e?.message||''))
      throw protectedBook();
    if(/exceeded maximum allowed size/i.test(e?.message||''))
      throw issue('В PDF есть изображение больше 32 мегапикселей. Уменьшите разрешение исходного файла.');
    throw issue(number?'Не удалось открыть страницу '+number+' PDF. Проверьте файл.':
      'Не удалось открыть PDF. Файл повреждён или имеет неподдерживаемый формат.');
  } finally {
    run.close();
    run.signal.removeEventListener('abort',stopRender);
    if(canvas)canvas.width=canvas.height=0;
    if(port)port.onerror=null;
    // A failed/hung worker cannot prevent cancellation completing. Destroy the
    // document transport on the successful path before terminating its port.
    if(finished&&task){try{await task.destroy();}catch{}}
    worker?.destroy();
    port?.terminate();
  }
}
