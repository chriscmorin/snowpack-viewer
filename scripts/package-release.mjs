import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVerifiedSeason, seasonRelativePath, sha256 } from './example-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const release = resolve(root, 'dist/release');
const run = (program, args, options = {}) => execFileSync(program, args, { cwd: root, stdio: 'inherit', ...options });

if (!process.argv.includes('--skip-check')) run('npm', ['run', 'check']);
const seasonCached = existsSync(resolve(root, seasonRelativePath));
if (seasonCached) {
  await readVerifiedSeason(root);
  // A normal check intentionally removes the demo. Restore it when the verified asset exists.
  if (!existsSync(resolve(root, 'dist/demo/index.html'))) run('npm', ['run', 'build:demo']);
} else if (process.env.SPV_FULL_SEASON === '1') {
  throw new Error('Full-season release requested but its verified example is missing. Import it with npm run example:import first.');
}

await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });
const artifacts = [];
const offlineName = 'snowpack-viewer.html';
await copyFile(resolve(root, 'dist', offlineName), resolve(release, offlineName));
artifacts.push(offlineName);

const packJson = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', release], { cwd: root, encoding: 'utf8' }));
const packageName = packJson[0]?.filename;
if (!packageName) throw new Error('npm pack did not report a package archive');
artifacts.push(packageName);

// Use current files, including uncommitted changes, while excluding caches/builds and deleted files.
const sourceNames = [
  '.github', '.gitignore', 'LICENSE', 'NOTICE', 'README.md', 'docs', 'fixtures',
  'package.json', 'package-lock.json', 'scripts', 'src', 'tests', 'tsconfig.json'
].filter(name => existsSync(resolve(root, name)));
const sourceName = 'snowpack-viewer-source.tar.gz';
const archiveScript = `
import gzip, io, os, pathlib, sys, tarfile
root, output, *names = sys.argv[1:]
paths = []
for name in names:
    path = pathlib.Path(root, name)
    if path.is_file() and not path.is_symlink(): paths.append(path)
    elif path.is_dir():
        paths += sorted(p for p in path.rglob('*') if p.is_file() and not p.is_symlink()
                        and '__pycache__' not in p.parts and p.name != '.DS_Store'
                        and not p.name.endswith('.pyc')
                        and str(p.relative_to(root)) != 'fixtures/snowpack-large-MST96.pro')
with open(output, 'wb') as target:
    with gzip.GzipFile(fileobj=target, mode='wb', filename='', mtime=0) as zipped:
        with tarfile.open(fileobj=zipped, mode='w') as archive:
            for path in sorted(paths):
                info = archive.gettarinfo(str(path), arcname=str(path.relative_to(root)))
                info.uid = info.gid = 0
                info.uname = info.gname = ''
                info.mtime = 0
                with open(path, 'rb') as source: archive.addfile(info, source)
`;
run('python3', ['-c', archiveScript, root, resolve(release, sourceName), ...sourceNames]);
artifacts.push(sourceName);

if (seasonCached) {
  const gzipName = 'snowpack-large-MST96.pro.gz';
  await copyFile(resolve(root, 'dist/demo/examples', gzipName), resolve(release, gzipName));
  artifacts.push(gzipName);
  const demoName = 'snowpack-viewer-demo.zip';
  const zipScript = `
import os, pathlib, sys, zipfile
source, output = map(pathlib.Path, sys.argv[1:])
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(p for p in source.rglob('*') if p.is_file()):
        info = zipfile.ZipInfo(str(path.relative_to(source)), (1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
`;
  run('python3', ['-c', zipScript, resolve(root, 'dist/demo'), resolve(release, demoName)]);
  artifacts.push(demoName);
}

const lines = [];
for (const name of artifacts) {
  const bytes = await readFile(resolve(release, name));
  lines.push(`${sha256(bytes)}  ${name}`);
}
await writeFile(resolve(release, 'SHA256SUMS'), `${lines.join('\n')}\n`);
for (const name of artifacts) {
  const size = (await stat(resolve(release, name))).size;
  console.log(`${name}: ${size} bytes`);
}
console.log(`Release files: ${release}`);
