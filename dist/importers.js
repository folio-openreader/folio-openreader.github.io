const MiB = 1024 * 1024;
const MAX_EPUB = 24 * MiB;
const MAX_TXT = 3 * MiB;
const MAX_DOCUMENT = 6 * MiB;
const MAX_TEXT = 4 * MiB;
const MAX_ENTRIES = 4096;
const MAX_PARAGRAPHS = 16000;
const MAX_SPINE = 1024;
const UTR = new TextDecoder('utf-8', {fatal: true});
const OPF_NS = 'http://www.idpf.org/2007/opf';
const OCF_NS = 'urn:oasis:names:tc:opendocument:xmlns:container';
const DC_NS = 'http://purl.org/dc/elements/1.1/';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

function invalid() {
  return new Error('This EPUB is damaged or uses an unsupported archive format. Try exporting a fresh EPUB.');
}
function oversized() {
  return new Error('This EPUB is too large to unpack safely. Try a smaller edition.');
}
function protectedBook() {
  return new Error('Protected or encrypted EPUBs cannot be opened. Choose a DRM-free version.');
}

export function zip(buffer, {maxDocument = MAX_DOCUMENT, maxTotal = 20 * MiB} = {}) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const u16 = i => view.getUint16(i, true);
  const u32 = i => view.getUint32(i, true);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557)) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
    end--;
  }
  if (end < Math.max(0, bytes.length - 65557)) throw invalid();
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || !count || start + size > end) throw invalid();
  if (count > MAX_ENTRIES) throw oversized();
  const entries = new Map();
  let pos = start;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > start + size || u32(pos) !== 0x02014b50) throw invalid();
    const flags = u16(pos + 8), method = u16(pos + 10), checksum = u32(pos + 16);
    const packed = u32(pos + 20), unpacked = u32(pos + 24), local = u32(pos + 42);
    const nameLength = u16(pos + 28);
    const next = pos + 46 + nameLength + u16(pos + 30) + u16(pos + 32);
    if (!nameLength || next > start + size || u16(pos + 34)) throw invalid();
    if (flags & 0x41) throw protectedBook();
    const name = UTR.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    if (/^[\/]|[\\\0]/.test(name) || name.split('/').includes('..') || entries.has(name)) throw invalid();
    entries.set(name, {flags, method, checksum, packed, unpacked, local});
    pos = next;
  }
  if (pos !== start + size) throw invalid();
  let extracted = 0;
  return {
    has: name => entries.has(name),
    names: () => [...entries.keys()],
    async read(name, {binary = false} = {}) {
      const e = entries.get(name);
      if (!e) throw invalid();
      const {flags, method, checksum, packed, unpacked, local} = e;
      if (unpacked > maxDocument || extracted + unpacked > maxTotal) throw oversized();
      extracted += unpacked;
      if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) throw invalid();
      const localNameEnd = local + 30 + u16(local + 26);
      const offset = localNameEnd + u16(local + 28);
      if (offset + packed > start || UTR.decode(bytes.subarray(local + 30, localNameEnd)) !== name) throw invalid();
      const compressed = bytes.subarray(offset, offset + packed);
      let out;
      if (method === 0 && packed === unpacked) {
        out = compressed;
      } else if (method === 8) {
        if (!globalThis.DecompressionStream) throw new Error('This browser cannot unpack EPUBs. Try a recent browser or import a TXT file.');
        out = new Uint8Array(unpacked);
        let stream;
        try { stream = new DecompressionStream('deflate-raw'); }
        catch { throw new Error('This browser cannot unpack EPUBs. Try a recent browser or import a TXT file.'); }
        const reader = new Blob([compressed]).stream().pipeThrough(stream).getReader();
        let written = 0;
        try {
          for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            if (written + value.length > unpacked) {
              await reader.cancel();
              throw invalid();
            }
            out.set(value, written);
            written += value.length;
          }
          if (written !== unpacked) throw invalid();
        } catch { throw invalid(); }
      } else throw invalid();
      if (crc32(out) !== checksum) throw invalid();
      return binary ? out : UTR.decode(out);
    }
  };
}

