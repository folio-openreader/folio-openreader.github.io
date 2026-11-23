import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startupModules, withStartupHints, MAX_STARTUP_MODULES} from '../tools/update-startup-hints.mjs';
const base = new URL('../dist/', import.meta.url);
const read = file => readFile(new URL(file, base), 'utf8');

test('startup hints match only the bounded required static module graph', async () => {
  const html = await read('app.html');
  const paths = await startupModules(html, read);
  assert.equal(withStartupHints(html, paths), html, 'Run node tools/update-startup-hints.mjs after startup import changes');
  assert.deepEqual(paths.slice(0, 2), ['app.js', 'profile-stack.js']);
  assert.ok(paths.includes('packs/catalog.js'), 'shared pack metadata only');
  assert.ok(paths.length <= MAX_STARTUP_MODULES);
  assert.ok(!paths.some(path => /^(?:vendor|starter|lexicon)\/|^lexicon\.js$|^ocr-engine\.js$|^comic-import\.js$|^pdf-import\.js$/.test(path)));
});

test('classic watchdog fetch is protected without changing module execution order', async () => {
  const html = await read('app.html');
  const css = html.indexOf('<link rel="stylesheet" href="boot.css">');
  const watchdog = html.indexOf('<link rel="preload" as="script" href="boot.js">');
  const moduleHints = html.indexOf('<link rel="modulepreload" href="app.js">');
  const head = html.indexOf('</head>');
  assert.ok(0 < css && css < watchdog && watchdog < moduleHints && moduleHints < head);
  const classic = html.indexOf('<script src="boot.js"></script>');
  const profile = html.indexOf('<script type="module" src="profile-stack.js"></script>');
  const app = html.indexOf('<script type="module" src="app.js"></script>');
  assert.ok(head < classic && classic < profile && profile < app);
});

test('the hints generator handles transitive imports without collecting dynamic imports', async () => {
  const html = '<head></head><script src="app.js" type="module"></script>';
  const modules = {
    'app.js': "import {x} from './a/index.js';\nimport('./on-demand.js');",
    'a/index.js': "export {x} from '../leaf.js';",
    'leaf.js': 'export const x = 3;',
  };
  assert.deepEqual(await startupModules(html, file => modules[file]), ['app.js', 'a/index.js', 'leaf.js']);
  await assert.rejects(startupModules(html, () => "import '../outside.js';"), /escapes reader root/);
  await assert.rejects(startupModules(html, () => Array.from({length: MAX_STARTUP_MODULES}, (_, i) => "import './module-"+i+".js';").join('\n')), /more modules/);
});
