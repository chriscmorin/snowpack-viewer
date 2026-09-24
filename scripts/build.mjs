import { build, context } from 'esbuild';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deterministicGzip, readVerifiedSeason } from './example-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const demoDist = resolve(dist, 'demo');
const npmDist = resolve(dist, 'npm');
const watch = process.argv.includes('--watch');
const demo = process.argv.includes('--demo') || process.env.SPV_FULL_SEASON === '1';
const defaultSourceUrl = 'https://github.com/chriscmorin/snowpack-viewer';
const requestedSourceUrl = process.env.SPV_SOURCE_URL?.trim();
let sourceUrl = defaultSourceUrl;
if (requestedSourceUrl) {
  let parsed;
  try { parsed = new URL(requestedSourceUrl); }
  catch { throw new Error('SPV_SOURCE_URL must be a valid HTTPS URL.'); }
  if (parsed.protocol !== 'https:') throw new Error('SPV_SOURCE_URL must be a valid HTTPS URL.');
  sourceUrl = parsed.href;
}
const appEntry = resolve(root, 'src/app/main.ts');
const apiEntry = resolve(root, 'src/index.ts');
const seasonGzip = demo ? deterministicGzip(await readVerifiedSeason(root)) : null;
const seasonAsset = './examples/snowpack-large-MST96.pro.gz';

const appConfig = (demo) => ({
  entryPoints: [appEntry],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: !watch,
  define: {
    __EXAMPLE_URL__: JSON.stringify(demo ? seasonAsset : ''),
    __VIEWER_DOWNLOAD_URL__: JSON.stringify(demo ? './snowpack-viewer.html' : ''),
    __SOURCE_URL__: JSON.stringify(sourceUrl)
  },
  sourcemap: false,
  loader: { '.css': 'css' },
  outdir: dist,
  logLevel: 'warning'
});

function escapeHtmlScript(s) {
  return s.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');
}

function escapeHtmlStyle(s) {
  return s.replaceAll('</style', '<\\/style');
}

async function writeStandalone(result, path) {
  const js = result.outputFiles.find(file => file.path.endsWith('.js'));
  const css = result.outputFiles.find(file => file.path.endsWith('.css'));
  if (!js) throw new Error('Application bundle was not produced');
  const template = await readFile(resolve(root, 'scripts/template.html'), 'utf8');
  const notices = await Promise.all([
    readFile(resolve(root, 'NOTICE'), 'utf8'),
    readFile(resolve(root, 'LICENSE'), 'utf8'),
    readFile(resolve(root, 'docs/upstream.md'), 'utf8'),
    readFile(resolve(root, 'docs/NIVIZ-SITE-CC-BY-4.0.txt'), 'utf8'),
    readFile(resolve(root, 'docs/SNOWPACK-LICENSE.txt'), 'utf8'),
    readFile(resolve(root, 'docs/SNOWPACK-GPL-3.0.txt'), 'utf8')
  ]);
  const page = template
    .replace('/* INLINE_CSS */', () => escapeHtmlStyle(css?.text ?? ''))
    .replace('/* INLINE_JS */', () => escapeHtmlScript(js.text))
    .replace('/* INLINE_LICENSES */', () => escapeHtmlScript(notices.join('\n\n')));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, page);
  console.log(`Built ${path}`);
}

async function writeDemoAsset() {
  if (!seasonGzip) throw new Error('The full-season example must be imported before building the demo.');
  await mkdir(resolve(demoDist, 'examples'), { recursive: true });
  await writeFile(resolve(demoDist, 'examples/snowpack-large-MST96.pro.gz'), seasonGzip);
}

async function buildPackage() {
  await rm(npmDist, { recursive: true, force: true });
  await mkdir(npmDist, { recursive: true });
  await build({
    entryPoints: [apiEntry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outfile: resolve(npmDist, 'index.js'),
    sourcemap: false,
    logLevel: 'warning'
  });
  execFileSync(resolve(root, 'node_modules/.bin/tsc'), [
    '--declaration', '--emitDeclarationOnly', '--noEmit', 'false',
    '--rootDir', 'src', '--outDir', npmDist
  ], { cwd: root, stdio: 'inherit' });
  async function fixDeclarationImports(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await fixDeclarationImports(path);
      else if (entry.name.endsWith('.d.ts')) {
        const source = await readFile(path, 'utf8');
        await writeFile(path, source.replace(/(from\s+['"])(\.\.?\/[^'"]+)(['"])/g,
          (_, before, specifier, after) => `${before}${specifier.endsWith('.js') ? specifier : `${specifier}.js`}${after}`));
      }
    }
  }
  await fixDeclarationImports(npmDist);
  const stylesheet = resolve(root, 'src/render/styles.css');
  if (existsSync(stylesheet)) await writeFile(resolve(npmDist, 'style.css'), await readFile(stylesheet, 'utf8'));
  else await writeFile(resolve(npmDist, 'style.css'), '');
}

if (watch) {
  if (demo) await writeDemoAsset();
  else await rm(demoDist, { recursive: true, force: true });
  for (const [demoPage, path] of [
    [false, resolve(dist, 'snowpack-viewer.html')],
    ...(demo ? [[true, resolve(demoDist, 'index.html')]] : [])
  ]) {
    const ctx = await context({
      ...appConfig(demoPage),
      plugins: [{
        name: 'single-file-html',
        setup(pluginBuild) {
          pluginBuild.onEnd(async result => {
            if (result.errors.length !== 0) return;
            await writeStandalone(result, path);
            if (!demoPage && demo) {
              await mkdir(demoDist, { recursive: true });
              await writeFile(resolve(demoDist, 'snowpack-viewer.html'), await readFile(path));
            }
          });
        }
      }]
    });
    await ctx.watch();
  }
  console.log(`Watching ${demo ? 'standalone and demo' : 'standalone'} source files`);
} else {
  await writeStandalone(await build(appConfig(false)), resolve(dist, 'snowpack-viewer.html'));
  await rm(demoDist, { recursive: true, force: true });
  if (demo) {
    await writeStandalone(await build(appConfig(true)), resolve(demoDist, 'index.html'));
    await writeFile(resolve(demoDist, 'snowpack-viewer.html'), await readFile(resolve(dist, 'snowpack-viewer.html')));
    await writeDemoAsset();
  }
  await buildPackage();
}
