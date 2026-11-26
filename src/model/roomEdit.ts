import type { Opening, Pilaster, Room, Vec2 } from './types';
import { add, closestPointOnSegment, signedArea, dist, dot, len, lerp2, outwardNormal, polygonCentroid, rotate, scale, sub, wallLength } from './geometry';
import { validateRoom } from './validation';
import { ft, inch, parseLength } from './units';
import { newId } from './ids';

/** Pure room-outline edits that keep doors and windows attached to the right walls. */

export function insertVertexAfter(room: Room, i: number): { room: Room; dropped: number } {
  const r: Room = JSON.parse(JSON.stringify(room));
  const n = r.vertices.length;
  const a = r.vertices[i];
  const b = r.vertices[(i + 1) % n];
  const L = wallLength(r.vertices, i);
  const half = L / 2;
  const mid = lerp2(a, b, 0.5);
  r.vertices.splice(i + 1, 0, mid);
  let dropped = 0;
  const openings: Opening[] = [];
  for (const o of r.openings) {
    if (o.wallIndex > i) openings.push({ ...o, wallIndex: o.wallIndex + 1 });
    else if (o.wallIndex < i) openings.push(o);
    else if (o.offset + o.width <= half + 1e-9) openings.push(o);
    else if (o.offset >= half - 1e-9) openings.push({ ...o, wallIndex: i + 1, offset: o.offset - half });
    else dropped++;
  }
  r.openings = openings;
  if (r.features?.pilasters) {
    r.features.pilasters = r.features.pilasters.flatMap((p) => {
      if (p.wallIndex > i) return [{ ...p, wallIndex: p.wallIndex + 1 }];
      if (p.wallIndex < i) return [p];
      if (p.offset + p.width <= half + 1e-9) return [p];
      if (p.offset >= half - 1e-9) return [{ ...p, wallIndex: i + 1, offset: p.offset - half }];
      return [];
    });
  }
  return { room: r, dropped };
}

export function removeVertex(room: Room, i: number): { room: Room; dropped: number } {
  const r: Room = JSON.parse(JSON.stringify(room));
  const n = r.vertices.length;
  if (n <= 3) return { room: r, dropped: 0 };
  const prev = (i - 1 + n) % n;
  const prevLen = wallLength(r.vertices, prev);
  r.vertices.splice(i, 1);
  let dropped = 0;
  const openings: Opening[] = [];
  for (const o of r.openings) {
    if (o.wallIndex === i) {
      dropped++;
      continue;
    }
    if (o.wallIndex === prev) {
      // the merged wall starts at the same vertex; keep the offset if it still fits
      const newLen = wallLength(r.vertices, i === 0 ? r.vertices.length - 1 : i - 1);
      if (o.offset + o.width <= newLen + 1e-9 && prevLen > 0) openings.push({ ...o, wallIndex: i === 0 ? r.vertices.length - 1 : i - 1 });
      else dropped++;
      continue;
    }
    openings.push({ ...o, wallIndex: o.wallIndex > i ? o.wallIndex - 1 : o.wallIndex });
  }
  r.openings = openings;
  if (r.features?.pilasters) {
    const merged = i === 0 ? r.vertices.length - 1 : i - 1;
    r.features.pilasters = r.features.pilasters.flatMap((p) => {
      if (p.wallIndex === i) return [];
      if (p.wallIndex === prev) return [{ ...p, wallIndex: merged }];
      return [{ ...p, wallIndex: p.wallIndex > i ? p.wallIndex - 1 : p.wallIndex }];
    });
  }
  return { room: r, dropped };
}

/**
 * Move a corner. Doors, windows and pilasters on the two walls that meet there keep their place in
 * the room where possible; anything that no longer fits is clamped (or dropped if impossible).
 */
export function moveVertex(room: Room, i: number, p: Vec2): Room {
  const r: Room = JSON.parse(JSON.stringify(room));
  const n = r.vertices.length;
  r.vertices[i] = { ...p };
  reanchorWallItems(room, r, [(i - 1 + n) % n, i]);
  r.openings = fitOpenings(r);
  return r;
}

/**
 * Slide wall `i` sideways by `delta` metres along its outward normal (positive = outward, making
 * the room bigger). Both of its corners move, so the neighbouring walls stretch or shrink.
 * Doors, windows and pilasters stay where they are in the room; sconces on the wall and ceiling
 * zone edges that sat on the wall move with it.
 */
