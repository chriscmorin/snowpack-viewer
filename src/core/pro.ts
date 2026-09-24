import type { ParseProOptions, ProField, ProHeader, ProLayer, ProProfile, ProStability, ProStation } from './types.js';

/** Field names in the two SNOWPACK PRO dialects recognized by niViz ProParser. */
const LEGACY: Record<string, string> = {
  '0500': 'date', '0501': 'height', '0502': 'density', '0503': 'temperature',
  '0506': 'lwc', '0508': 'dendricity', '0509': 'sphericity',
  '0510': 'coordinationNumber', '0511': 'bondSize', '0512': 'grainSize',
  '0513': 'grainShape', '0515': 'iceVolumeFraction', '0516': 'airVolumeFraction',
  '0517': 'stress', '0518': 'viscosity', '0519': 'soilVolumeFraction',
  '0520': 'temperatureGradient', '0521': 'thermalConductivity',
  '0522': 'absorbedShortwaveRadiation', '0523': 'viscousDeformationRate',
  '0530': 'stability', '0531': 'sdef', '0532': 'sn38', '0533': 'sk38',
  '0534': 'hardness', '0535': 'opticalGrainSize', '0601': 'snowShearStrength',
  '0602': 'grainSizeDifference', '0603': 'hardnessDifference', '0604': 'ssi',
  '0605': 'inverseTextureIndex'
};
const V14: Record<string, string> = {
  '0500': 'date', '0501': 'height', '0503': 'density', '0506': 'lwc',
  '0510': 'temperature', '0513': 'grainShape', '0516': 'grainSize',
  '0517': 'bondSize', '0518': 'dendricity', '0519': 'sphericity',
  '0520': 'coordinationNumber', '0530': 'stability', '0540': 'hardness',
  '0910': 'nodeTemperature'
};

export class ProParseError extends Error {
  constructor(message: string, readonly line: number) {
    super(`PRO line ${line}: ${message}`);
    this.name = 'ProParseError';
  }
}

interface RecordLine { id: string; payload: string; line: number }

function numeric(token: string, line: number): number | null {
  const trimmed = token.trim();
  if (trimmed === '' || /^(-?nan|undefined|null|nodata)$/i.test(trimmed)) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed))
    throw new ProParseError(`invalid number "${trimmed}"`, line);
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function dateUTC(value: string, line: number): Date {
  const legacy = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  let date: Date;
  if (legacy) {
    date = new Date(Date.UTC(Number(legacy[3]), Number(legacy[2]) - 1, Number(legacy[1]),
      Number(legacy[4]), Number(legacy[5]), Number(legacy[6] ?? 0)));
    if (date.getUTCFullYear() !== Number(legacy[3]) || date.getUTCMonth() !== Number(legacy[2]) - 1 ||
        date.getUTCDate() !== Number(legacy[1]) || date.getUTCHours() !== Number(legacy[4]) ||
        date.getUTCMinutes() !== Number(legacy[5]))
      throw new ProParseError(`invalid date "${value}"`, line);
  } else {
    // niViz uses moment.utc for ISO values, including explicit offsets.
    date = new Date(value.trim());
  }
  if (Number.isNaN(date.getTime())) throw new ProParseError(`invalid date "${value}"`, line);
  return date;
}

function valuesOf(record: RecordLine, strict: boolean): { values: (number | null)[]; tokens: string[] } {
  const pieces = record.payload.split(',');
  const declared = Number(pieces.shift()?.trim());
  if (!Number.isInteger(declared) || declared < 0)
    throw new ProParseError(`invalid value count for ${record.id}`, record.line);
  const tokens = pieces.map(piece => piece.trim());
  if (tokens.length > declared || (strict && tokens.length !== declared))
    throw new ProParseError(`${record.id} declares ${declared} values but has ${tokens.length}`, record.line);
  return { values: tokens.map(token => numeric(token, record.line)), tokens };
}

