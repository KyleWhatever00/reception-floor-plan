export const M_PER_FT = 0.3048;
export const M_PER_IN = 0.0254;

export const ft = (feet: number): number => feet * M_PER_FT;
export const inch = (inches: number): number => inches * M_PER_IN;
export const toFeet = (m: number): number => m / M_PER_FT;
export const toInches = (m: number): number => m / M_PER_IN;

export const deg = (d: number): number => (d * Math.PI) / 180;
export const toDeg = (r: number): number => (r * 180) / Math.PI;

/** Normalize an angle to (−π, π]. */
export function normalizeAngle(a: number): number {
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  if (r > Math.PI) r -= Math.PI * 2;
  return r;
}

/**
 * Format meters as feet and inches, e.g. 1.524 → `5′ 0″`.
 * Inches are rounded to `precisionIn` (default ½″).
 */
export function formatFtIn(m: number, precisionIn = 0.5): string {
  const sign = m < 0 ? '−' : '';
  let totalIn = Math.abs(toInches(m));
  totalIn = Math.round(totalIn / precisionIn) * precisionIn;
  let feet = Math.floor(totalIn / 12 + 1e-9);
  let inches = totalIn - feet * 12;
  if (inches >= 12 - 1e-9) {
    feet += 1;
    inches = 0;
  }
  const inStr = Number.isInteger(inches) ? String(inches) : inches.toFixed(1).replace(/\.0$/, '');
  if (feet === 0) return `${sign}${inStr}″`;
  return `${sign}${feet}′ ${inStr}″`;
}

/** Compact inches format, e.g. 1.524 → `60″`. */
export function formatInches(m: number, precisionIn = 0.5): string {
  const v = Math.round(toInches(m) / precisionIn) * precisionIn;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}″`;
}

/** Room-dimension style: whole feet + inches, e.g. `40′ 6″` or `40′`. */
export function formatFeetShort(m: number): string {
  const s = formatFtIn(m, 1);
  return s.replace(/ 0″$/, '');
}

/**
 * Parse a user-entered length into meters. Accepts:
 *   5        → 5 feet (bare numbers are feet)
 *   5.5      → 5.5 feet
 *   5' 6"    5'6   5ft 6in   5 ft 6 in   5′ 6″
 *   66in   66"   66 inches
 *   1.5m   150cm   1500mm
 * Returns null when the text cannot be understood.
 */
export function parseLength(input: string): number | null {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[′’‘`]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/''/g, '"')
    .replace(/,/g, '.');
  if (!s) return null;
  const neg = s.startsWith('-') || s.startsWith('−');
  const body = neg ? s.slice(1).trim() : s;
  const num = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
  const sign = neg ? -1 : 1;

  let m: RegExpMatchArray | null;
  if ((m = body.match(new RegExp(`^${num}\\s*(m|meters?|metres?)$`)))) return sign * parseFloat(m[1]);
  if ((m = body.match(new RegExp(`^${num}\\s*(cm|centimeters?|centimetres?)$`)))) return (sign * parseFloat(m[1])) / 100;
  if ((m = body.match(new RegExp(`^${num}\\s*(mm|millimeters?|millimetres?)$`)))) return (sign * parseFloat(m[1])) / 1000;
  if ((m = body.match(new RegExp(`^${num}\\s*("|in|inch|inches)$`)))) return sign * inch(parseFloat(m[1]));
  if ((m = body.match(new RegExp(`^${num}\\s*('|ft|foot|feet)?$`)))) return sign * ft(parseFloat(m[1]));
  m = body.match(new RegExp(`^${num}\\s*('|ft|foot|feet)\\s*-?\\s*${num}\\s*("|in|inch|inches)?$`));
  if (m) return sign * (ft(parseFloat(m[1])) + inch(parseFloat(m[3])));
  return null;
}

/** Parse an angle in degrees ("45", "45°", "-90 deg"). Returns radians or null. */
export function parseDegrees(input: string): number | null {
  const s = input.trim().replace(/°|deg(rees)?/gi, '').trim().replace('−', '-');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return deg(parseFloat(s));
}

export function snapTo(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}
