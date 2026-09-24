import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { Script } from 'node:vm';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { launchSelectedBrowser } from '../scripts/browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = resolve(root, 'dist/snowpack-viewer.html');
const demoPath = resolve(root, 'dist/demo/index.html');
const mstGzipPath = resolve(root, 'dist/demo/examples/snowpack-large-MST96.pro.gz');
const seasonSourcePath = resolve(root, '.cache/examples/snowpack-large-MST96.pro');
const fullSeason = process.env.SPV_FULL_SEASON === '1';
if (fullSeason) test('full-season fixture and hosted demo are present', () => {
  assert.ok(existsSync(seasonSourcePath), `Missing verified fixture: ${seasonSourcePath}`);
  assert.ok(existsSync(mstGzipPath), `Missing demo build: ${mstGzipPath}; run npm run build:demo`);
  assert.ok(existsSync(demoPath), `Missing demo HTML: ${demoPath}; run npm run build:demo`);
});
function pngSize(bytes) {
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
function profileDateFromFooter(footer) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}) UTC$/.exec(footer);
  assert.ok(match, `Unexpected selected date: ${footer}`);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(match[2]) - 1];
  return `Snow profile ${month} ${match[3]} '${match[1].slice(-2)}, ${match[4]}`;
}

test('standalone HTML contains its code and styles without external assets', async () => {
  const html = await readFile(htmlPath, 'utf8');
  assert.match(html, /<style>[^]*?<\/style>/);
  assert.match(html, /<script>[^]*?<\/script>/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
  assert.doesNotMatch(html, /<link[^>]+href=/i);
  assert.doesNotMatch(html, /<script[^>]+type=["']module/i);
  const executable = /<script>([^]*?)<\/script>/.exec(html)?.[1];
  assert.ok(executable);
  assert.doesNotThrow(() => new Script(executable));
  assert.doesNotMatch(html, /StationName= Davos:Baerentaelli/);
  if (fullSeason) assert.equal(await readFile(resolve(root, 'dist/demo/snowpack-viewer.html'), 'utf8'), html);
});

test('standalone HTML opens from disk with network blocked', async () => {
  const browser = await launchSelectedBrowser();
  try {
    const page = await browser.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto(pathToFileURL(htmlPath).href);
    assert.equal(await page.title(), 'SNOWPACK .pro viewer');
    assert.equal(await page.locator('#app').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Open example' }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Download offline viewer' }).count(), 0);
    const smallGzip = gzipSync(await readFile(resolve(root, 'fixtures/niviz-example.pro')));
    await page.locator('input[type=file]').setInputFiles({ name: 'niviz-example.pro.gz', mimeType: 'application/gzip', buffer: smallGzip });
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('48 timesteps'));
    assert.match(await page.locator('[role=status]').innerText(), /48 timesteps/);
    await page.locator('input[type=file]').setInputFiles({ name: 'corrupt.pro.gz', mimeType: 'application/gzip', buffer: Buffer.from('not gzip') });
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('Could not decompress'));
    assert.equal(await page.locator('.spv-viewer').count(), 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, []);
  } finally {
    await browser.close();
  }
});