function stabilityOf(values: (number | null)[], line: number): ProStability {
  if (values.length !== 8) throw new ProParseError('0530 requires eight stability values', line);
  const clean = (n: number | null | undefined): number | null => n ?? null;
  return {
    profileType: clean(values[0]), stabilityClass: clean(values[1]),
    zSdef: clean(values[2]), sdef: clean(values[3]),
    zSn38: clean(values[4]), sn38: clean(values[5]),
    zSk38: clean(values[6]), sk38: clean(values[7])
  };
}

function parseProfile(records: RecordLine[], headers: Record<string, ProHeader>,
  names: Record<string, string>, strict: boolean): ProProfile {
  const dateRecord = records[0]!;
  const date = dateUTC(dateRecord.payload, dateRecord.line);
  const heightRecord = records.find(record => record.id === '0501');
  if (!heightRecord) throw new ProParseError('missing 0501 layer heights', dateRecord.line);
  const heights = valuesOf(heightRecord, strict).values.map((n, i) => {
    if (n === null) throw new ProParseError(`missing height ${i + 1}`, heightRecord.line);
    return n;
  });
  for (let i = 1; i < heights.length; i++) {
    if (heights[i]! <= heights[i - 1]!)
      throw new ProParseError('0501 heights must increase from bottom to top', heightRecord.line);
  }
  const firstIsSoilBoundary = (heights[0] ?? 0) < 0;
  const boundaries = firstIsSoilBoundary ? heights.slice() : [0, ...heights];
  const layers: ProLayer[] = [];
  for (let i = 1; i < boundaries.length; i++) {
    const bottom = boundaries[i - 1]!;
    const top = boundaries[i]!;
    layers.push({ index: i - 1, top, bottom,
      kind: top <= 0 ? 'soil' : 'snow', values: {} });
  }
  const snow = layers.filter(layer => layer.top > 0);
  const fields: Record<string, ProField> = {};
  let stability: ProStability | null = null;
  let surfaceHoar = false;
  for (const record of records.slice(1)) {
    if (record.id === '0501') continue;
    if (!headers[record.id] && strict) throw new ProParseError(`no HEADER definition for ${record.id}`, record.line);
    const { values, tokens } = valuesOf(record, strict);
    if (record.id === '0530') {
      stability = stabilityOf(values, record.line);
      fields[record.id] = { id: record.id, name: 'stability', type: 'properties',
        samples: [], rawValues: values, rawTokens: tokens };
      continue;
    }
    let aligned = values;
    if (record.id === '0513' && values.length > 0) {
      aligned = values.slice(0, -1); // terminal marker follows all grain-shape elements in niViz
      // niViz skips the entire grain-shape property when only the terminal marker remains.
      if (aligned.length > 0) surfaceHoar = values[values.length - 1] === 660;
    }
    const header = headers[record.id];
    const type = header?.type ?? 'nElems';
    const nodes = /^nnodes(?:\+\d+)?$/i.test(type);
    const allPositions = nodes ? boundaries : layers.map(layer => layer.top);
    const snowPositions = nodes ? [0, ...snow.map(layer => layer.top)] : snow.map(layer => layer.top);
    let target: ProLayer[] | null = null;
    if (!nodes && aligned.length === layers.length) target = layers;
    else if (!nodes && aligned.length === snow.length) target = snow;
    const nodePositions = nodes
      ? aligned.length === allPositions.length ? allPositions
        : aligned.length === snowPositions.length ? snowPositions : null
      : null;
    // niViz skips a property if its count fits neither all elements nor snow-only elements.
    const samples = target || nodePositions ? aligned.map((value, index) => {
      if (target) {
        const layer = target[index]!;
        layer.values[record.id] = record.id === '0534' || record.id === '0540'
          ? value === null ? null : Math.abs(value) : value;
        return { top: layer.top, bottom: target === snow ? Math.max(0, layer.bottom) : layer.bottom,
          value: layer.values[record.id]! };
      }
      const position = nodePositions![index]!;
      return { top: position, bottom: position, value };
    }) : [];
    fields[record.id] = { id: record.id, name: names[record.id] ?? header?.description ?? record.id,
      type, samples, rawValues: values, rawTokens: tokens };
  }
  return { dateText: dateRecord.payload.trim(), date, timestamp: date.getTime(), heights,
    top: heights.at(-1) ?? 0, bottom: boundaries[0] ?? 0, layers, fields, stability, surfaceHoar };
}

