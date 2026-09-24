import type { ProLayer, ProProfile, ProStation } from '../core/types';
import { grainShape, hardnessIndex } from '../core/scientific';
import { drawGrainSymbol } from './profile-symbols';

/** The compact SimpleProfile shown by niViz when opening a PRO timeline. */
export interface ProfileController {
  update(profile: ProProfile, station: ProStation, displayProperty?: string, showSoil?: boolean): void;
  setProperty(displayProperty: string): void;
  setShowSoil(showSoil: boolean): void;
  destroy(): void;
  exportPNG(): Promise<Blob>;
}

const NS = 'http://www.w3.org/2000/svg';
const HARDNESS_NEWTON: Record<number, number> = {
  1: 20, 1.5: 50, 2: 100, 2.5: 175, 3: 250, 3.5: 390,
  4: 500, 4.5: 715, 5: 1000, 5.5: 1100, 6: 1200,
};
export function profileGrainColor(code: number | null): string {
  return grainShape(code)?.color ?? '#333333';
}

export function hardnessNewton(indexOrNewton: number | null): number | null {
  if (indexOrNewton == null) return null;
  const index = hardnessIndex(indexOrNewton);
  if (index == null || index < 2 / 3) return null;
  return HARDNESS_NEWTON[index] ?? 19.3 * Math.pow(index, 2.4);
}

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

function add(parent: Element, tag: keyof SVGElementTagNameMap, attrs: Record<string, string | number> = {}, content?: string): SVGElement {
  const node = svgElement(tag, attrs);
  if (content != null) node.textContent = content;
  parent.appendChild(node);
  return node;
}

function val(layer: ProLayer, id: string): number | null {
  return layer.values[id] ?? null;
}

function heightRange(station: ProStation, showSoil: boolean): { min: number; max: number; ticks: number[] } {
  const rawTop = Math.max(0, ...station.profiles.map(p => p.top));
  const top = rawTop ? Math.max(200, Math.floor((rawTop + 50) / 50) * 50) : 200;
  const rawBottom = showSoil ? Math.min(0, ...station.profiles.map(p => p.bottom)) : 0;
  const bottom = rawBottom ? Math.ceil((rawBottom - 50) / 50) * 50 : 0;
  return niceHeightRange(bottom, top);
}

function niceHeightRange(bottom: number, top: number): { min: number; max: number; ticks: number[] } {
  // Grid.smartLegend in niViz rounds the complete station domain to pleasant ticks.
  const span = top - bottom;
  const decade = Math.pow(10, Math.floor(Math.log10(span)));
  const low = Math.floor(bottom / decade * 10) / 10;
  const high = Math.ceil(top / decade * 10) / 10;
  const approximate = (high - low) / 7;
  const stepNorm = approximate <= 0.1 ? 1 : approximate <= 0.2 ? 2 : approximate <= 0.5 ? 5 : 10;
  const minNorm = Math.floor(low / stepNorm * 10) * stepNorm / 10;
  const maxNorm = Math.ceil(high / stepNorm * 10) * stepNorm / 10;
  const tickCount = Math.ceil((maxNorm - minNorm) / stepNorm * 10) + 1;
  const ticks = Array.from({ length: tickCount }, (_, i) => Math.round((stepNorm * i / 10 + minNorm) * decade));
  return { min: ticks[0]!, max: ticks.at(-1)!, ticks };
}

function dateLabel(profile: ProProfile): string {
  const date = profile.date;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()];
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = String(date.getUTCFullYear()).slice(-2);
  const time = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
  return `${month} ${day} '${year}, ${time}`;
}

const CURVES = [
  { ids: ['0503', '0510'], label: 'Snow temperature [°C]', color: 'red', left: -20, right: 0, stairs: false },
  { ids: ['0502', '0503'], label: 'Snow density [kg/m³]', color: 'purple', left: 1000, right: 0, stairs: true },
  // No PRO code maps to niViz's ramm feature; this curve becomes eligible only
  // if a future parser supplies a real feature instead of reusing element age.
  { ids: ['', ''], label: 'Ramm resistance [N]', color: 'darkblue', left: 1000, right: 0, stairs: true },
  { ids: ['0512', '0516'], label: 'Grain size [mm]', color: 'maroon', left: 5, right: 0, stairs: false },
  { ids: ['0506', '0506'], label: 'Liquid water content [%]', color: 'steelblue', left: 20, right: 0, stairs: false },
] as const;

