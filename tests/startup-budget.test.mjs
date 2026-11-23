import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {startupModules} from '../tools/update-startup-hints.mjs';

const dist = new URL('../dist/', import.meta.url);
const buildOrigin = new URL('https://folio-budget.invalid/reader/');
const KiB = 1024;
// Released 96fc59b (gzip level 6, each resource independently):
// HTML 12,499 B; 25 stylesheets 44,648 B; 54 JS files 188,303 B, including
// the existing async dictionary/index helpers seen during first-visit QA.
// Leave ~28–47% room for incremental features, review real loads if exceeded.
const ceilings = {html: 18 * KiB, css: 60 * KiB, js: 240 * KiB, cssCount: 32};
const backgroundModules = ['lexicon.js', 'english-verbs.js'];
const fetchLinks = new Set(['stylesheet', 'modulepreload', 'preload', 'prefetch']);
const attrs = tag => Object.fromEntries([...tag.matchAll(/\b([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
  .map(m => [m[1].toLowerCase(), m[2] ?? m[3]]));
const optionalDirectories = /^(?:voices|vendor|starter|research|editorial|lexicon|packs)\//i;
const deferredCode = /^(?:comic-import|comic-ocr|ocr-engine|pdf-import|comic-pdf)\.js$/i;
const packMetadata = 'packs/catalog.js';
const cssFont = /^vendor\/(?:inter|reading-fonts)\/[\w.-]+\.woff2$/i;

function assetPath(href, from = buildOrigin) {
  assert.match(href || '', /^[\w./-]+$/, 'Startup assets must use local file paths: ' + href);
  const u = new URL(href, from);
  assert.ok(u.href.startsWith(buildOrigin.href), 'Startup asset escapes the reader root: ' + href);
  return u.href.slice(buildOrigin.href.length);
}

function verifyEagerAsset(path, {allowFonts = false} = {}) {
  assert.ok(!/\.(?:onnx|npz|wasm|traineddata)(?:\.gz)?$/i.test(path)
    && !deferredCode.test(path)
    && (!optionalDirectories.test(path) || path === packMetadata || (allowFonts && cssFont.test(path))),
    'Optional asset must stay user-initiated, not on the startup path: ' + path);
}

function htmlAssets(html) {
  const styles = [], scripts = [];
  for (const [tag] of html.matchAll(/<(?:link|script)\b[^>]*>/gi)) {
    const att = attrs(tag);
    if (/^<script/i.test(tag) && att.src) {
      const p = assetPath(att.src);
      verifyEagerAsset(p);
      scripts.push(p);
    } else if (/^<link/i.test(tag)) {
      const rel = (att.rel || '').toLowerCase().split(/\s+/);
      if (!rel.some(value => fetchLinks.has(value))) continue;
      const p = assetPath(att.href);
      verifyEagerAsset(p, {allowFonts: rel.includes('preload') && att.as === 'font'});
      if (rel.includes('stylesheet')) {
        assert.match(p, /\.css$/i, 'Unexpected stylesheet path: ' + p);
        styles.push(p);
      } else if (/\.(?:m?js)$/i.test(p)) {
        scripts.push(p);
      }
    }
  }
  assert.equal(styles.length, new Set(styles).size, 'Duplicate startup stylesheet href');
  return {styles, scripts};
}

function verifyStylesheet(css, path) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(withoutComments, /@import\s|@import["']/i,
    'Extra stylesheet dependency is not accounted for: ' + path);
  for (const m of withoutComments.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s\)]+))\s*\)/gi)) {
    const href = m[1] ?? m[2] ?? m[3];
    if (/^data:/i.test(href) || href.startsWith('#')) continue;
    const ref = assetPath(href, new URL(path, buildOrigin));
    verifyEagerAsset(ref, {allowFonts: true});
  }
}

test('first-load CSS/JS stay within the measured shell budget and optional packs stay deferred', async t => {
  const read = file => readFile(new URL(file, dist));
  const h = await read('app.html'), html = h.toString(), {styles, scripts} = htmlAssets(html);
  const graph = await startupModules(html, async file => String(await read(file)));
  const js = [...new Set([...graph, ...scripts, ...backgroundModules])];
  const sizes = {html: gzipSync(h, {level: 6}).length, css: 0, js: 0};
  for (const path of styles) {
    const buffer = await read(path);
    verifyStylesheet(buffer.toString(), path);
    sizes.css += gzipSync(buffer, {level: 6}).length;
  }
  for (const path of js) {
    verifyEagerAsset(path);
    sizes.js += gzipSync(await read(path), {level: 6}).length;
  }
  t.diagnostic('Gzip proxy of separately transferred shell files, not live wire bytes: ' + JSON.stringify(sizes));
  t.diagnostic('Checked app.html; styles: ' + styles.join(', ') + '; scripts: ' + js.join(', '));
  assert.ok(styles.length <= ceilings.cssCount, 'Recheck startup request pressure before adding more stylesheets.');
  for (const [kind, size] of Object.entries(sizes)) {
    assert.ok(size <= ceilings[kind], kind + ' startup budget: ' + size + ' > ' + ceilings[kind] + ' bytes. Review the first-visit trace.');
  }
});

test('the budget guard rejects eager voice models, optional workers and uncounted CSS dependencies', () => {
  assert.throws(() => htmlAssets('<link rel="preload" href="voices/en-v1/model.onnx" as="fetch">'), /Optional asset/);
  assert.throws(() => htmlAssets('<script type="module" src="./voices/en-v1/kitten.js"></script>'), /Optional asset/);
  assert.throws(() => htmlAssets('<link rel="prefetch" href="vendor/pdfjs/pdf.min.js">'), /Optional asset/);
  assert.throws(() => verifyStylesheet('@import "late.css";', 'study.css'), /not accounted/);
  assert.throws(() => verifyStylesheet("x { background: url('voices/en-v1/art.png') }", 'study.css'), /Optional asset/);
  assert.doesNotThrow(() => htmlAssets('<link rel="modulepreload" href="packs/catalog.js">'));
  assert.doesNotThrow(() => verifyStylesheet('@font-face { src: url("./vendor/inter/InterVariable.woff2") }', 'study.css'));
});
