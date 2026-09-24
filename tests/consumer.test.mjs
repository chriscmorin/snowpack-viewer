import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';
import { build } from 'esbuild';
import { launchSelectedBrowser } from '../scripts/browser.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('packed npm artifact installs, typechecks, bundles, and mounts two independent viewers', { timeout: 120000 }, async () => {
  const consumer = await mkdtemp(resolve(tmpdir(), 'spv-consumer-'));
  try {
    const { stdout } = await run('npm', ['pack', '--json', '--pack-destination', consumer], { cwd: root, maxBuffer: 10_000_000 });
    const packed = JSON.parse(stdout);
    assert.equal(packed.length, 1);
    const archive = resolve(consumer, packed[0].filename);
    await writeFile(resolve(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    await run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive], { cwd: consumer, maxBuffer: 10_000_000 });
    const source = `import { parsePro, createViewer, type ProStation, type ViewerController } from 'snowpack-pro-viewer';
const station: ProStation = parsePro('[HEADER]\\n0500,Date\\n0501,nElems,height\\n[DATA]\\n0500,01.01.2020 00:00\\n0501,1,10');
const host = document.createElement('div');
const viewer: ViewerController = createViewer(host, station);
viewer.setIndex(0);
viewer.destroy();`;
    await writeFile(resolve(consumer, 'consumer.ts'), source);
    const tsc = resolve(root, 'node_modules/.bin/tsc');
    await run(tsc, ['--strict', '--moduleResolution', 'bundler', '--module', 'esnext', '--target', 'es2022', '--lib', 'ES2022,DOM', '--noEmit', 'consumer.ts'], { cwd: consumer, maxBuffer: 10_000_000 });
    const entry = `import 'snowpack-pro-viewer/style.css'; import { parsePro, createViewer } from 'snowpack-pro-viewer'; window.spv = { parsePro, createViewer };`;
    const bundle = await build({ stdin: { contents: entry, resolveDir: consumer, sourcefile: 'consumer-entry.js' }, bundle: true, write: false, outdir: resolve(consumer, 'bundle'), format: 'iife', platform: 'browser' });
    const js = bundle.outputFiles.find(file => file.path.endsWith('.js'));
    const css = bundle.outputFiles.find(file => file.path.endsWith('.css'));
    assert.ok(js && css, 'public package exports must bundle both JavaScript and CSS');
    const fixture = await readFile(resolve(root, 'fixtures/niviz-example.pro'), 'utf8');
    const browser = await launchSelectedBrowser();
    try {
      const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setContent('<main><div id="first"></div><div id="second"></div></main>');
      await page.addStyleTag({ content: css.text });
      await page.addScriptTag({ content: js.text });
      const result = await page.evaluate(text => {
        const station = window.spv.parsePro(text);
        const first = window.spv.createViewer(document.getElementById('first'), station, { property: 'temperature' });
        const second = window.spv.createViewer(document.getElementById('second'), station, { property: 'density' });
        const before = [document.querySelector('#first .spv-panel-timeline') !== null,
          document.querySelector('#second .spv-panel-profile') !== null];
        first.setProperty('grainshape');
        const independent = document.querySelector('#second button[data-property="density"]').getAttribute('aria-pressed');
        first.destroy(); second.destroy();
        return { before, independent, remaining: document.querySelectorAll('.spv-viewer').length };
      }, fixture);
      assert.deepEqual(result, { before: [true, true], independent: 'true', remaining: 0 });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
});
