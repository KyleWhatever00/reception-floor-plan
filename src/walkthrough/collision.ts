import type { Layout, Vec2 } from '../model/types';
import { isConvexCorner, lerp2, outwardNormal, pointInPolygon, polygonBounds, rotate, sub, unrotate, v2, wallLength, dist } from '../model/geometry';
import { isSolid } from '../model/catalog';
import { isRoundShape, seatPoses } from '../model/seats';

export type Collider =
  | { kind: 'box'; cx: number; cz: number; hw: number; hd: number; rot: number; tag: string }
  | { kind: 'circle'; cx: number; cz: number; r: number; tag: string };

export interface WallPiece {
  a: Vec2;
  b: Vec2;
  wallIndex: number;
}

/** Solid stretches of each wall (doors removed; windows stay solid at floor level). */
export function wallPieces(vertices: Vec2[], openings: Layout['room']['openings']): WallPiece[] {
  const out: WallPiece[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const L = wallLength(vertices, i);
    if (L < 1e-6) continue;
    const gaps = openings
      .filter((o) => o.wallIndex === i && o.kind === 'door' && o.sillHeight < 0.3)
      .map((o) => [Math.max(0, o.offset), Math.min(L, o.offset + o.width)] as [number, number])
      .sort((x, y) => x[0] - y[0]);
    let t = 0;
    for (const [s, e] of gaps) {
      if (s > t + 1e-4) out.push({ a: lerp2(a, b, t / L), b: lerp2(a, b, s / L), wallIndex: i });
      t = Math.max(t, e);
    }
    if (t < L - 1e-4) out.push({ a: lerp2(a, b, t / L), b: lerp2(a, b, 1), wallIndex: i });
  }
  return out;
}

export function buildColliders(layout: Layout): Collider[] {
  const cs: Collider[] = [];
  const { room } = layout;
  const t = room.wallThickness;
  for (const p of wallPieces(room.vertices, room.openings)) {
    const n = outwardNormal(room.vertices, p.wallIndex);
    const d = sub(p.b, p.a);
    const L = Math.hypot(d.x, d.z);
    const mid = lerp2(p.a, p.b, 0.5);
    // Extend pieces that end at a room corner by the wall thickness so corners stay sealed.
    const nv = room.vertices.length;
    const startsAtCorner = dist(p.a, room.vertices[p.wallIndex]) < 1e-4 && isConvexCorner(room.vertices, p.wallIndex);
    const endsAtCorner = dist(p.b, room.vertices[(p.wallIndex + 1) % nv]) < 1e-4 && isConvexCorner(room.vertices, (p.wallIndex + 1) % nv);
    const ext = (startsAtCorner ? t : 0) + (endsAtCorner ? t : 0);
    const shift = ((endsAtCorner ? t : 0) - (startsAtCorner ? t : 0)) / 2;
    const dir = v2(d.x / L, d.z / L);
    cs.push({
      kind: 'box',
      cx: mid.x + n.x * (t / 2) + dir.x * shift,
      cz: mid.z + n.z * (t / 2) + dir.z * shift,
      hw: (L + ext) / 2,
      hd: t / 2,
      rot: Math.atan2(-d.z, d.x),
      tag: `wall${p.wallIndex}`,
    });
  }
  for (const p of room.features?.pilasters ?? []) {
    if (p.wallIndex < 0 || p.wallIndex >= room.vertices.length) continue;
    const a = room.vertices[p.wallIndex], b = room.vertices[(p.wallIndex + 1) % room.vertices.length];
    const L = wallLength(room.vertices, p.wallIndex);
    if (L <= 0) continue;
    const n = outwardNormal(room.vertices, p.wallIndex);
    const mid = lerp2(a, b, Math.min(L, Math.max(0, p.offset + p.width / 2)) / L);
    cs.push({ kind: 'box', cx: mid.x - n.x * (p.depth / 2), cz: mid.z - n.z * (p.depth / 2), hw: p.width / 2, hd: p.depth / 2, rot: Math.atan2(-(b.z - a.z), b.x - a.x), tag: p.id });
  }
  for (const c of room.columns) cs.push({ kind: 'box', cx: c.position.x, cz: c.position.z, hw: c.width / 2, hd: c.depth / 2, rot: 0, tag: c.id });
  for (const f of layout.furniture) {
    if (!isSolid(f)) continue;
    if (isRoundShape(f)) cs.push({ kind: 'circle', cx: f.position.x, cz: f.position.z, r: f.width / 2, tag: f.id });
    else cs.push({ kind: 'box', cx: f.position.x, cz: f.position.z, hw: f.width / 2, hd: f.depth / 2, rot: f.rotation, tag: f.id });
    if (f.seats?.length) {
      const r = Math.max(layout.seating.chairWidth, layout.seating.chairDepth) / 2;
      for (const s of seatPoses(f, layout.seating)) cs.push({ kind: 'circle', cx: s.position.x, cz: s.position.z, r, tag: s.seatId });
    }
  }
  return cs;
}

