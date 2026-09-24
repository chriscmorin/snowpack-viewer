/** A parsed SNOWPACK PRO station, with centimetre heights measured from the ground. */
export interface ProStation {
  name: string;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  slopeAngle: number | null;
  slopeAzimuth: number | null;
  parameters: Record<string, string>;
  headers: Record<string, ProHeader>;
  version: number;
  profiles: ProProfile[];
}

export interface ProHeader {
  id: string;
  type: string;
  description: string;
  line: number;
}

export interface ProSample {
  /** Top of an element, or node position, in cm. */
  top: number;
  /** Bottom of an element in cm. Same as top for node fields. */
  bottom: number;
  /** null represents missing data in the source. */
  value: number | null;
}

export interface ProField {
  id: string;
  name: string;
  type: string;
  samples: ProSample[];
  /** Source values, retained even if their count cannot be aligned to layers. */
  rawValues: (number | null)[];
  rawTokens: string[];
}

export interface ProProfile {
  /** Date as written in the PRO file. */
  dateText: string;
  /** Date interpreted as UTC, matching niViz's PRO parser. */
  date: Date;
  /** Milliseconds since Unix epoch. */
  timestamp: number;
  /** Top heights as written in 0501, including soil elements below ground. */
  heights: number[];
  /** Absolute top and bottom across snow and soil. */
  top: number;
  bottom: number;
  /** Positive-height snow layers and negative-height soil layers, bottom-to-top. */
  layers: ProLayer[];
  /** All numeric fields, indexed by their four-digit PRO code. */
  fields: Record<string, ProField>;
  /** The eight named 0530 stability values, when present. */
  stability: ProStability | null;
  /** niViz's legacy grain-shape terminal code 660. */
  surfaceHoar: boolean;
}

export interface ProLayer {
  index: number;
  top: number;
  bottom: number;
  kind: 'snow' | 'soil';
  /** Field values aligned with this layer; null is a source missing value. */
  values: Record<string, number | null>;
}

export interface ProStability {
  profileType: number | null;
  stabilityClass: number | null;
  zSdef: number | null;
  sdef: number | null;
  zSn38: number | null;
  sn38: number | null;
  zSk38: number | null;
  sk38: number | null;
}

export interface ParseProOptions {
  /** Reject malformed records and inconsistent declared value counts (default true). */
  strict?: boolean;
}
