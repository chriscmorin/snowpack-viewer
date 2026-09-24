import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

export const seasonHash = '0fa1c925b4f9c2da16098715923211e4d3d857b10098548946c9bda685f6956a';
export const seasonRelativePath = '.cache/examples/snowpack-large-MST96.pro';

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function readVerifiedSeason(root) {
  const path = resolve(root, seasonRelativePath);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Full-season demo data is missing: ${path}\nImport a verified .pro or .pro.gz with npm run example:import -- --file <path>, then retry npm run build:demo.`);
    }
    throw error;
  }
  const actual = sha256(bytes);
  if (actual !== seasonHash) {
    throw new Error(`Full-season example checksum mismatch at ${path}: expected ${seasonHash}, got ${actual}. Reimport the original dataset.`);
  }
  return bytes;
}

export function deterministicGzip(bytes) {
  const gzip = gzipSync(bytes, { level: 9, mtime: 0 });
  gzip[9] = 255;
  return gzip;
}
