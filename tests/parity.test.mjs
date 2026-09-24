import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fullSeason = process.env.SPV_FULL_SEASON === '1';
const seasonPath = resolve(root, '.cache/examples/snowpack-large-MST96.pro');
const compiled = await build({ entryPoints: [resolve(root, 'src/core/pro.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { parsePro } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString('base64')}`);
const timelineBuild = await build({ entryPoints: [resolve(root, 'src/render/timeline.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { colorForValue } = await import(`data:text/javascript;base64,${Buffer.from(timelineBuild.outputFiles[0].contents).toString('base64')}`);
const profileBuild = await build({ entryPoints: [resolve(root, 'src/render/profile.ts')],
  bundle: true, platform: 'node', format: 'esm', write: false });
const { hardnessNewton } = await import(`data:text/javascript;base64,${Buffer.from(profileBuild.outputFiles[0].contents).toString('base64')}`);

// These hashes identify the exact external fixtures used for parity review.
const cases = [
  ['niviz-example.pro', 'bcb5f364e9df35d4c3352271510c8b8ef830ee8ebf28a00d1414b5d3895b921d', 48, [0, 24, 47]],
  ['snowpack-soil-gems.pro', '554fb9cbf130a4fcd437bc6accc74f773ce1f045f6587ff105717b61045bbe6e', 25, [0, 12, 24]],
  ['snowpack-albedo-WFJ2.pro', '2a2c31c81ecc3713c9c82153e2431b551c692338edc6180d1d93280f488820d2', 2225, [0, 1112, 2224]]
];
if (fullSeason) cases.push(['snowpack-large-MST96.pro', '0fa1c925b4f9c2da16098715923211e4d3d857b10098548946c9bda685f6956a', 1832, [0, 916, 1831]]);
if (fullSeason) test('full-season fixture exists for parity checks', () => {
  assert.ok(existsSync(seasonPath), `Missing verified fixture: ${seasonPath}`);
});

// Independent record extraction: no layer alignment, name map or parser helper is used.
function records(text) {
  const data = text.split('[DATA]')[1];
  assert.ok(data);
  return data.split(/\r?\n/).reduce((profiles, line) => {
    if (!/^\d{4},/.test(line)) return profiles;
    const [id, ...tokens] = line.split(',');
    if (id === '0500') profiles.push({ date: tokens.join(','), records: new Map() });
    else profiles.at(-1).records.set(id, tokens);
    return profiles;
  }, []);
}

function numbers(tokens) {
  const count = Number(tokens[0]);
  const values = tokens.slice(1).map(Number);
  assert.equal(values.length, count);
  return values;
}

for (const [filename, expectedHash, count, checkpoints] of cases) {
  test(`${filename}: pinned source dates, heights, raw measurements and layer geometry`, async () => {
    const bytes = await readFile(filename === 'snowpack-large-MST96.pro' ? seasonPath : resolve(root, 'fixtures', filename));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
    const raw = records(bytes.toString('utf8'));
    const station = parsePro(bytes.toString('utf8'));
    assert.equal(raw.length, count);
    assert.equal(station.profiles.length, count);
    for (let index = 0; index < count; index++) {
      const actual = station.profiles[index];
      const source = raw[index];
      assert.equal(actual.dateText, source.date, `date ${index}`);
      assert.equal(actual.timestamp, actual.date.getTime(), `timestamp ${index}`);
      if (!checkpoints.includes(index)) continue;
      const heights = numbers(source.records.get('0501'));
      assert.deepEqual(actual.heights, heights, `0501 ${index}`);
      const boundaries = heights[0] < 0 ? heights : [0, ...heights];
      assert.deepEqual(actual.layers.map(layer => [layer.bottom, layer.top]),
        boundaries.slice(1).map((top, n) => [boundaries[n], top]), `layer bounds ${index}`);
      assert.equal(actual.top, heights.at(-1), `surface height ${index}`);
      for (const id of ['0502', '0503', '0506', '0508', '0509', '0512', '0513', '0530', '0534']) {
        const tokens = source.records.get(id);
        if (!tokens) continue;
        assert.deepEqual(actual.fields[id].rawValues, numbers(tokens), `${id} raw ${index}`);
      }
      if (source.records.has('0530')) {
        const values = numbers(source.records.get('0530'));
        assert.equal(actual.stability.sk38, values[7], `Sk38 ${index}`);
        assert.equal(actual.stability.sdef, values[3], `Sdef ${index}`);
      }
      if (source.records.has('0513')) {
        const values = numbers(source.records.get('0513'));
        assert.equal(actual.fields['0513'].samples.length, values.length - 1,
          `terminal grain marker is excluded ${index}`);
        assert.equal(actual.surfaceHoar, values.at(-1) === 660, `surface hoar ${index}`);
      }
    }
  });
}

test('legacy niViz source values retain 999 stability marker and hardness units', async () => {
  const text = await readFile(resolve(root, 'fixtures/niviz-example.pro'), 'utf8');
  const first = parsePro(text).profiles[0];
  assert.equal(first.stability.sdef, 999);
  assert.equal(first.stability.sk38, 6);
  assert.equal(first.layers[0].values['0534'], 4); // signed PRO index becomes absolute HHI
  assert.equal(first.fields['0534'].rawValues[0], -4);
  assert.equal(first.layers[0].values['0502'], 587.2); // kg/m³, never HHI
  assert.equal(first.layers[0].values['0503'], -0.01); // degrees Celsius
});

test('soil and snow-only arrays keep niViz source geometry separately', () => {
  const text = `[STATION_PARAMETERS]\nStationName= Mixed\n[HEADER]\n0500,Date\n0501,nElems,height\n0502,nElems,density\n0503,nElems,temperature\n[DATA]\n0500,01.01.2020 00:00\n0501,4,-4,-2,2,5\n0502,3,100,200,300\n0503,2,-5,-10`;
  const profile = parsePro(text).profiles[0];
  assert.deepEqual(profile.fields['0502'].samples.map(s => [s.bottom, s.top]),
    [[-4, -2], [-2, 2], [2, 5]]);
  assert.deepEqual(profile.fields['0503'].samples.map(s => [s.bottom, s.top]),
    [[0, 2], [2, 5]]);
});

test('zero, missing and short property arrays remain distinct', () => {
  const text = `[HEADER]\n0500,Date\n0501,nElems,height\n0502,nElems,density\n0503,nElems,temperature\n[DATA]\n0500,01.01.2020 00:00\n0501,2,5,10\n0502,2,0,NaN\n0503,1,-3`;
  const profile = parsePro(text).profiles[0];
  assert.deepEqual(profile.fields['0502'].rawValues, [0, null]);
  assert.equal(profile.layers[0].values['0502'], 0);
  assert.equal(profile.layers[1].values['0502'], null);
  assert.deepEqual(profile.fields['0503'].rawValues, [-3]);
  assert.deepEqual(profile.fields['0503'].samples, []);
  assert.equal(Object.hasOwn(profile.layers[0].values, '0503'), false);
});

test('a lone legacy surface-hoar terminal marker does not create a niViz surface layer', () => {
  const text = `[HEADER]\n0500,Date\n0501,nElems,height\n0513,nElems,grain shape\n[DATA]\n0500,01.01.2020 00:00\n0501,1,10\n0513,1,660`;
  const profile = parsePro(text).profiles[0];
  assert.deepEqual(profile.fields['0513'].rawValues, [660]);
  assert.deepEqual(profile.fields['0513'].samples, []);
  assert.equal(profile.surfaceHoar, false);
});

// Pinned run.niviz.org asset 62008f28… contains Gradient.palettes and linearcolor.
// Its channel interpolation truncates fractional RGB values (bitwise & 255).
test('timeline numerical colors use pinned niViz Gradient palettes and interpolation', () => {
  const endpoints = [
    ['temperature', -20, '#00007f', 0, '#ff0000'],
    ['grainsize', 0, '#f0f0f0', 4, '#00007f'],
    ['density', 0, '#f0f0f0', 600, '#00007f'],
    ['wetness', 0, '#f0f0f0', 4, '#00007f'],
    ['sphericity', 0, '#0000ff', 1, '#ff0000'],
    ['dendricity', 0, '#f0f0f0', 1, '#0000ff'],
  ];
  for (const [property, min, first, max, last] of endpoints) {
    assert.equal(colorForValue(property, min).toLowerCase(), first, `${property} min`);
    assert.equal(colorForValue(property, max).toLowerCase(), last, `${property} max`);
  }
  assert.equal(colorForValue('temperature', -17.5).toLowerCase(), '#0000bf');
  assert.equal(colorForValue('temperature', -10).toLowerCase(), '#00ffff');
  assert.equal(colorForValue('temperature', -5).toLowerCase(), '#f0f0f0');
});

test('timeline Swiss F1F2F3 colors include graupel, faceted rounding and crust override', () => {
  assert.equal(colorForValue('grainshape', 0).toLowerCase(), '#808080'); // PPgp
  assert.equal(colorForValue('grainshape', 100).toLowerCase(), '#00ff00'); // PP
  assert.equal(colorForValue('grainshape', 900).toLowerCase(), '#add8e6'); // FCxr
  assert.equal(colorForValue('grainshape', 772).toLowerCase(), '#ff0000'); // MFcr
});

test('profile hardness conversion uses niViz HHI-to-Newton anchor values', () => {
  const anchors = [[1, 20], [1.5, 50], [2, 100], [2.5, 175], [3, 250],
    [3.5, 390], [4, 500], [4.5, 715], [5, 1000], [5.5, 1100], [6, 1200]];
  for (const [hhi, newton] of anchors) {
    assert.equal(hardnessNewton(hhi, `-${hhi}`), newton, `HHI ${hhi}`);
  }
  assert.equal(hardnessNewton(0, '0'), null, 'niViz treats zero hardness as absent');
  assert.equal(hardnessNewton(10, '10'), 20, 'Newton input <=19.3 maps to HHI 1');
  assert.equal(hardnessNewton(1200, '1200'), 1200, 'upper Newton clamp');
});

if (fullSeason) test('March 1996 stability arrow and element temperatures use source heights', async () => {
  const text = await readFile(seasonPath, 'utf8');
  const profile = parsePro(text).profiles[973];
  assert.equal(profile.dateText, '01.03.1996 18:00:00');
  assert.equal(profile.layers.length, 86);
  assert.equal(profile.top, 117.42);
  assert.deepEqual(profile.fields['0530'].rawValues,
    [-1, 5, 19.9, 0.70, 33.4, 1.57, 67.2, 0.94]);
  assert.equal(profile.stability.stabilityClass, 5); // niViz SK38 label: good
  assert.equal(profile.stability.zSk38, 67.2);
  assert.equal(profile.stability.sk38, 0.94);
  assert.deepEqual([profile.layers[52].bottom, profile.layers[52].top], [66.52, 67.21]);
  assert.deepEqual(profile.fields['0503'].samples[0],
    { bottom: 0, top: 2.3, value: -0.16 });
  assert.deepEqual(profile.fields['0503'].samples.at(-1),
    { bottom: 114.75, top: 117.42, value: -11.42 });
});

test('element and node temperature samples have distinct niViz top coordinates', () => {
  const text = `# PRO 1.4 ASCII\n[HEADER]\n0500,Date\n0501,nElems,height\n0510,nElems,temperature\n0910,nNodes,node temperature\n[DATA]\n0500,2020-01-01T00:00:00Z\n0501,2,5,10\n0510,2,-3,-4\n0910,3,-2,-3,-4`;
  const profile = parsePro(text).profiles[0];
  assert.deepEqual(profile.fields['0510'].samples.map(s => s.top), [5, 10]);
  assert.deepEqual(profile.fields['0910'].samples.map(s => s.top), [0, 5, 10]);
});