export function moveWall(room: Room, i: number, delta: number): Room {
  const r: Room = JSON.parse(JSON.stringify(room));
  const n = r.vertices.length;
  const j = (i + 1) % n;
  const nrm = outwardNormal(room.vertices, i);
  const shift = scale(nrm, delta);
  const a0 = room.vertices[i], b0 = room.vertices[j];
  r.vertices[i] = add(a0, shift);
  r.vertices[j] = add(b0, shift);
  reanchorWallItems(room, r, [(i - 1 + n) % n, i, j]);
  r.openings = fitOpenings(r);

  const f = r.features;
  if (f?.fixtures) {
    for (const fx of f.fixtures) {
      if (fx.kind === 'sconce' && dist(fx.position, closestPointOnSegment(fx.position, a0, b0)) < 0.6) fx.position = add(fx.position, shift);
    }
  }
  if (f?.ceilings) {
    const L0 = dist(a0, b0);
    const tangent = L0 > 0 ? scale(sub(b0, a0), 1 / L0) : { x: 1, z: 0 };
    for (const z of f.ceilings) {
      for (const axis of ['width', 'depth'] as const) {
        const dir = rotate(axis === 'width' ? { x: 1, z: 0 } : { x: 0, z: 1 }, z.rotation);
        const dn = dot(nrm, dir);
        if (Math.abs(dn) < 0.995) continue;
        const half = z[axis] / 2;
        const other = axis === 'width' ? z.depth / 2 : z.width / 2;
        for (const s of [1, -1]) {
          const edgeMid = add(z.center, scale(dir, s * half));
          if (Math.abs(dot(sub(edgeMid, a0), nrm)) > 0.35) continue;
          // the edge must overlap the wall along its length
          const t = dot(sub(edgeMid, a0), tangent);
          if (t + other < -0.05 || t - other > L0 + 0.05) continue;
          const e1 = s * half + delta * dn;
          const e2 = -s * half;
          const size = Math.abs(e1 - e2);
          if (size < 0.3) continue;
          z.center = add(z.center, scale(dir, (e1 + e2) / 2));
          z[axis] = size;
          break;
        }
      }
    }
  }
  return r;
}

/**
 * After the corners of some walls moved, re-measure the doors, windows and pilasters on those
 * walls so their centres stay at the same spot in the room (projected onto the new wall).
 */
export function reanchorWallItems(before: Room, after: Room, walls: number[]): void {
  const set = new Set(walls);
  const n = after.vertices.length;
  if (before.vertices.length !== n) return;
  const project = (wallIndex: number, offset: number, width: number): number => {
    const a0 = before.vertices[wallIndex], b0 = before.vertices[(wallIndex + 1) % n];
    const L0 = dist(a0, b0) || 1;
    const c = lerp2(a0, b0, (offset + width / 2) / L0);
    const a = after.vertices[wallIndex], b = after.vertices[(wallIndex + 1) % n];
    const d = sub(b, a);
    const L = len(d) || 1;
    const t = dot(sub(c, a), d) / L;
    return Math.min(Math.max(0, t - width / 2), Math.max(0, L - width));
  };
  for (const o of after.openings) if (set.has(o.wallIndex)) o.offset = project(o.wallIndex, o.offset, o.width);
  if (after.features?.pilasters) {
    after.features.pilasters = after.features.pilasters.filter((p) => {
      if (!set.has(p.wallIndex)) return true;
      if (p.width > wallLength(after.vertices, p.wallIndex)) return false;
      p.offset = project(p.wallIndex, p.offset, p.width);
      return true;
    });
  }
}

/** False when an edit flipped the outline inside out (e.g. a wall dragged past the opposite wall). */
export function keepsWinding(before: Room, after: Room): boolean {
  return Math.sign(signedArea(before.vertices)) === Math.sign(signedArea(after.vertices));
}

/** The wall nearest to a floor point, with the distance along it (unclamped) and away from it. */
export function nearestWall(vertices: Vec2[], p: Vec2): { index: number; along: number; distance: number } {
  let best = { index: 0, along: 0, distance: Infinity };
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const d = dist(p, closestPointOnSegment(p, a, b));
    if (d < best.distance) best = { index: i, along: alongWall(vertices, i, p), distance: d };
  }
  return best;
}

