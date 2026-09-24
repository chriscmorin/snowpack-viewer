import { readFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { seasonHash, seasonRelativePath, sha256 } from './example-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const usage = 'Usage: npm run example:import -- --file <example.pro|example.pro.gz>\n   or: npm run example:import -- --url <https://example.org/example.pro.gz>\nA source URL is deliberately not preconfigured; the original full-season file must match the pinned SHA-256.';
if (args.length !== 2 || !['--file', '--url'].includes(args[0]) || !args[1]) {
  console.error(usage);
  process.exitCode = 2;
} else {
  let input;
  if (args[0] === '--file') {
    input = await readFile(resolve(args[1]));
  } else {
    const url = new URL(args[1]);
    if (url.protocol !== 'https:') throw new Error('Example download URL must use HTTPS.');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Example download failed: HTTP ${response.status} ${response.statusText}`);
    input = Buffer.from(await response.arrayBuffer());
  }
  const data = input[0] === 0x1f && input[1] === 0x8b ? gunzipSync(input) : input;
  const actual = sha256(data);
  if (actual !== seasonHash) throw new Error(`Example SHA-256 mismatch: expected ${seasonHash}, got ${actual}. Cache unchanged.`);
  const destination = resolve(root, seasonRelativePath);
  const temporary = `${destination}.${process.pid}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, data);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(`Verified ${data.length} bytes (${actual}) and imported ${destination}`);
}