let nextInstance = 0;
export function renderProfile(host: HTMLElement, initialProfile: ProProfile, initialStation: ProStation,
  displayProperty?: string, initialShowSoil = true): ProfileController {
  let profile = initialProfile;
  let station = initialStation;
  let curveIndex = 0;
  let showSoil = initialShowSoil;
  let zoom: { min: number; max: number; ticks: number[] } | null = null;
  const instance = ++nextInstance;
  const patternId = `profile-mfcr-${instance}`;
  const clipId = `profile-clip-${instance}`;
  const curveClipId = `profile-curve-clip-${instance}`;
  let svg: SVGSVGElement;
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => draw()) : null;

  function setProperty(name: string): boolean {
    const normalized = name.toLowerCase().replace(/[^a-z]/g, '');
    const map: Record<string, number> = {
      grainshape: 0, temperature: 0, snowtemperature: 0, density: 1,
      ramm: 2, rammresistance: 2, grainsize: 3, wetness: 4,
      liquidwatercontent: 4, lwc: 4,
    };
    if (Object.hasOwn(map, normalized)) {
      const next = map[normalized]!;
      if (hasCurve(next)) { curveIndex = next; draw(); return true; }
    }
    return false;
  }

  function hasCurve(index: number): boolean {
    const config = CURVES[index];
    const id = config?.ids[station.version >= 1.4 ? 1 : 0];
    return !!id && (profile.fields[id]?.samples.some(sample => sample.value != null) ?? false);
  }

  function nextCurve(): void {
    for (let delta = 1; delta <= CURVES.length; delta++) {
      const index = (curveIndex + delta) % CURVES.length;
      if (hasCurve(index)) { curveIndex = index; draw(); return; }
    }
  }

  function draw(): void {
    const width = Math.max(260, host.clientWidth || 496);
    const height = Math.max(300, host.clientHeight || 860);
    host.replaceChildren();
    svg = svgElement('svg', {
      xmlns: NS, width, height, viewBox: `0 0 ${width} ${height}`,
      role: 'img', 'aria-label': `Snow profile ${dateLabel(profile)}`,
    });
    svg.style.display = 'block';
    svg.style.background = '#fff';
    svg.style.fontFamily = 'LatoWeb, Helvetica, Arial, sans-serif';
    svg.style.fontSize = '14px';
    svg.style.color = '#111';
    host.appendChild(svg);

    const left = 48;
    const right = width - 72;
    const top = 52;
    const bottom = height - 53;
    const plotWidth = right - left;
    const cart = Math.min(100, plotWidth * 0.265);
    const hardnessZero = right - cart;
    const hardnessWidth = hardnessZero - left;
    const domain = zoom ?? heightRange(station, showSoil);
    const y = (cm: number) => bottom - ((cm - domain.min) / (domain.max - domain.min)) * (bottom - top);
    const hardX = (newton: number) => hardnessZero - (newton / 1050) * hardnessWidth;

    const defs = add(svg, 'defs');
    const pattern = add(defs, 'pattern', { id: patternId, patternUnits: 'userSpaceOnUse', width: 5, height: 5 });
    add(pattern, 'rect', { width: 5, height: 5, fill: '#ff0000' });
    add(pattern, 'line', { x1: 1, y1: 0, x2: 1, y2: 5, stroke: '#333', 'stroke-width': 1 });
    const clip = add(defs, 'clipPath', { id: clipId });
    add(clip, 'rect', { x: left, y: top, width: plotWidth, height: bottom - top });
    const curveClip = add(defs, 'clipPath', { id: curveClipId });
    add(curveClip, 'rect', { x: left, y: top, width: hardnessWidth, height: bottom - top });

    const grid = add(svg, 'g', { stroke: '#d6d6d6', 'stroke-width': 0.65 });
    for (const cm of domain.ticks) {
      const yy = y(cm);
      if (cm !== domain.min && cm !== domain.max) add(grid, 'line', { x1: left, y1: yy, x2: right, y2: yy });
      add(svg, 'text', { x: right + 6, y: yy + 5, 'text-anchor': 'start' }, String(cm));
      add(svg, 'line', { x1: left, y1: yy, x2: left + 6, y2: yy, stroke: '#222', 'stroke-width': 0.7 });
      add(svg, 'line', { x1: right - 6, y1: yy, x2: right, y2: yy, stroke: '#222', 'stroke-width': 0.7 });
    }
    add(svg, 'text', { x: width - 15, y: (top + bottom) / 2, transform: `rotate(-90 ${width - 15} ${(top + bottom) / 2})`, 'text-anchor': 'middle' }, 'Height [cm]');

    const hardnessTicks = [1000, 750, 500, 250, 0];
    for (const value of hardnessTicks) {
      const x = hardX(value);
      if (value !== 0 && value !== 1000) add(grid, 'line', { x1: x, y1: top, x2: x, y2: bottom });
      add(svg, 'text', { x, y: top - 8, 'text-anchor': 'middle' }, String(value));
    }
    add(svg, 'text', { x: (left + hardnessZero) / 2, y: top - 28, 'text-anchor': 'middle' }, 'Hand hardness index [N]');
    for (const [index, label] of ['F', '4F', '1F', 'P', 'K'].entries()) {
      const x = hardX(HARDNESS_NEWTON[index + 1]!);
      add(svg, 'line', { x1: x, y1: top, x2: x, y2: top + 5, stroke: '#111', 'stroke-width': 0.7 });
      add(svg, 'text', { x, y: top + 19, 'text-anchor': 'middle' }, label);
    }

    const bars = add(svg, 'g', { 'clip-path': `url(#${clipId})` });
    let tooltip: SVGElement | null = null;
    const showLayerTooltip = (event: MouseEvent, lines: string[], grainClass: string | null) => {
      tooltip?.remove();
      const box = svg.getBoundingClientRect();
      const x = Math.min(width - 222, Math.max(4, event.clientX - box.left + 12));
      const yy = Math.min(height - 92, Math.max(4, event.clientY - box.top - 82));
      tooltip = add(svg, 'g', { 'pointer-events': 'none' });
      add(tooltip, 'rect', { x, y: yy, width: 216, height: 82, fill: '#fff', stroke: '#555',
        'stroke-width': 0.8, 'fill-opacity': 0.96 });
      lines.forEach((line, i) => add(tooltip!, 'text', { x: x + 8, y: yy + 18 + i * 19,
        'font-size': 12, 'text-anchor': 'start' }, line));
      drawGrainSymbol(tooltip, grainClass, x + 193, yy + 20, 21);
    };
    if (showSoil && domain.min < profile.bottom && profile.top <= 0) {
      add(bars, 'rect', { x: left - 10, y: y(profile.bottom), width: plotWidth + 20,
        height: 20, fill: '#006600', opacity: 0.4 });
    }
    const hardnessId = station.version >= 1.4 ? '0540' : '0534';
    for (const layer of profile.layers) {
      if (layer.kind !== 'snow' || layer.top <= 0) continue;
      const hardness = hardnessNewton(val(layer, hardnessId));
      if (hardness == null) continue;
      const x = Math.max(left, Math.min(hardnessZero, hardX(hardness)));
      const upper = y(layer.top);
      const lower = y(Math.max(0, layer.bottom));
      const code = val(layer, '0513');
      const shape = grainShape(code);
      const grain = shape ? `${shape.primary}${shape.secondary ? ` / ${shape.secondary}` : ''} (${code})` : 'Unknown grain type';
      const fill = shape?.primary === 'MFcr' ? `url(#${patternId})` : profileGrainColor(code);
      const rect = add(bars, 'rect', { x, y: upper, width: Math.max(0.5, hardnessZero - x), height: Math.max(0.5, lower - upper), fill });
      const grainSizeId = station.version >= 1.4 ? '0516' : '0512';
      const grainSize = val(layer, grainSizeId);
      const lines = [grain, `${Math.max(0, layer.bottom).toFixed(2)}–${layer.top.toFixed(2)} cm`,
        `Grain size: ${grainSize == null ? '–' : `${grainSize.toFixed(2)} mm`}`,
        `Hand hardness: ${Math.round(hardness)} N`];
      rect.addEventListener('mouseenter', event => showLayerTooltip(event as MouseEvent, lines, shape?.primary ?? null));
      rect.addEventListener('mousemove', event => showLayerTooltip(event as MouseEvent, lines, shape?.primary ?? null));
      rect.addEventListener('mouseleave', () => { tooltip?.remove(); tooltip = null; });
    }

    const curve = CURVES[curveIndex]!;
    const curveId = curve.ids[station.version >= 1.4 ? 1 : 0];
    const curveX = (value: number) => left + (value - curve.left) / (curve.right - curve.left) * hardnessWidth;
    const curveSamples = profile.fields[curveId]?.samples ?? [];
    const points: string[] = [];
    if (curve.stairs) {
      for (const sample of curveSamples) {
        if (sample.value == null || !Number.isFinite(sample.top) || sample.top < 0) continue;
        const xx = curveX(sample.value!);
        if (points.length === 0) points.push(`${hardnessZero},${y(sample.bottom)}`);
        points.push(`${xx},${y(sample.bottom)}`, `${xx},${y(sample.top)}`);
      }
    } else {
      for (const sample of curveSamples) {
        if (sample.value == null || !Number.isFinite(sample.top) || sample.top < 0) {
          points.push('|');
          continue;
        }
        points.push(`${curveX(sample.value)},${y(sample.top)}`);
      }
    }
    if (points.length) {
      const segments = points.join(' ').split('|').map(part => part.trim()).filter(Boolean);
      for (const segment of segments) add(svg, 'polyline', { points: segment, stroke: curve.color,
        'stroke-width': 1, fill: 'none', 'clip-path': `url(#${curveClipId})` });
    }

    const tickInc = curveIndex === 0 || curveIndex === 4 ? 5 : curveIndex === 3 ? 1.25 : 250;
    const tickCount = Math.round(Math.abs(curve.right - curve.left) / tickInc);
    for (let i = 0; i <= tickCount; i++) {
      const tick = curve.left + Math.sign(curve.right - curve.left) * i * tickInc;
      const x = curveX(tick);
      add(svg, 'text', { x, y: bottom + 15, 'text-anchor': 'middle' }, String(tick));
    }
    const curveLabel = add(svg, 'text', {
      x: (left + hardnessZero) / 2, y: bottom + 33,
      'text-anchor': 'middle', fill: curve.color, cursor: 'pointer', role: 'button', tabindex: 0,
      'aria-label': `Change additional profile parameter; showing ${curve.label}`,
    }, curve.label);
    curveLabel.addEventListener('click', nextCurve);
    curveLabel.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); nextCurve(); }
    });

    const stability = profile.stability;
    if (stability?.sk38 != null && stability.zSk38 != null && (showSoil || stability.zSk38 > 0)) {
      const yy = y(stability.zSk38);
      if (yy >= top && yy <= bottom) {
        add(svg, 'line', { x1: hardnessZero, y1: yy, x2: right, y2: yy, stroke: '#111', 'stroke-width': 1.5 });
        add(svg, 'path', { d: `M ${hardnessZero} ${yy} l 11 -5 v 10 z`, fill: '#111' });
        const classCode = stability.stabilityClass;
        if (classCode != null && classCode !== -1) {
          const classText = classCode === 1 ? 'poor' : classCode === 3 ? 'fair' : classCode === 5 ? 'good' : String(classCode);
          add(svg, 'text', { x: (hardnessZero + right) / 2, y: yy - 4, 'text-anchor': 'middle' }, `cl: ${classText}`);
        }
        add(svg, 'text', { x: (hardnessZero + right) / 2, y: yy + 16,
          'text-anchor': 'middle' }, `SK38=${stability.sk38}`);
      }
    }

    add(svg, 'path', { d: `M ${left} ${bottom} V ${top} H ${right} V ${bottom} H ${left}`, stroke: '#111', 'stroke-width': 1, fill: 'none' });
    add(svg, 'line', { x1: hardnessZero, y1: top, x2: hardnessZero, y2: bottom, stroke: '#111', 'stroke-width': 1 });
    add(svg, 'text', { x: hardnessZero, y: bottom + 32, 'text-anchor': 'start' }, dateLabel(profile));

    if (zoom) {
      const reset = add(svg, 'g', { role: 'button', tabindex: 0, cursor: 'pointer',
        'aria-label': 'Reset zoom' });
      add(reset, 'rect', { x: right - 88, y: top - 39, width: 86, height: 24,
        rx: 3, fill: '#fff', stroke: '#aaa' });
      add(reset, 'text', { x: right - 45, y: top - 22, 'font-size': 12, 'text-anchor': 'middle' }, 'Reset zoom');
      const resetZoom = () => { zoom = null; draw(); };
      reset.addEventListener('click', resetZoom);
      reset.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); resetZoom(); }
      });
    }

    let startY: number | null = null;
    let selection: SVGElement | null = null;
    const local = (event: PointerEvent) => {
      const bounds = svg.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    svg.addEventListener('pointerdown', event => {
      const point = local(event);
      if (point.x < left || point.x > right || point.y < top || point.y > bottom) return;
      startY = point.y;
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener('pointermove', event => {
      if (startY === null) return;
      const currentY = Math.max(top, Math.min(bottom, local(event).y));
      selection?.remove();
      selection = add(svg, 'rect', { x: left, y: Math.min(startY, currentY),
        width: plotWidth, height: Math.abs(currentY - startY), fill: '#9999ff',
        opacity: 0.3, stroke: '#9999ff', 'pointer-events': 'none' });
    });
    svg.addEventListener('pointerup', event => {
      if (startY === null) return;
      const currentY = Math.max(top, Math.min(bottom, local(event).y));
      selection?.remove();
      selection = null;
      const start = startY;
      startY = null;
      if (Math.abs(currentY - start) < 8) return;
      const inverse = (pixel: number) => domain.min + (bottom - pixel) / (bottom - top) * (domain.max - domain.min);
      const low = Math.floor(Math.min(inverse(start), inverse(currentY)));
      const high = Math.ceil(Math.max(inverse(start), inverse(currentY)));
      if (high > low) { zoom = niceHeightRange(low, high); draw(); }
    });
    svg.addEventListener('pointercancel', () => { startY = null; selection?.remove(); selection = null; });
  }

  async function exportPNG(): Promise<Blob> {
    const text = new XMLSerializer().serializeToString(svg);
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      const scale = Math.max(2, devicePixelRatio);
      canvas.width = Math.round(svg.viewBox.baseVal.width * scale);
      canvas.height = Math.round(svg.viewBox.baseVal.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, svg.viewBox.baseVal.width, svg.viewBox.baseVal.height);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG export failed');
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  observer?.observe(host);
  draw();
  if (displayProperty) setProperty(displayProperty);
  return {
    update(nextProfile, nextStation, nextProperty, nextShowSoil) {
      profile = nextProfile;
      station = nextStation;
      if (nextShowSoil !== undefined && nextShowSoil !== showSoil) {
        showSoil = nextShowSoil;
        zoom = null;
      }
      if (!nextProperty || !setProperty(nextProperty)) draw();
    },
    setProperty,
    setShowSoil(nextShowSoil) { showSoil = nextShowSoil; zoom = null; draw(); },
    destroy() { observer?.disconnect(); host.replaceChildren(); },
    exportPNG,
  };
}
