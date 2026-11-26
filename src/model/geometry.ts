import type { Vec2 } from './types';

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.z - a.z * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const lerp2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

/**
 * Rotate a local offset into world space using the same convention as
 * Three.js `object.rotation.y` (right-handed, Y up).
 */
export function rotate(p: Vec2, rot: number): Vec2 {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: p.x * c + p.z * s, z: -p.x * s + p.z * c };
}

/** Inverse of `rotate`. */
export function unrotate(p: Vec2, rot: number): Vec2 {
  return rotate(p, -rot);
}

export function localToWorld(center: Vec2, rot: number, local: Vec2): Vec2 {
  return add(center, rotate(local, rot));
}

export function worldToLocal(center: Vec2, rot: number, world: Vec2): Vec2 {
  return unrotate(sub(world, center), rot);
}

/** Yaw (Three.js rotation.y) that makes an object's local +Z axis point along `dir`. */
export function yawFacing(dir: Vec2): number {
  return Math.atan2(dir.x, dir.z);
}

/** Shoelace signed area on the X/Z plane. */
export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

export function polygonArea(poly: Vec2[]): number {
  return Math.abs(signedArea(poly));
}

export function polygonBounds(poly: Vec2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) {
    const s = poly.reduce((acc, p) => add(acc, p), v2(0, 0));
    return scale(s, 1 / Math.max(1, poly.length));
  }
  let cx = 0, cz = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.z - q.x * p.z;
    cx += (p.x + q.x) * f;
    cz += (p.z + q.z) * f;
  }
  return { x: cx / (6 * a), z: cz / (6 * a) };
}

/** Outward unit normal of wall `i` (from vertex i to i+1). */
export function outwardNormal(poly: Vec2[], i: number): Vec2 {
  const a = poly[i];
  const b = poly[(i + 1) % poly.length];
  const d = sub(b, a);
  const l = len(d) || 1;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  return { x: (sign * d.z) / l, z: (-sign * d.x) / l };
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return cross(sub(b, a), sub(c, a));
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) - 1e-12 <= p.x &&
    p.x <= Math.max(a.x, b.x) + 1e-12 &&
    Math.min(a.z, b.z) - 1e-12 <= p.z &&
    p.z <= Math.max(a.z, b.z) + 1e-12
  );
}

export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const eps = 1e-12;
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
  if (Math.abs(o1) <= eps && onSegment(a, b, c)) return true;
  if (Math.abs(o2) <= eps && onSegment(a, b, d)) return true;
  if (Math.abs(o3) <= eps && onSegment(c, d, a)) return true;
  if (Math.abs(o4) <= eps && onSegment(c, d, b)) return true;
  return false;
}

/** True when any two non-adjacent edges of the polygon cross or touch. */
export function isSelfIntersecting(poly: Vec2[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = poly[j];
      const d = poly[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return { ...a };
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { x: a.x + ab.x * t, z: a.z + ab.z * t };
}

export function distPointSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return dist(p, closestPointOnSegment(p, a, b));
}

/** Corners of an oriented rectangle, counter-clockwise in local space. */
export function rectCorners(center: Vec2, width: number, depth: number, rot: number): Vec2[] {
  const hw = width / 2;
  const hd = depth / 2;
  return [v2(-hw, -hd), v2(hw, -hd), v2(hw, hd), v2(-hw, hd)].map((p) => localToWorld(center, rot, p));
}

export function circlePolygon(center: Vec2, r: number, segments = 24): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(v2(center.x + Math.cos(t) * r, center.z + Math.sin(t) * r));
  }
  return pts;
}

/** Minimum distance between two simple polygons; 0 if they overlap or one contains the other. */
export function polygonDistance(a: Vec2[], b: Vec2[]): number {
  for (let i = 0; i < a.length; i++) {
    const p = a[i];
    const q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsIntersect(p, q, b[j], b[(j + 1) % b.length])) return 0;
    }
  }
  if (pointInPolygon(a[0], b) || pointInPolygon(b[0], a)) return 0;
  let best = Infinity;
  for (const p of a) {
    for (let j = 0; j < b.length; j++) best = Math.min(best, distPointSegment(p, b[j], b[(j + 1) % b.length]));
  }
  for (const p of b) {
    for (let i = 0; i < a.length; i++) best = Math.min(best, distPointSegment(p, a[i], a[(i + 1) % a.length]));
  }
  return best;
}

/** Approximate overlap depth test: do the polygons overlap by more than `tolerance` meters? */
export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  return polygonDistance(a, b) === 0;
}

/** Offset a convex polygon outward by `d` (mitred corners). */
export function offsetConvex(poly: Vec2[], d: number): Vec2[] {
  const n = poly.length;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const normal = (a: Vec2, b: Vec2): Vec2 => {
    const e = sub(b, a);
    const l = len(e) || 1;
    return { x: (sign * e.z) / l, z: (-sign * e.x) / l };
  };
  return poly.map((p, i) => {
    const n1 = normal(poly[(i - 1 + n) % n], p);
    const n2 = normal(p, poly[(i + 1) % n]);
    const m = { x: n1.x + n2.x, z: n1.z + n2.z };
    const ml = len(m) || 1;
    const dir = { x: m.x / ml, z: m.z / ml };
    const k = d / Math.max(0.2, dot(dir, n1));
    return { x: p.x + dir.x * k, z: p.z + dir.z * k };
  });
}

/** Is the room corner at vertex i convex (pointing out of the room)? */
export function isConvexCorner(poly: Vec2[], i: number): boolean {
  const n = poly.length;
  const a = poly[(i - 1 + n) % n];
  const b = poly[i];
  const c = poly[(i + 1) % n];
  const turn = cross(sub(b, a), sub(c, b));
  return signedArea(poly) >= 0 ? turn >= 0 : turn <= 0;
}

export function wallLength(poly: Vec2[], i: number): number {
  return dist(poly[i], poly[(i + 1) % poly.length]);
}

/** Keep the part of `poly` on one side of the line a→b (side > 0: left of a→b, i.e. cross > 0). */
export function clipHalfPlane(poly: Vec2[], a: Vec2, b: Vec2, side: 1 | -1): Vec2[] {
  const ab = sub(b, a);
  const val = (p: Vec2) => side * cross(ab, sub(p, a));
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const vp = val(p), vq = val(q);
    if (vp >= 0) out.push(p);
    if ((vp >= 0) !== (vq >= 0)) {
      const t = vp / (vp - vq);
      out.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
    }
  }
  return out;
}

/**
 * `poly` minus a convex polygon, as a list of pieces (each the part of `poly` beyond one edge of
 * the convex shape but inside the edges before it). `poly` may be concave.
 */
export function subtractConvex(poly: Vec2[], convex: Vec2[]): Vec2[][] {
  const inside: 1 | -1 = signedArea(convex) >= 0 ? 1 : -1;
  const out: Vec2[][] = [];
  let rest = poly;
  for (let i = 0; i < convex.length && rest.length >= 3; i++) {
    const a = convex[i], b = convex[(i + 1) % convex.length];
    const beyond = clipHalfPlane(rest, a, b, inside === 1 ? -1 : 1);
    if (beyond.length >= 3 && polygonArea(beyond) > 1e-4) out.push(beyond);
    rest = clipHalfPlane(rest, a, b, inside);
  }
  return out;
}