/** Penetration vector that moves a circle out of a collider, or null if not touching. */
export function penetration(p: Vec2, r: number, c: Collider): Vec2 | null {
  if (c.kind === 'circle') {
    const dx = p.x - c.cx, dz = p.z - c.cz;
    const d = Math.hypot(dx, dz);
    const min = r + c.r;
    if (d >= min) return null;
    if (d < 1e-9) return v2(min, 0);
    return v2((dx / d) * (min - d), (dz / d) * (min - d));
  }
  const local = unrotate(v2(p.x - c.cx, p.z - c.cz), c.rot);
  const qx = Math.max(-c.hw, Math.min(c.hw, local.x));
  const qz = Math.max(-c.hd, Math.min(c.hd, local.z));
  const dx = local.x - qx, dz = local.z - qz;
  const d = Math.hypot(dx, dz);
  let push: Vec2;
  if (d > 1e-9) {
    if (d >= r) return null;
    push = v2((dx / d) * (r - d), (dz / d) * (r - d));
  } else {
    // centre inside the box: leave along the shallowest axis
    const ox = c.hw - Math.abs(local.x);
    const oz = c.hd - Math.abs(local.z);
    push = ox < oz ? v2(Math.sign(local.x || 1) * (ox + r), 0) : v2(0, Math.sign(local.z || 1) * (oz + r));
  }
  return rotate(push, c.rot);
}

export function isFree(p: Vec2, r: number, colliders: Collider[]): boolean {
  return colliders.every((c) => penetration(p, r, c) === null);
}

/** Push a circle out of all colliders (a few relaxation passes give smooth wall sliding). */
export function resolve(p: Vec2, r: number, colliders: Collider[], iterations = 4): Vec2 {
  let q = { ...p };
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (const c of colliders) {
      const pen = penetration(q, r, c);
      if (pen) {
        q = v2(q.x + pen.x, q.z + pen.z);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return q;
}

/** Move with substeps so fast motion cannot tunnel through thin walls. */
export function moveWithCollisions(p: Vec2, delta: Vec2, r: number, colliders: Collider[]): Vec2 {
  const distance = Math.hypot(delta.x, delta.z);
  const steps = Math.max(1, Math.ceil(distance / (r * 0.5)));
  let q = { ...p };
  for (let i = 0; i < steps; i++) {
    q = resolve(v2(q.x + delta.x / steps, q.z + delta.z / steps), r, colliders);
  }
  return q;
}

/** Nearest free spot inside the room, searching outward in rings from `start`. */
export function findFreeSpot(start: Vec2, r: number, colliders: Collider[], roomPoly: Vec2[]): Vec2 {
  const ok = (p: Vec2) => pointInPolygon(p, roomPoly) && isFree(p, r, colliders);
  if (ok(start)) return start;
  const b = polygonBounds(roomPoly);
  const maxR = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ);
  for (let ring = 0.25; ring < maxR; ring += 0.25) {
    const n = Math.max(8, Math.ceil((ring * Math.PI * 2) / 0.25));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = v2(start.x + Math.cos(a) * ring, start.z + Math.sin(a) * ring);
      if (ok(p)) return p;
    }
  }
  return start;
}