test('source and license disclosure works by keyboard on desktop and narrow screens', async () => {
  const browser = await launchSelectedBrowser();
  try {
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const requests = [];
      await page.route(/^https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
      await page.goto(pathToFileURL(htmlPath).href);
      const button = page.getByRole('button', { name: 'Source & license' });
      await button.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Source & license' });
      assert.equal(await dialog.isVisible(), true);
      assert.match(await dialog.innerText(), /AGPL-3\.0-or-later/);
      const sourceLink = dialog.getByRole('link', { name: 'Source repository' });
      assert.equal(await sourceLink.count(), 1);
      assert.equal(await sourceLink.getAttribute('href'), process.env.SPV_SOURCE_URL || 'https://github.com/chriscmorin/snowpack-viewer');
      await page.keyboard.press('Escape');
      assert.equal(await dialog.isVisible(), false);
      await button.click();
      await dialog.getByRole('button', { name: 'Close' }).click();
      assert.equal(await dialog.isVisible(), false);
      const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(width.scroll <= width.viewport + 2, `source dialog horizontal overflow: ${JSON.stringify(width)}`);
      assert.deepEqual(requests, []);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});

test('source URL build override requires HTTPS', () => {
  for (const invalid of ['http://github.com/chriscmorin/snowpack-viewer', 'not a URL']) {
    const result = spawnSync(process.execPath, ['scripts/build.mjs'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, SPV_SOURCE_URL: invalid }
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /SPV_SOURCE_URL must be a valid HTTPS URL/);
  }
});

if (fullSeason) test('hosted demo loads its full MST example only on click and rejects changed data', { timeout: 90000 }, async () => {
  const served = [];
  const server = createServer(async (request, response) => {
    const route = request.url?.split('?')[0] ?? '';
    served.push(route);
    const files = {
      '/': demoPath,
      '/index.html': demoPath,
      '/snowpack-viewer.html': htmlPath,
      '/examples/snowpack-large-MST96.pro.gz': mstGzipPath
    };
    const file = files[route];
    if (!file) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', route.endsWith('.gz') ? 'application/gzip' : 'text/html; charset=utf-8');
    response.end(await readFile(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await launchSelectedBrowser();
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/index.html`;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    assert.equal(served.filter(path => path.endsWith('.gz')).length, 0);
    assert.equal(await page.getByRole('link', { name: 'Download offline viewer' }).getAttribute('href'), './snowpack-viewer.html');
    assert.equal(await page.getByRole('link', { name: 'Download example data' }).getAttribute('href'), './examples/snowpack-large-MST96.pro.gz');
    const viewerDownload = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download offline viewer' }).click();
    assert.deepEqual(await readFile(await (await viewerDownload).path()), await readFile(htmlPath));
    const dataDownload = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download example data' }).click();
    assert.deepEqual(await readFile(await (await dataDownload).path()), await readFile(mstGzipPath));
    const assetRequestsBeforeOpen = served.filter(path => path.endsWith('.gz')).length;
    await page.getByRole('button', { name: 'Open example' }).click();
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('1,832 timesteps'), null, { timeout: 30000 });
    assert.match(await page.locator('[role=status]').innerText(), /snowpack-large-MST96\.pro · 1,832 timesteps/);
    assert.equal(await page.locator('.spv-selected-date').innerText(), '1996-03-01 18:00 UTC');
    assert.equal(await page.locator('button[data-property="grainshape"]').getAttribute('aria-pressed'), 'true');
    assert.equal(served.filter(path => path.endsWith('.gz')).length, assetRequestsBeforeOpen + 1);
    await page.setViewportSize({ width: 390, height: 844 });
    // Canvas/SVG dimensions settle in their ResizeObserver callback after the viewport change.
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 2, null, { timeout: 5000 });
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: innerWidth,
      overflowing: [...document.querySelectorAll('body *')]
        .filter(node => node.getBoundingClientRect().right > innerWidth + 2)
        .slice(0, 8).map(node => `${node.tagName.toLowerCase()}.${node.className?.toString().replaceAll(' ', '.')}`)
    }));
    assert.ok(width.scroll <= width.viewport + 2, `hosted horizontal overflow: ${JSON.stringify(width)}`);
    assert.deepEqual(errors, []);

    const corruptPage = await browser.newPage();
    const source = await readFile(seasonSourcePath, 'utf8');
    const changed = gzipSync(source.replace('Weissfluhjoch', 'Changed-station'));
    await corruptPage.route('**/examples/snowpack-large-MST96.pro.gz', route => route.fulfill({ status: 200, contentType: 'application/gzip', body: changed }));
    await corruptPage.goto(url);
    await corruptPage.getByRole('button', { name: 'Open example' }).click();
    await corruptPage.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('did not match the expected file'), null, { timeout: 30000 });
    assert.equal(await corruptPage.locator('.spv-viewer').count(), 0);
    assert.equal(await corruptPage.getByRole('button', { name: 'Open example' }).isEnabled(), true);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('local small PRO exposes the agreed menus and exports PNG', async () => {
  const browser = await launchSelectedBrowser();
  try {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => route.abort());
    await page.goto(pathToFileURL(htmlPath).href);
    await page.locator('input[type=file]').setInputFiles(resolve(root, 'fixtures/niviz-example.pro'));
    await page.locator('.spv-viewer').waitFor();
    assert.match(await page.locator('[role=status]').innerText(), /48 timesteps/);
    await page.locator('summary[aria-label="Timeline menu"]').click();
    const timelineItems = await page.locator('.spv-panel-timeline .spv-menu-items button').allTextContents();
    assert.deepEqual(timelineItems, [
      'Snow temperature', 'Grain shape', 'Grain size', 'Snow density',
      'Liquid water content', 'Sphericity', 'Dendricity',
      'Show soil layers', 'Print', 'Export PNG'
    ]);
    for (const property of ['temperature', 'grainshape', 'grainsize', 'density', 'wetness', 'sphericity', 'dendricity']) {
      await page.locator(`button[data-property="${property}"]`).click();
      assert.equal(await page.locator(`button[data-property="${property}"]`).getAttribute('aria-pressed'), 'true');
      await page.locator('summary[aria-label="Timeline menu"]').click();
    }
    await page.locator('summary[aria-label="Timeline menu"]').click();
    await page.locator('summary[aria-label="Profile menu"]').click();
    assert.deepEqual(await page.locator('.spv-panel-profile .spv-menu-items button').allTextContents(), ['Export PNG']);
    const profileDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export profile PNG' }).click();
    const profileFile = await profileDownload;
    assert.match(profileFile.suggestedFilename(), /-profile\.png$/);
    const profileSize = pngSize(await readFile(await profileFile.path()));
    assert.ok(profileSize.width >= 300 && profileSize.height >= 400);
    await page.locator('summary[aria-label="Timeline menu"]').click();
    const timelineDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export timeline PNG' }).click();
    const timelineFile = await timelineDownload;
    assert.match(timelineFile.suggestedFilename(), /-timeline\.png$/);
    const timelineSize = pngSize(await readFile(await timelineFile.path()));
    assert.ok(timelineSize.width >= 400 && timelineSize.height >= 350);
    const dateBefore = await page.locator('.spv-selected-date').innerText();
    assert.equal(await page.locator('.spv-profile-host svg').getAttribute('aria-label'), profileDateFromFooter(dateBefore));
    await page.locator('.spv-viewer').focus();
    await page.keyboard.press('ArrowLeft');
    const dateAfter = await page.locator('.spv-selected-date').innerText();
    assert.notEqual(dateAfter, dateBefore);
    assert.equal(await page.locator('.spv-profile-host svg').getAttribute('aria-label'), profileDateFromFooter(dateAfter));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('soil toggle and narrow viewport remain usable', { timeout: 90000 }, async () => {
  const browser = await launchSelectedBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/^https?:\/\//, route => route.abort());
    await page.goto(pathToFileURL(htmlPath).href);
    await page.locator('input[type=file]').setInputFiles(resolve(root, 'fixtures/snowpack-soil-gems.pro'));
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('25 timesteps'));
    assert.match(await page.locator('[role=status]').innerText(), /25 timesteps/);
    await page.locator('summary[aria-label="Timeline menu"]').click();
    assert.equal(await page.getByRole('button', { name: 'Hide soil layers' }).count(), 1);
    await page.getByRole('button', { name: 'Hide soil layers' }).click();
    await page.locator('summary[aria-label="Timeline menu"]').click();
    assert.equal(await page.getByRole('button', { name: 'Show soil layers' }).count(), 1);
    await page.locator('summary[aria-label="Timeline menu"]').click();
    const size = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(size.scroll <= size.viewport + 2, `horizontal overflow: ${JSON.stringify(size)}`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

if (fullSeason) test('full-season PRO loads locally within the browser', { timeout: 90000 }, async () => {
  assert.ok(existsSync(seasonSourcePath), `Missing verified fixture: ${seasonSourcePath}`);
  const browser = await launchSelectedBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(htmlPath).href);
    const started = performance.now();
    await page.locator('input[type=file]').setInputFiles(seasonSourcePath);
    await page.waitForFunction(() => document.querySelector('[role=status]')?.textContent?.includes('1,832 timesteps'), null, { timeout: 60000 });
    const elapsed = performance.now() - started;
    assert.match(await page.locator('[role=status]').innerText(), /1,832 timesteps/);
    assert.ok(elapsed < 60000, `full-season fixture took ${elapsed} ms`);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('timeline hover previews, click pins, and clicking the same date unpins', async () => {
  const browser = await launchSelectedBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(pathToFileURL(htmlPath).href);
    await page.locator('input[type=file]').setInputFiles(resolve(root, 'fixtures/niviz-example.pro'));
    await page.locator('.spv-viewer').waitFor();
    const canvas = await page.locator('.spv-timeline-canvas').boundingBox();
    assert.ok(canvas);
    const y = canvas.y + canvas.height * 0.5;
    const xA = canvas.x + canvas.width * 0.35;
    const xB = canvas.x + canvas.width * 0.75;
    const footer = () => page.locator('.spv-selected-date').innerText();
    const svgDate = () => page.locator('.spv-profile-host svg').getAttribute('aria-label');
    await page.mouse.move(xA, y);
    const preview = await footer();
    assert.match(preview, / · preview$/);
    assert.equal(await svgDate(), profileDateFromFooter(preview.replace(/ · preview$/, '')));
    await page.mouse.click(xA, y);
    const pinned = await footer();
    assert.equal(pinned, preview.replace(/ · preview$/, ''));
    assert.equal(await svgDate(), profileDateFromFooter(pinned));
    await page.mouse.move(xB, y);
    assert.equal(await footer(), pinned);
    assert.equal(await svgDate(), profileDateFromFooter(pinned));
    await page.mouse.move(xA, y);
    await page.mouse.click(xA, y);
    await page.mouse.move(xB, y);
    const afterUnpin = await footer();
    assert.match(afterUnpin, / · preview$/);
    assert.notEqual(afterUnpin.replace(/ · preview$/, ''), pinned);
    assert.equal(await svgDate(), profileDateFromFooter(afterUnpin.replace(/ · preview$/, '')));
  } finally {
    await browser.close();
  }
});

test('npm entry embeds two independent viewers', async () => {
  const fixture = await readFile(resolve(root, 'fixtures/niviz-example.pro'), 'utf8');
  const bundle = await build({
    stdin: {
      contents: "import { parsePro, createViewer } from './dist/npm/index.js'; window.spv = { parsePro, createViewer };",
      resolveDir: root,
      sourcefile: 'embed-test.js'
    },
    bundle: true, write: false, format: 'iife', platform: 'browser'
  });
  const browser = await launchSelectedBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<main><div id="first"></div><div id="second"></div></main>');
    await page.addStyleTag({ path: resolve(root, 'dist/npm/style.css') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(text => {
      const station = window.spv.parsePro(text);
      const first = window.spv.createViewer(document.getElementById('first'), station, { property: 'temperature' });
      const second = window.spv.createViewer(document.getElementById('second'), station, { property: 'density' });
      const initial = [
        document.querySelector('#first button[data-property="temperature"]').getAttribute('aria-pressed'),
        document.querySelector('#second button[data-property="density"]').getAttribute('aria-pressed')
      ];
      first.setProperty('grainshape');
      const independent = document.querySelector('#second button[data-property="density"]').getAttribute('aria-pressed');
      first.destroy();
      const secondExists = !!document.querySelector('#second .spv-viewer');
      second.destroy();
      return { initial, independent, secondExists, count: document.querySelectorAll('.spv-viewer').length };
    }, fixture);
    assert.deepEqual(result, { initial: ['true', 'true'], independent: 'true', secondExists: true, count: 0 });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