/** Parse SNOWPACK PRO 1.0 or 1.4 ASCII. Times are UTC as in niViz ProParser. */
export function parsePro(text: string, options: ParseProOptions = {}): ProStation {
  const strict = options.strict !== false;
  const station: ProStation = {
    name: '', latitude: null, longitude: null, altitude: null,
    slopeAngle: null, slopeAzimuth: null, parameters: {}, headers: {}, version: 1,
    profiles: []
  };
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  let section = '';
  let pending: RecordLine[] = [];
  let lastHeaderId: string | null = null;
  const flush = () => {
    if (pending.length) {
      station.profiles.push(parseProfile(pending, station.headers,
        station.version >= 1.4 ? V14 : LEGACY, strict));
      pending = [];
    }
  };
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]!;
    const lineNumber = index + 1;
    const line = raw.trim();
    const version = /^#\s*PRO\s+(\d+(?:\.\d+)?)\s+ASCII/i.exec(line);
    if (version) { station.version = Number(version[1]); continue; }
    if (line === '' || /^[#";]/.test(line)) continue;
    const sectionMatch = /^\[(\w+)\]$/.exec(line);
    if (sectionMatch) { flush(); section = sectionMatch[1]!.toLowerCase(); continue; }
    if (section === 'station_parameters') {
      const match = /^([\w:.\-]+)\s*=\s*(.*)$/.exec(line);
      if (!match) { if (strict) throw new ProParseError('invalid station parameter', lineNumber); continue; }
      const key = match[1]!;
      const value = match[2]!.trim();
      station.parameters[key] = value;
      switch (key.toLowerCase()) {
        case 'stationname': station.name = value; break;
        case 'latitude': station.latitude = numeric(value, lineNumber); break;
        case 'longitude': station.longitude = numeric(value, lineNumber); break;
        case 'altitude': station.altitude = numeric(value, lineNumber); break;
        case 'slopeangle': station.slopeAngle = numeric(value, lineNumber); break;
        case 'slopeazi': station.slopeAzimuth = numeric(value, lineNumber); break;
      }
      continue;
    }
    if (section === 'header') {
      const match = /^(\d{4}),([^,]+)(?:,(.*))?$/.exec(line);
      if (match) {
        const id = match[1]!;
        let description = match[3] ?? '';
        while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1]!) &&
               !/^\s*\[/.test(lines[index + 1]!)) description += ` ${lines[++index]!.trim()}`;
        station.headers[id] = { id, type: /^\d+$/.test(match[2]!) ? 'nElems' : match[2]!,
          description: description.trim(), line: lineNumber };
        lastHeaderId = id;
      } else if (lastHeaderId && /^[a-z]/i.test(line)) {
        station.headers[lastHeaderId]!.description += ` ${line}`;
      } else if (strict) throw new ProParseError('invalid HEADER field', lineNumber);
      continue;
    }
    if (section === 'data') {
      const match = /^(\d{4}),(.*)$/.exec(line);
      if (!match) { if (strict) throw new ProParseError('invalid DATA record', lineNumber); continue; }
      const record = { id: match[1]!, payload: match[2]!, line: lineNumber };
      if (record.id === '0500') flush();
      else if (!pending.length) throw new ProParseError('expected 0500 date before profile data', lineNumber);
      pending.push(record);
      continue;
    }
    if (strict) throw new ProParseError(`record outside recognized section: ${line}`, lineNumber);
  }
  flush();
  if (strict && !station.profiles.length) throw new ProParseError('no profiles found', lines.length);
  return station;
}
