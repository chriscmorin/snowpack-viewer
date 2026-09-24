/** niViz GrainShape.swisscode and GrainShape.convert (Swiss F1F2F3). */
const SWISS = ['PPgp', 'PP', 'DF', 'RG', 'FC', 'DH', 'SH', 'MF', 'IF', 'FCxr'] as const;

export interface GrainShape {
  primary: string;
  secondary: string | null;
  color: string;
  /** Alternative perception-informed palette shipped with niViz. */
  perceptionColor: string;
}

const DEFAULT_COLORS: Record<string, string> = {
  PPgp: '#808080', PP: '#00FF00', DF: '#228B22', RG: '#FFB6C1',
  FC: '#ADD8E6', DH: '#0000FF', SH: '#FF00FF', MF: '#FF0000',
  IF: '#00FFFF', FCxr: '#ADD8E6', MFcr: '#FF0000'
};

const PERCEPTION_COLORS: Record<string, string> = {
  PPgp: '#ffde00', PP: '#ffde00', DF: '#f1f501', RG: '#ffccd9',
  FC: '#b2edff', DH: '#4678e8', SH: '#ee3a1d', MF: '#d5ebb5',
  IF: '#a3ddbb', FCxr: '#dacef4', MFcr: '#addd8e'
};

/** Decode a layer's three-digit grain code, preserving niViz's F3 crust override. */
export function grainShape(code: number | null | undefined): GrainShape | null {
  if (code === null || code === undefined || !Number.isInteger(code) || code < 0 || code > 999) return null;
  const digits = String(code).padStart(3, '0').split('').map(Number);
  const primary = digits[2] === 2 ? 'MFcr' : SWISS[digits[0]!];
  const secondary = digits[2] === 2 && digits[1] === 7 ? null : SWISS[digits[1]!];
  if (!primary) return null;
  return { primary, secondary: secondary ?? null, color: DEFAULT_COLORS[primary]!,
    perceptionColor: PERCEPTION_COLORS[primary]! };
}

/** niViz Hardness.parse: hand-hardness 0.666–6, or ram resistance in Newtons above 6. */
export function hardnessIndex(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const magnitude = Math.abs(value);
  if (magnitude === 0) return null;
  if (magnitude <= 6) return magnitude;
  if (magnitude >= 1200) return 6;
  if (magnitude <= 19.3) return 1;
  return Math.pow(magnitude / 19.3, 1 / 2.4);
}

/** niViz Hardness.code from a hand-hardness index. */
export function hardnessClass(index: number | null | undefined): string | null {
  if (index === null || index === undefined || !Number.isFinite(index) || index <= 0) return null;
  const classes = ['F', '4F', '1F', 'P', 'K', 'I'];
  if (index < 1) return 'F';
  const lower = Math.min(6, Math.floor(index));
  if (index === lower || lower === 6) return classes[lower - 1]!;
  return `${classes[lower - 1]}-${classes[lower]}`;
}
