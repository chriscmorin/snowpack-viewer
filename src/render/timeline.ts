import type { ProLayer, ProProfile, ProStation } from '../core/types';
import { grainShape } from '../core/scientific';
import { drawGrainSymbolCanvas } from './profile-symbols';

export type TimelineProperty = 'temperature' | 'grainshape' | 'grainsize' | 'density' | 'wetness' | 'sphericity' | 'dendricity';
export const TIMELINE_PROPERTIES: { key: TimelineProperty; label: string; unit: string; min: number; max: number }[] = [
  { key: 'temperature', label: 'Snow temperature', unit: '°C', min: -20, max: 0 },
  { key: 'grainshape', label: 'Grain shape', unit: '', min: 0, max: 1 },
  { key: 'grainsize', label: 'Grain size', unit: 'mm', min: 0, max: 4 },
  { key: 'density', label: 'Snow density', unit: 'kg/m³', min: 0, max: 600 },
  { key: 'wetness', label: 'Liquid water content', unit: '%', min: 0, max: 4 },
  { key: 'sphericity', label: 'Sphericity', unit: '', min: 0, max: 1 },
  { key: 'dendricity', label: 'Dendricity', unit: '', min: 0, max: 1 }
];

const grainColors = ['#808080', '#ffd700', '#00ffff', '#ff0000', '#ff0000', '#ff00ff', '#0000ff', '#add8e6', '#ffb6c1', '#228b22', '#00ff00'];
const grainLabels = ['PPgp', 'MM', 'IF', 'MFcr', 'MF', 'SH', 'DH', 'FC', 'RG', 'DF', 'PP'];
const numericalPalettes: Record<Exclude<TimelineProperty, 'grainshape'>, string[]> = {
  temperature: ['#00007f', '#0000ff', '#00ffff', '#f0f0f0', '#ff0000'],
  grainsize: ['#f0f0f0', '#00ffff', '#0000ff', '#00007f'],
  density: ['#f0f0f0', '#00ffff', '#0000ff', '#00007f'],
  wetness: ['#f0f0f0', '#00ffff', '#0000ff', '#00007f'],
  sphericity: ['#0000ff', '#ff0000'],
  dendricity: ['#f0f0f0', '#0000ff']
};
const fieldCodes: Record<TimelineProperty, [string, string]> = {
  temperature: ['0503', '0510'], grainshape: ['0513', '0513'], grainsize: ['0512', '0516'],
  density: ['0502', '0503'], wetness: ['0506', '0506'], sphericity: ['0509', '0519'], dendricity: ['0508', '0518']
};
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
function hexMix(a: string, b: string, t: number): string {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.trunc(((x >> shift) & 255) * (1 - t) + ((y >> shift) & 255) * t).toString(16).padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}
export function grainCategory(value: number): number {
  const primary = grainShape(value)?.primary;
  return Math.max(0, grainLabels.indexOf(primary ?? 'PPgp'));
}
export function colorForValue(property: TimelineProperty, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '#f1f2f2';
  if (property === 'grainshape') return grainShape(value)?.color ?? '#f1f2f2';
  const config = TIMELINE_PROPERTIES.find(item => item.key === property)!;
  const stops = numericalPalettes[property];
  const scaled = clamp((value - config.min) / (config.max - config.min), 0, 1) * (stops.length - 1);
  const index = Math.min(Math.floor(scaled), stops.length - 2);
  return hexMix(stops[index]!, stops[index + 1]!, scaled - index);
}
function formatDate(date: Date, compact = false): string {
  const options: Intl.DateTimeFormatOptions = compact
    ? { month: 'short', day: 'numeric', timeZone: 'UTC' }
    : { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' };
  return new Intl.DateTimeFormat('en-US', options).format(date) + (compact ? '' : ' UTC');
}
function niceStep(span: number, target: number): number {
  const raw = span / target, magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const unit = raw / magnitude;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * magnitude;
}
function propertyValue(profile: ProProfile, layer: ProLayer, property: TimelineProperty, version: number): number | null {
  const code = fieldCodes[property][version >= 1.4 ? 1 : 0];
  const value = layer.values[code];
  // The parser preserves the original four-digit field codes on each layer.
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface TimelineOptions {
  property: TimelineProperty;
  showSoil: boolean;
  selectedIndex: number;
  onSelect: (index: number) => void;
  onHover?: (index: number | null) => void;
}
export interface TimelineController {
  update(station: ProStation, options: Partial<Omit<TimelineOptions, 'onSelect'>>): void;
  destroy(): void;
  exportPNG(): Promise<Blob>;
  print(): void;
  resetZoom(): void;
}

export function renderTimeline(host: HTMLElement, station: ProStation, initial: TimelineOptions): TimelineController {
  let data = station;
  let property = initial.property;
  let selected = initial.selectedIndex;
  let showSoil = initial.showSoil;
  let start = 0, end = Math.max(0, data.profiles.length - 1);
  let hover: { index: number; height: number; clientX: number; clientY: number } | null = null;
  let dragStart: number | null = null, dragEnd: number | null = null;
  const wrap = document.createElement('div');
  wrap.className = 'spv-timeline';
  const canvas = document.createElement('canvas');
  canvas.className = 'spv-timeline-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Timeline of snow layers; click to select a date, drag to zoom');
  const tooltip = document.createElement('div');
  tooltip.className = 'spv-tooltip';
  tooltip.hidden = true;
  wrap.append(canvas, tooltip);
  host.replaceChildren(wrap);
  const displayCtx = canvas.getContext('2d')!;
  const baseCanvas = document.createElement('canvas');
  const baseCtx = baseCanvas.getContext('2d')!;
  let ctx = baseCtx;
  let baseDirty = true;
  let rasterDpr = 0;
  let width = 1, height = 1;
  let plot = { left: 92, top: 55, right: 50, bottom: 54, width: 1, height: 1, lo: 0, hi: 200 };
  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(wrap);

  function timeOf(index: number): number { return data.profiles[index]?.timestamp ?? 0; }
  function windowTimes(): [number, number] {
    const first = timeOf(start), last = timeOf(end);
    return [first, last > first ? last : first + 3600000];
  }
  function xFor(index: number): number {
    const [lo, hi] = windowTimes();
    return plot.left + (timeOf(index) - lo) / (hi - lo) * plot.width;
  }
  function indexAt(x: number): number {
    let best = start, distance = Infinity;
    for (let i = start; i <= end; i++) {
      const d = Math.abs(xFor(i) - x);
      if (d < distance) { best = i; distance = d; }
    }
    return best;
  }
  const yFor = (value: number) => plot.top + (plot.hi - value) / (plot.hi - plot.lo) * plot.height;
  const heightAt = (y: number) => plot.hi - (y - plot.top) / plot.height * (plot.hi - plot.lo);
  function line(x1: number, y1: number, x2: number, y2: number, color = '#d9dcdf', dash: number[] = []) {
    ctx.beginPath(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.moveTo(x1 + .5, y1 + .5); ctx.lineTo(x2 + .5, y2 + .5); ctx.stroke(); ctx.setLineDash([]);
  }
  function label(text: string, x: number, y: number, align: CanvasTextAlign = 'left', color = '#41464d') {
    ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(text, x, y);
  }
  function draw() {
    const bounds = wrap.getBoundingClientRect();
    const nextWidth = Math.max(260, Math.round(bounds.width));
    const nextHeight = Math.max(350, Math.round(bounds.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (nextWidth !== width || nextHeight !== height || rasterDpr !== dpr) baseDirty = true;
    width = nextWidth; height = nextHeight;
    if (!baseDirty) { compose(); return; }
    rasterDpr = dpr;
    baseCanvas.width = Math.round(width * dpr); baseCanvas.height = Math.round(height * dpr);
    canvas.width = baseCanvas.width; canvas.height = baseCanvas.height;
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
    ctx = baseCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
    const visible = data.profiles.slice(start, end + 1);
    const maxSnow = Math.max(0, ...visible.map(p => p.top));
    const minSoil = showSoil ? Math.min(0, ...visible.map(p => p.bottom)) : 0;
    const deepSoil = minSoil < -1000;
    const step = deepSoil ? 1000 : 50;
    const max = Math.max(deepSoil ? 1000 : 200, Math.ceil(maxSnow / step) * step);
    const min = showSoil ? Math.min(0, Math.floor(minSoil / step) * step) : 0;
    plot = { left: 96, top: 53, right: 53, bottom: 51, width: Math.max(1, width - 149), height: Math.max(1, height - 104), lo: min, hi: max };
    ctx.font = '12px Arial, sans-serif';
    const site = [data.latitude !== null && data.longitude !== null ? `${data.latitude.toFixed(2)}° N  ${data.longitude.toFixed(2)}° E` : '', data.altitude !== null ? `${data.altitude} m` : ''].filter(Boolean).join(' · ');
    label(`${data.name || 'SNOWPACK station'}${site ? ` (${site})` : ''}`, plot.left, 17, 'left', '#20242a');
    const averageMinutes = data.profiles.length > 1 ? Math.round((data.profiles.at(-1)!.timestamp - data.profiles[0]!.timestamp) / (data.profiles.length - 1) / 60000) : null;
    const setting = [data.slopeAngle !== null ? `Slope ${data.slopeAngle}°` : '', data.slopeAzimuth !== null ? `Azimuth ${data.slopeAzimuth}°` : '', averageMinutes !== null ? `Avg. timestep ${averageMinutes} min` : ''].filter(Boolean).join(' · ');
    label(setting, plot.left, 33, 'left', '#59616a');
    const pConfig = TIMELINE_PROPERTIES.find(item => item.key === property)!;
    const legendLeft = 72, legendWidth = 18;
    if (property === 'grainshape') {
      const legendHeight = plot.height / grainColors.length;
      for (let i = 0; i < grainColors.length; i++) {
        const y = plot.top + (grainColors.length - 1 - i) * legendHeight;
        ctx.fillStyle = grainColors[i]!; ctx.fillRect(legendLeft, y, legendWidth, legendHeight + .3);
        if (grainLabels[i] === 'MFcr') {
          ctx.strokeStyle = '#202020'; ctx.lineWidth = .7;
          for (let x = legendLeft + 2; x < legendLeft + legendWidth; x += 3) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + legendHeight); ctx.stroke(); }
        }
      }
    } else {
      const gradient = ctx.createLinearGradient(0, plot.top + plot.height, 0, plot.top);
      numericalPalettes[property].forEach((color, i, colors) => gradient.addColorStop(i / (colors.length - 1), color));
      ctx.fillStyle = gradient; ctx.fillRect(legendLeft, plot.top, legendWidth, plot.height);
    }
    ctx.save(); ctx.beginPath(); ctx.rect(plot.left, plot.top, plot.width, plot.height); ctx.clip();
    // niViz draws a fixed strip of one average timestep at each measured date.
    // Gaps between irregular timestamps remain blank.
    const [visibleStart, visibleEnd] = windowTimes();
    const stationStep = data.profiles.length > 1 ? (data.profiles.at(-1)!.timestamp - data.profiles[0]!.timestamp) / (data.profiles.length - 1) : 3600000;
    const stripWidth = Math.max(1, Math.ceil(stationStep / (visibleEnd - visibleStart) * plot.width) + 1);
    for (let i = start; i <= end; i++) {
      const profile = data.profiles[i]!;
      const l = xFor(i);
      const w = stripWidth;
      for (const layer of profile.layers) {
        if (!showSoil && layer.kind === 'soil') continue;
        const value = propertyValue(profile, layer, property, data.version);
        if (value === null) continue;
        ctx.fillStyle = colorForValue(property, value);
        const y1 = yFor(layer.top), y2 = yFor(layer.bottom);
        const topPixel = Math.round(y1), bottomPixel = Math.round(y2);
        ctx.fillRect(Math.floor(l), topPixel, w, Math.max(2, bottomPixel - topPixel));
        if (property === 'grainshape' && grainShape(value)?.primary === 'MFcr') {
          ctx.strokeStyle = '#222'; ctx.lineWidth = .65;
          for (let hatchX = Math.ceil(l / 3) * 3; hatchX < l + w; hatchX += 3) {
            ctx.beginPath(); ctx.moveTo(hatchX, y1); ctx.lineTo(hatchX, y2); ctx.stroke();
          }
        }
      }
      if (property === 'grainshape' && profile.surfaceHoar) {
        ctx.fillStyle = '#ff00ff'; ctx.fillRect(l, yFor(profile.top) - 2, w, 2);
      }
    }
    ctx.restore();
    const yStep = niceStep(max - min, Math.max(3, plot.height / 130));
    for (let value = Math.ceil(min / yStep) * yStep; value <= max + .0001; value += yStep) {
      const y = yFor(value); line(plot.left, y, plot.left + plot.width, y, '#9ba5ae', [1, 2]);
      label(String(Math.round(value * 100) / 100), plot.left + plot.width + 7, y + 4);
    }
    const [minTime, maxTime] = windowTimes();
    const span = maxTime - minTime;
    const intervals = [3600000, 10800000, 21600000, 43200000, 86400000, 172800000, 604800000, 2592000000];
    const interval = intervals.find(item => span / item <= Math.max(3, plot.width / 110)) ?? intervals.at(-1)!;
    for (let time = Math.ceil(minTime / interval) * interval; time <= maxTime; time += interval) {
      const x = plot.left + (time - minTime) / span * plot.width;
      line(x, plot.top, x, plot.top + plot.height, '#aab3ba', [1, 2]);
      const tickDate = new Date(time);
      const tickLabel = interval < 86400000
        ? `${formatDate(tickDate, true)} ${String(tickDate.getUTCHours()).padStart(2, '0')}:${String(tickDate.getUTCMinutes()).padStart(2, '0')}`
        : formatDate(tickDate, true);
      label(tickLabel, x, plot.top + plot.height + 18, 'center');
    }
    ctx.strokeStyle = '#59616a'; ctx.lineWidth = 1; ctx.strokeRect(plot.left + .5, plot.top + .5, plot.width, plot.height);
    ctx.strokeRect(72.5, plot.top + .5, 18, plot.height);
    if (property === 'grainshape') {
      grainLabels.forEach((category, i) => drawGrainSymbolCanvas(ctx, category, 58, plot.top + (grainLabels.length - i - .5) * plot.height / grainLabels.length, 18));
    } else {
      [0, .25, .5, .75, 1].forEach(fraction => label(String(pConfig.min + fraction * (pConfig.max - pConfig.min)), 68, plot.top + (1 - fraction) * plot.height + 4, 'right'));
    }
    ctx.save(); ctx.translate(17, plot.top + plot.height / 2); ctx.rotate(-Math.PI / 2);
    label(`${pConfig.label}${pConfig.unit ? ` [${pConfig.unit}]` : ''}`, 0, 0, 'center', '#30363b'); ctx.restore();
    ctx.save(); ctx.translate(width - 12, plot.top + plot.height / 2); ctx.rotate(-Math.PI / 2);
    label(`${showSoil ? 'Height' : 'Snow height'} [cm]`, 0, 0, 'center', '#30363b'); ctx.restore();
    baseDirty = false;
    compose();
  }
  function compose() {
    ctx = displayCtx;
    ctx.setTransform(rasterDpr, 0, 0, rasterDpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(baseCanvas, 0, 0, width, height);
    if (selected >= start && selected <= end) {
      const x = xFor(selected); line(x, plot.top, x, plot.top + plot.height, '#242d37');
      ctx.fillStyle = '#242d37'; ctx.beginPath(); ctx.moveTo(x - 5, plot.top); ctx.lineTo(x + 5, plot.top); ctx.lineTo(x, plot.top + 7); ctx.fill();
    }
    if (hover && hover.index >= start && hover.index <= end) line(xFor(hover.index), plot.top, xFor(hover.index), plot.top + plot.height, '#333a40', [4, 3]);
    if (dragStart !== null && dragEnd !== null) {
      ctx.fillStyle = 'rgba(48,102,165,.14)';
      ctx.fillRect(Math.min(dragStart, dragEnd), plot.top, Math.abs(dragEnd - dragStart), plot.height);
      ctx.strokeStyle = '#3c72ad'; ctx.strokeRect(Math.min(dragStart, dragEnd), plot.top, Math.abs(dragEnd - dragStart), plot.height);
    }
  }
  function pointerPoint(event: PointerEvent) {
    const b = canvas.getBoundingClientRect(); return { x: event.clientX - b.left, y: event.clientY - b.top };
  }
  function showTooltip() {
    if (!hover) { tooltip.hidden = true; return; }
    const profile = data.profiles[hover.index]!;
    const layer = profile.layers.find(item => hover!.height <= item.top && hover!.height >= item.bottom && (showSoil || item.kind !== 'soil'));
    const val = layer ? propertyValue(profile, layer, property, data.version) : null;
    const cfg = TIMELINE_PROPERTIES.find(item => item.key === property)!;
    const labelValue = val === null ? 'No data' : property === 'grainshape' ? `${val} (${grainLabels[grainCategory(val)]})` : `${val} ${cfg.unit}`.trim();
    tooltip.innerHTML = `<strong>${formatDate(profile.date)}</strong><span>Snow height ${profile.top.toFixed(2)} cm</span><span>${layer ? `${layer.bottom.toFixed(2)}–${layer.top.toFixed(2)} cm` : 'Above snow surface'}</span><span>${cfg.label}: ${labelValue}</span>`;
    tooltip.hidden = false;
    const bounds = wrap.getBoundingClientRect();
    tooltip.style.left = `${clamp(hover.clientX - bounds.left + 14, 4, Math.max(4, bounds.width - tooltip.offsetWidth - 6))}px`;
    tooltip.style.top = `${clamp(hover.clientY - bounds.top + 12, 4, Math.max(4, bounds.height - tooltip.offsetHeight - 6))}px`;
  }
  const pointerDown = (event: PointerEvent) => { const p = pointerPoint(event); if (p.x < plot.left || p.x > plot.left + plot.width || p.y < plot.top || p.y > plot.top + plot.height) return; dragStart = p.x; dragEnd = p.x; canvas.setPointerCapture(event.pointerId); };
  let lastHoverIndex: number | null = null;
  const pointerMove = (event: PointerEvent) => {
    const p = pointerPoint(event);
    if (dragStart !== null) { dragEnd = clamp(p.x, plot.left, plot.left + plot.width); draw(); return; }
    hover = p.x >= plot.left && p.x <= plot.left + plot.width && p.y >= plot.top && p.y <= plot.top + plot.height ? { index: indexAt(p.x), height: heightAt(p.y), clientX: event.clientX, clientY: event.clientY } : null;
    const nextHoverIndex = hover?.index ?? null;
    if (nextHoverIndex !== lastHoverIndex) { lastHoverIndex = nextHoverIndex; initial.onHover?.(nextHoverIndex); }
    showTooltip(); draw();
  };
  const pointerUp = (event: PointerEvent) => {
    if (dragStart === null) return;
    const to = dragEnd ?? dragStart;
    if (Math.abs(to - dragStart) > 12) {
      const first = indexAt(Math.min(dragStart, to)), last = indexAt(Math.max(dragStart, to));
      if (last > first) { start = first; end = last; baseDirty = true; }
    } else initial.onSelect(indexAt(pointerPoint(event).x));
    dragStart = null; dragEnd = null; draw();
  };
  const leave = () => { hover = null; lastHoverIndex = null; initial.onHover?.(null); showTooltip(); draw(); };
  const dblclick = () => { start = 0; end = data.profiles.length - 1; baseDirty = true; draw(); };
  canvas.addEventListener('pointerdown', pointerDown); canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp); canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('dblclick', dblclick);
  draw();
  return {
    update(next, options) { const changed = next !== data; data = next; if (options.property && options.property !== property) { property = options.property; baseDirty = true; } if (options.showSoil !== undefined && options.showSoil !== showSoil) { showSoil = options.showSoil; baseDirty = true; } if (options.selectedIndex !== undefined) selected = options.selectedIndex; if (changed) { start = 0; end = data.profiles.length - 1; baseDirty = true; } draw(); },
    destroy() { resizeObserver.disconnect(); canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove); canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointerleave', leave); canvas.removeEventListener('dblclick', dblclick); wrap.remove(); },
    exportPNG() { return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png')); },
    print() { const image = canvas.toDataURL('image/png'); const frame = document.createElement('iframe'); frame.className = 'spv-print-frame'; document.body.append(frame); const doc = frame.contentDocument!; doc.open(); doc.write(`<title>Timeline — ${data.name.replace(/[<>&"]/g, '')}</title><img src="${image}" style="max-width:100%;height:auto">`); doc.close(); frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 1000); }; },
    resetZoom: dblclick
  };
}
