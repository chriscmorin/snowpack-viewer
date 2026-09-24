import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const compiled = await build({ entryPoints: [resolve(project, 'src/core/pro.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { parsePro, ProParseError } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
const scientificCompiled = await build({ entryPoints: [resolve(project, 'src/core/scientific.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { grainShape, hardnessIndex } = await import(`data:text/javascript;base64,${Buffer.from(scientificCompiled.outputFiles[0].contents).toString('base64')}`);

test('niViz example preserves station, temporal, element and stability values', async () => {
  const input = await readFile(resolve(project, 'fixtures/niviz-example.pro'), 'utf8');
  const station = parsePro(input);
  assert.equal(station.name, 'Davos:Baerentaelli');
  assert.equal(station.altitude, 2560);
  assert.equal(station.profiles.length, 48);
  const first = station.profiles[0];
  assert.equal(first.date.toISOString(), '2014-10-21T00:00:00.000Z');
  assert.deepEqual(first.heights, [0.97, 2.68, 4.12, 4.95]);
  assert.deepEqual(first.layers.map(layer => [layer.bottom, layer.top]),
    [[0, 0.97], [0.97, 2.68], [2.68, 4.12], [4.12, 4.95]]);
  assert.equal(first.layers[0].values['0502'], 587.2);
  assert.equal(first.layers[3].values['0503'], -0.01);
  assert.equal(first.layers[0].values['0534'], 4);
  assert.equal(first.fields['0534'].rawValues[0], -4);
  assert.deepEqual(first.fields['0513'].rawValues, [770, 770, 770, 770, 0]);
  assert.equal(first.fields['0513'].samples.length, 4);
  assert.equal(first.stability.sdef, 999);
  assert.equal(first.stability.sk38, 6);
  assert.equal(first.fields['0530'].samples.length, 0);
  assert.equal(first.surfaceHoar, false);
});

test('preserves unmatched field values without inventing element positions', () => {
  const text = `[HEADER]\n0500,Date\n0501,nElems,height\n0502,nElems,density\n[DATA]\n0500,01.01.2020 00:00\n0501,3,1,2,3\n0502,2,100,200`;
  const profile = parsePro(text).profiles[0];
  assert.deepEqual(profile.fields['0502'].rawValues, [100, 200]);
  assert.deepEqual(profile.fields['0502'].samples, []);
});

test('version 1.4 maps values to snow and soil with UTC ISO date', () => {
  const text = `# PRO 1.4 ASCII
[STATION_PARAMETERS]
StationName= test
[HEADER]
0500,Date
0501,nElems,height
0503,nElems,density
0510,nElems,temperature
0513,nElems,grain shape
0540,nElems,hardness
[DATA]
0500,2020-01-02T03:00:00+01:00
0501,4,-4,-2,2,5
0503,3,100,200,300
0510,2,-5,-10
0513,4,100,200,300,660
0540,2,-2,-4`;
  const station = parsePro(text);
  const profile = station.profiles[0];
  assert.equal(station.version, 1.4);
  assert.equal(profile.date.toISOString(), '2020-01-02T02:00:00.000Z');
  assert.deepEqual(profile.layers.map(layer => [layer.kind, layer.bottom, layer.top]),
    [['soil', -4, -2], ['snow', -2, 2], ['snow', 2, 5]]);
  assert.deepEqual(profile.fields['0503'].samples.map(sample => sample.value), [100, 200, 300]);
  assert.equal(profile.fields['0510'].samples[0].bottom, 0);
  assert.equal(profile.layers[1].values['0510'], -5);
  assert.equal(profile.layers[2].values['0540'], 4);
  assert.equal(profile.surfaceHoar, true);
});

test('reports source line for malformed declared count', () => {
  const text = `[HEADER]\n0500,Date\n0501,nElems,height\n0502,nElems,density\n[DATA]\n0500,01.01.2020 00:00\n0501,1,10\n0502,2,100`;
  assert.throws(() => parsePro(text), error => error instanceof ProParseError &&
    error.line === 8 && /declares 2 values but has 1/.test(error.message));
});

test('decodes Swiss grain shape and niViz hardness conversion', () => {
  assert.equal(grainShape(770).primary, 'MF');
  assert.equal(grainShape(772).primary, 'MFcr');
  assert.equal(grainShape(772).secondary, null);
  assert.equal(grainShape(220).primary, 'DF');
  assert.equal(hardnessIndex(-4), 4);
  assert.equal(hardnessIndex(19.3), 1);
  assert.equal(hardnessIndex(1200), 6);
});