const crcTable = Uint32Array.from({length: 256}, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ b) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

function xml(text) {
  // Never parse imported markup as HTML or attach it to the live document.
  // Allow simple EPUB XHTML doctypes, but never parse entity declarations or internal subsets.
  if (/<!ENTITY\b/i.test(text)) throw invalid();
  text = text.replace(/<!DOCTYPE\s+[\w:.-]+(?:\s+(?:PUBLIC|SYSTEM)\s+(?:"[^"]*"|'[^']*')(?:\s+(?:"[^"]*"|'[^']*'))?)?\s*>/gi, '');
  if (/<!DOCTYPE\b/i.test(text)) throw invalid();
  text = text.replace(/&nbsp;/g, '&#160;');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (!doc.documentElement || doc.getElementsByTagNameNS('*', 'parsererror').length) throw invalid();
  return doc;
}

const children = (node, ns, tag) => Array.from(node?.children ?? []).filter(n => n.namespaceURI === ns && n.localName === tag);
const child = (node, ns, tag) => children(node, ns, tag)[0];
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const metadata = (node, ns, tag) => clean(child(node, ns, tag)?.textContent).slice(0, 240);
const fallbackTitle = name => name.replace(/\.(epub|txt)$/i, '').trim().slice(0, 240) || 'Untitled book';

function resolvePath(base, href) {
  const raw = href.split(/[?#]/, 1)[0];
  if (!raw || /^[a-z][a-z\d+.-]*:|^\//i.test(raw)) throw invalid();
  const parts = base.split('/').slice(0, -1);
  for (const encoded of raw.split('/')) {
    const segment = decodeURIComponent(encoded);
    if (/[\/\\\0]/.test(segment)) throw invalid();
    if (segment === '..') {
      if (!parts.length) throw invalid();
      parts.pop();
    } else if (segment !== '.' && segment) parts.push(segment);
  }
  return parts.join('/');
}

const OMIT = new Set(['script', 'style', 'template', 'nav', 'svg', 'math', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'noscript', 'img']);
const BLOCK = new Set(['h1','h2','h3','h4','h5','h6','p','li','dt','dd','section','div','article','pre','blockquote','figcaption','tr','hr']);
function readChapter(source, fallback) {
  const doc = xml(source);
  const root = doc.documentElement;
  if (root.namespaceURI !== XHTML_NS || root.localName !== 'html') throw invalid();
  const body = child(root, XHTML_NS, 'body');
  if (!body) throw invalid();
  const paragraphs = [];
  let buffer = [], candidate = '', firstHeading = '';
  const flush = () => {
    const text = clean(buffer.join(''));
    if (text) paragraphs.push(text);
    if (paragraphs.length > MAX_PARAGRAPHS) throw oversized();
    buffer = [];
  };
  function visit(node, depth) {
    if (depth > 128) throw invalid();
    if (node.nodeType === 3 || node.nodeType === 4) { buffer.push(node.nodeValue); return; }
    if (node.nodeType !== 1 || node.namespaceURI !== XHTML_NS || OMIT.has(node.localName) || node.hasAttribute('hidden')) return;
    const tag = node.localName, block = BLOCK.has(tag);
    if (tag === 'br') { buffer.push(' '); return; }
    if (block) flush();
    const heading = /^h[1-6]$/.test(tag);
    const before = paragraphs.length;
    for (const n of node.childNodes) visit(n, depth + 1);
    if (block) {
      if (heading && before === 0 && !firstHeading) {
        firstHeading = clean(buffer.join(''));
        candidate = firstHeading.slice(0, 240);
        if (firstHeading && firstHeading.length <= 240) { buffer = []; return; }
      }
      flush();
    }
  }
  visit(body, 0);
  flush();
  return {title: candidate || metadata(child(root, XHTML_NS, 'head'), XHTML_NS, 'title') || fallback, paragraphs};
}

async function parseEpub(file) {
  if (file.size > MAX_EPUB) throw new Error('Choose an EPUB smaller than 24 MB.');
  let archive;
  try {
    archive = zip(await file.arrayBuffer());
    // Some valid DRM-free books obscure embedded fonts. We skip all non-text assets;
    // reject any encryption declarations conservatively instead of attempting decryption.
    if (archive.has('META-INF/encryption.xml') || archive.has('META-INF/rights.xml')) throw protectedBook();
    if (!archive.has('META-INF/container.xml')) throw invalid();
    if (archive.has('mimetype') && (await archive.read('mimetype')).trim() !== 'application/epub+zip') throw invalid();
    const container = xml(await archive.read('META-INF/container.xml')).documentElement;
    if (container.namespaceURI !== OCF_NS || container.localName !== 'container') throw invalid();
    const opf = children(child(container, OCF_NS, 'rootfiles'), OCF_NS, 'rootfile').find(x => x.getAttribute('media-type') === 'application/oebps-package+xml');
    const opfPath = resolvePath('', opf?.getAttribute('full-path') ?? '');
    const pkg = xml(await archive.read(opfPath)).documentElement;
    if (pkg.namespaceURI !== OPF_NS || pkg.localName !== 'package') throw invalid();
    const meta = child(pkg, OPF_NS, 'metadata');
    const manifest = new Map(children(child(pkg, OPF_NS, 'manifest'), OPF_NS, 'item').map(n => [n.getAttribute('id'), n]));
    const spine = children(child(pkg, OPF_NS, 'spine'), OPF_NS, 'itemref');
    if (!spine.length) throw invalid();
    if (spine.length > MAX_SPINE) throw oversized();
    const chapters = [];
    let chars = 0, count = 0, skipped = 0;
    for (const ref of spine) {
      if (ref.getAttribute('linear') === 'no') continue;
      const item = manifest.get(ref.getAttribute('idref'));
      if (!item) throw invalid();
      if ((item.getAttribute('properties') ?? '').split(/\s+/).includes('nav')) continue;
      if (item.getAttribute('media-type') !== 'application/xhtml+xml') { skipped++; continue; }
      const path = resolvePath(opfPath, item.getAttribute('href') ?? '');
      const c = readChapter(await archive.read(path), `Chapter ${chapters.length + 1}`);
      if (!c.paragraphs.length) { skipped++; continue; }
      count += c.paragraphs.length;
      chars += c.paragraphs.reduce((n, p) => n + p.length, 0);
      if (chars > MAX_TEXT || count > MAX_PARAGRAPHS) throw oversized();
      chapters.push(c);
    }
    if (!chapters.length) throw new Error('No readable text was found. Folio opens text-based EPUBs, not image-only books.');
    const warnings = ['Text only: illustrations and original page layout are not imported.'];
    if (skipped) warnings.push(`${skipped} non-text or empty section(s) skipped.`);
    return {title: metadata(meta, DC_NS, 'title') || fallbackTitle(file.name), author: metadata(meta, DC_NS, 'creator'), language: metadata(meta, DC_NS, 'language'), chapters, warnings, format: 'EPUB'};
  } catch (err) {
    if (err instanceof TypeError || err instanceof RangeError || err instanceof URIError) throw invalid();
    throw err;
  }
}

function guessLanguage(text) {
  const sample = text.slice(0, 8192);
  const cyr = (sample.match(/\p{Script=Cyrillic}/gu) || []).length;
  const latin = (sample.match(/\p{Script=Latin}/gu) || []).length;
  // Do not guess Russian or English solely from script: default styling belongs to the reader.
  return cyr > latin * 4 ? 'und-Cyrl' : latin > cyr * 4 ? 'und-Latn' : '';
}
function txtParagraphs(text) {
  const blankLine = /\n[^\S\n]*\n/.test(text);
  return text.split(blankLine ? /\n[^\S\n]*\n+/ : /\n/).map(clean).filter(Boolean);
}
async function parseTxt(file) {
  if (file.size > MAX_TXT) throw new Error('Choose a TXT file smaller than 3 MB.');
  let text;
  try { text = UTR.decode(await file.arrayBuffer()); }
  catch { throw new Error('This text file is not valid UTF-8. Re-save it as UTF-8 TXT and try again.'); }
  if (/[\0\x01-\x08\x0B\x0E-\x1F]/.test(text)) throw new Error('This does not look like plain text. Choose a UTF-8 TXT file.');
  text = text.replace(/\r\n?/g, '\n');
  const paragraphs = txtParagraphs(text);
  if (!paragraphs.length) throw new Error('This text file is empty. Choose a book that contains text.');
  if (paragraphs.length > MAX_PARAGRAPHS) throw new Error('This file has too many paragraphs. Split it into smaller books.');
  return {title: fallbackTitle(file.name), author: '', language: guessLanguage(text), chapters: [{title: 'Text', paragraphs}], warnings: [], format: 'TXT'};
}

export async function parseBook(file, options = {}) {
  if (!file?.name) throw new Error('Выберите EPUB, PDF, UTF-8 TXT, PNG или JPEG.');
  if (/\.epub$/i.test(file.name)) return parseEpub(file);
  if (/\.txt$/i.test(file.name)) return parseTxt(file);
  if (/\.(pdf|png|jpe?g)$/i.test(file.name)) {
    const image=/\.(png|jpe?g)$/i.test(file.name);
    if(file.size>(image?16:24)*MiB)throw new Error(image?'Снимок: максимум 16 МБ.':'PDF: максимум 24 МБ.');
    const {parsePdf,parseImage}=await import('./pdf-import.js');
    const bytes=await file.arrayBuffer();
    if(options.signal?.aborted)throw new DOMException('Отменено','AbortError');
    const parsed=await (image?parseImage:parsePdf)(bytes,file.name,options);
    // A single OCR language is the reader's explicit choice, not a guess from script.
    if(!parsed.language&&parsed.ocr?.pages?.length&&options.languages?.length===1)
      parsed.language=({eng:'en',rus:'ru',kaz:'kk'})[options.languages[0]]||'';
    if(!parsed.language)parsed.language=guessLanguage(parsed.chapters.slice(0,6).map(c=>c.paragraphs.slice(0,4).map(p=>p.slice(0,300)).join(' ')).join(' '));
    return parsed;
  }
  throw new Error('Выберите EPUB, PDF, UTF-8 TXT, PNG или JPEG. Другие форматы не поддерживаются.');
}

export function singleBook(parsed) {
  return {...parsed, alignment: 'none', chapters: parsed.chapters.map(c => ({
    ...c, paragraphs: c.paragraphs.map(text => ({text, translation: null}))
  }))};
}

export function pairBooks(original, translation) {
  const book = singleBook(original);
  const total = b => b.chapters.reduce((n, c) => n + c.paragraphs.length, 0);
  const originalCount = total(original), translationCount = total(translation);
  const chapterCountsMatch = original.chapters.length === translation.chapters.length;
  let matchedCount = 0;
  let paragraphCountsMatch = chapterCountsMatch;
  if (chapterCountsMatch) book.chapters.forEach((c, i) => {
    const other = translation.chapters[i];
    if ((original.format==='PDF'&&translation.format==='PDF'&&c.title!==other.title)||c.paragraphs.length!==other.paragraphs.length) { paragraphCountsMatch = false; return; }
    c.paragraphs.forEach((p, j) => { p.translation = other.paragraphs[j]; matchedCount++; });
  });
  return {
    ...book,
    translationTitle: translation.title,
    ...(translation.ocr?{translationOcr:translation.ocr}:{}),
    translationLanguage: translation.language,
    alignment: 'positional-unverified',
    alignmentReport: {originalCount, translationCount, matchedCount, unmatchedOriginal: originalCount - matchedCount, unmatchedTranslation: translationCount - matchedCount, chapterCountsMatch, paragraphCountsMatch},
    warnings: [...new Set([...original.warnings, ...translation.warnings])],
  };
}