/** Distance of a point's projection along wall `i`, measured from the wall's first corner. */
export function alongWall(vertices: Vec2[], i: number, p: Vec2): number {
  const a = vertices[i], b = vertices[(i + 1) % vertices.length];
  const d = sub(b, a);
  const L = len(d) || 1;
  return dot(sub(p, a), d) / L;
}

export function fitOpenings(r: Room): Opening[] {
  const out: Opening[] = [];
  for (const o of r.openings) {
    if (o.wallIndex >= r.vertices.length) continue;
    const L = wallLength(r.vertices, o.wallIndex);
    if (o.width > L) continue;
    out.push({ ...o, offset: Math.min(Math.max(0, o.offset), L - o.width) });
  }
  return out;
}

export function rectangleRoom(room: Room, width: number, length: number): Room {
  const r: Room = JSON.parse(JSON.stringify(room));
  if (r.features) r.features.pilasters = (r.features.pilasters ?? []).filter((p) => p.wallIndex < 4);
  const hw = width / 2, hl = length / 2;
  r.vertices = [{ x: -hw, z: -hl }, { x: hw, z: -hl }, { x: hw, z: hl }, { x: -hw, z: hl }];
  r.openings = fitOpenings({ ...r, openings: r.openings.filter((o) => o.wallIndex < 4) });
  const c = polygonCentroid(r.vertices);
  r.spawn = { x: c.x, z: hl - 1.2 };
  r.spawnYaw = 0;
  r.columns = r.columns.filter((col) => Math.abs(col.position.x) < hw && Math.abs(col.position.z) < hl);
  return r;
}

/**
 * Parse pasted corner coordinates: one corner per line, "x, z" (or tab/space separated).
 * Bare numbers are feet; units such as 12' 6", 3.2m are accepted.
 */
export function parseOutline(text: string): { vertices: Vec2[]; errors: string[] } {
  const vertices: Vec2[] = [];
  const errors: string[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .forEach((line, i) => {
      const parts = line.includes(',') ? line.split(',') : line.includes('\t') ? line.split('\t') : line.split(/\s{2,}|\s(?=[-\d.])/);
      const clean = parts.map((p) => p.trim()).filter(Boolean);
      if (clean.length !== 2) {
        errors.push(`Line ${i + 1}: expected two values (x, z).`);
        return;
      }
      const x = parseLength(clean[0]);
      const z = parseLength(clean[1]);
      if (x === null || z === null) errors.push(`Line ${i + 1}: couldn't read "${line}".`);
      else vertices.push({ x, z });
    });
  return { vertices, errors };
}

export function tryRoom(r: Room): string[] {
  return validateRoom(r);
}

/**
 * Add a stone pilaster where it doesn't cover a door, window or another pilaster: longest wall
 * first, searching outward from the middle of each wall in 6″ steps.
 */
export function addPilaster(room: Room, width = ft(3), depth = ft(1)): { room: Room; pilaster: Pilaster } {
  const r: Room = JSON.parse(JSON.stringify(room));
  r.features = r.features ?? {};
  const pilasters = (r.features.pilasters = r.features.pilasters ?? []);
  const vs = r.vertices;
  const walls = vs.map((_, i) => i).sort((a, b) => wallLength(vs, b) - wallLength(vs, a));
  const step = inch(6);
  const taken = (i: number) => [...r.openings.filter((o) => o.wallIndex === i), ...pilasters.filter((p) => p.wallIndex === i)];
  let spot: { wallIndex: number; offset: number } | null = null;
  for (const i of walls) {
    const L = wallLength(vs, i);
    if (L < width) continue;
    const busy = taken(i);
    const mid = (L - width) / 2;
    for (let k = 0; k * step <= mid + 1e-9 && !spot; k++) {
      for (const off of k === 0 ? [mid] : [mid - k * step, mid + k * step]) {
        if (off < -1e-9 || off + width > L + 1e-9) continue;
        if (busy.every((o) => off + width <= o.offset + 1e-9 || off >= o.offset + o.width - 1e-9)) {
          spot = { wallIndex: i, offset: Math.max(0, off) };
          break;
        }
      }
    }
    if (spot) break;
  }
  if (!spot) {
    const i = walls[0];
    const L = wallLength(vs, i);
    width = Math.min(width, L);
    spot = { wallIndex: i, offset: (L - width) / 2 };
  }
  const pilaster: Pilaster = { id: newId('pil'), wallIndex: spot.wallIndex, offset: spot.offset, width, depth, material: 'stone' };
  pilasters.push(pilaster);
  return { room: r, pilaster };
}
