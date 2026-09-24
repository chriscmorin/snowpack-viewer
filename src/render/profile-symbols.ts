/**
 * Simple SVG renditions of the IACS grain-form symbols.
 *
 * Drawn here from the published IACS symbol descriptions and diagrams, without
 * embedding or tracing the separately copyrighted SnowSymbolsIACS font.
 * https://cryosphericsciences.org/wp-content/uploads/2019/02/SnowSymbolsIACS_docu.pdf
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function element(parent: SVGElement, name: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent.appendChild(node);
  return node;
}

/** Add an IACS grain-form symbol centered at (x, y), with a square size in px. */
export function drawGrainSymbol(
  parent: SVGElement,
  classCode: string | null | undefined,
  x: number,
  y: number,
  size: number,
): SVGElement | null {
  if (!classCode || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || size <= 0) return null;
  // Preserve the specific Graupel, rounding facets, and crust forms before
  // grouping remaining subtypes under their primary IACS families.
  const family = classCode === 'PPgp' || classCode === 'FCxr' || classCode === 'MFcr'
    ? classCode : classCode.slice(0, 2);
  const supported = ['PPgp', 'PP', 'MM', 'DF', 'RG', 'FC', 'FCxr', 'DH', 'SH', 'MF', 'MFcr', 'IF'];
  if (!supported.includes(family)) return null;

  const group = element(parent, 'g', {
    transform: `translate(${x} ${y}) scale(${size / 12})`,
    fill: 'none', stroke: 'currentColor', 'stroke-width': 1.15,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-label': classCode,
  });
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    element(group, 'line', { x1, y1, x2, y2 });
  const circle = (r: number, fill = 'none') =>
    element(group, 'circle', { cx: 0, cy: 0, r, fill });

  switch (family) {
    case 'PPgp': // Graupel: triangular pellet with small asterisk above.
      element(group, 'path', { d: 'M -3.5 4 L 0 -1.5 L 3.5 4 Z M 0 -5.5 V -2.9 M -1.2 -4.8 L 1.2 -3.6 M 1.2 -4.8 L -1.2 -3.6' });
      break;
    case 'PP': // Precipitation particles.
      line(-3.5, 0, 3.5, 0); line(0, -3.5, 0, 3.5);
      break;
    case 'MM': // Machine-made snow.
      circle(3.2); circle(1.2); circle(0.4, 'currentColor');
      break;
    case 'DF': // Decomposing and fragmented precipitation particles.
      line(-3.5, 3.5, 3.5, -3.5);
      break;
    case 'RG': // Rounded grains.
      circle(2.4, 'currentColor');
      break;
    case 'FC': // Faceted crystals.
      element(group, 'rect', { x: -3.1, y: -3.1, width: 6.2, height: 6.2 });
      break;
    case 'FCxr': // Rounding faceted crystals: square with rounded crown.
      element(group, 'path', { d: 'M -3.2 3.1 V -0.5 A 3.2 3.2 0 0 1 3.2 -0.5 V 3.1 Z M -3.2 0 H 3.2' });
      break;
    case 'DH': // Depth hoar.
      element(group, 'path', { d: 'M -3.5 3 L 0 -3 L 3.5 3' });
      break;
    case 'SH': // Surface hoar.
      element(group, 'path', { d: 'M -3.5 -3 L 0 3 L 3.5 -3' });
      break;
    case 'MF': // Melt forms.
      circle(3);
      break;
    case 'MFcr': // Melt-freeze crust: linked, overlapping round forms.
      element(group, 'circle', { cx: -2, cy: 0, r: 3.2 });
      element(group, 'circle', { cx: -2, cy: 0, r: 1.4 });
      element(group, 'circle', { cx: 2.5, cy: 0, r: 3.2 });
      break;
    case 'IF': // Ice formations.
      element(group, 'rect', { x: -3.6, y: -1.7, width: 7.2, height: 3.4, fill: 'currentColor' });
      break;
  }
  return group;
}

/** Canvas equivalent for timeline legends; uses the same hand-drawn geometry. */
export function drawGrainSymbolCanvas(
  ctx: CanvasRenderingContext2D,
  classCode: string | null | undefined,
  x: number,
  y: number,
  size: number,
  color = '#1f252a',
): void {
  if (!classCode || !Number.isFinite(size) || size <= 0) return;
  const family = classCode === 'PPgp' || classCode === 'FCxr' || classCode === 'MFcr'
    ? classCode : classCode.slice(0, 2);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 12, size / 12);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.15;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (points: Array<[number, number]>, closed = false) => {
    ctx.beginPath(); ctx.moveTo(...points[0]!);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    if (closed) ctx.closePath();
    ctx.stroke();
  };
  const circ = (cx: number, cy: number, r: number, filled = false) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (filled) ctx.fill(); else ctx.stroke();
  };
  switch (family) {
    case 'PPgp':
      stroke([[-3.5, 4], [0, -1.5], [3.5, 4]], true);
      stroke([[0, -5.5], [0, -2.9]]);
      stroke([[-1.2, -4.8], [1.2, -3.6]]);
      stroke([[1.2, -4.8], [-1.2, -3.6]]);
      break;
    case 'PP':
      stroke([[-3.5, 0], [3.5, 0]]); stroke([[0, -3.5], [0, 3.5]]); break;
    case 'MM':
      circ(0, 0, 3.2); circ(0, 0, 1.2); circ(0, 0, 0.4, true); break;
    case 'DF':
      stroke([[-3.5, 3.5], [3.5, -3.5]]); break;
    case 'RG':
      circ(0, 0, 2.4, true); break;
    case 'FC':
      ctx.strokeRect(-3.1, -3.1, 6.2, 6.2); break;
    case 'FCxr':
      ctx.beginPath(); ctx.moveTo(-3.2, 3.1); ctx.lineTo(-3.2, -0.5);
      ctx.arc(0, -0.5, 3.2, Math.PI, 0); ctx.lineTo(3.2, 3.1); ctx.closePath(); ctx.stroke();
      stroke([[-3.2, 0], [3.2, 0]]); break;
    case 'DH':
      stroke([[-3.5, 3], [0, -3], [3.5, 3]]); break;
    case 'SH':
      stroke([[-3.5, -3], [0, 3], [3.5, -3]]); break;
    case 'MF':
      circ(0, 0, 3); break;
    case 'MFcr':
      circ(-2, 0, 3.2); circ(-2, 0, 1.4); circ(2.5, 0, 3.2); break;
    case 'IF':
      ctx.fillRect(-3.6, -1.7, 7.2, 3.4); break;
  }
  ctx.restore();
}
