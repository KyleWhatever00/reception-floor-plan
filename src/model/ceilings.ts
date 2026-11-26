import type { CeilingZone, Fixture, Room, Vec2 } from './types';
import { dist, lerp2, polygonBounds, polygonCentroid, polygonDistance, pointInPolygon, rectCorners, sub, unrotate, wallLength } from './geometry';
import { nearestWall } from './roomEdit';
import { ft } from './units';
import { newId } from './ids';

/**
 * Ceiling zones and chandeliers. A zone is a rectangle with either a flat ceiling or a vaulted
 * (truss) ceiling whose ridge runs along the zone's local X axis. Anywhere not covered by a zone has
 * a flat ceiling at the wall height.
 */

export type ChandelierKind = 'iron-chandelier' | 'crystal-chandelier';

export const isChandelier = (f: Fixture): f is Fixture & { kind: ChandelierKind } => f.kind === 'iron-chandelier' || f.kind === 'crystal-chandelier';

/** Ceiling height of one zone at a floor point, or null if the point is outside the zone. */
export function zoneHeightAt(z: CeilingZone, p: Vec2, margin = 1e-6): number | null {
  const q = unrotate(sub(p, z.center), z.rotation);
  if (Math.abs(q.x) > z.width / 2 + margin || Math.abs(q.z) > z.depth / 2 + margin) return null;
  if (z.kind === 'flat' || !z.peakHeight) return z.height;
  return z.height + (z.peakHeight - z.height) * (1 - Math.min(1, Math.abs(q.z) / (z.depth / 2)));
}

/** The first zone covering a point (optionally ignoring one zone). */
export function zoneAt(room: Room, p: Vec2, excludeId?: string): CeilingZone | undefined {
  return (room.features?.ceilings ?? []).find((z) => z.id !== excludeId && zoneHeightAt(z, p) !== null);
}

/** Ceiling height at a floor point: the zone covering it, else the wall height. */
export function ceilingAt(room: Room, p: Vec2, excludeId?: string): number {
  const z = zoneAt(room, p, excludeId);
  return z ? zoneHeightAt(z, p)! : room.wallHeight;
}

export function zoneCorners(z: CeilingZone): Vec2[] {
  return rectCorners(z.center, z.width, z.depth, z.rotation);
}

/** True when the zone's local X axis points along the plan's Z axis (ridge runs top↕bottom). */
const swapped = (z: CeilingZone) => Math.abs(Math.sin(z.rotation)) > 0.5;

/** Size of the zone along the plan's X (left–right) and Z (top–bottom) axes. */
export function zoneExtents(z: CeilingZone): { sx: number; sz: number } {
  return swapped(z) ? { sx: z.depth, sz: z.width } : { sx: z.width, sz: z.depth };
}

export function setZoneExtents(z: CeilingZone, sx: number, sz: number): void {
  if (swapped(z)) {
    z.depth = sx;
    z.width = sz;
  } else {
    z.width = sx;
    z.depth = sz;
  }
}

/** Does the vaulted ridge run left↔right on the plan? */
export function ridgeLeftRight(z: CeilingZone): boolean {
  return !swapped(z);
}

/** Turn the ridge without changing the area the zone covers. */
export function setRidge(z: CeilingZone, leftRight: boolean): void {
  const { sx, sz } = zoneExtents(z);
  z.rotation = leftRight ? 0 : Math.PI / 2;
  setZoneExtents(z, sx, sz);
}

/** Pairs of zones that overlap (touching edges are fine). */
export function overlappingZones(room: Room): [CeilingZone, CeilingZone][] {
  const zs = room.features?.ceilings ?? [];
  const shrink = 0.05;
  const polys = zs.map((z) => rectCorners(z.center, Math.max(0.01, z.width - shrink * 2), Math.max(0.01, z.depth - shrink * 2), z.rotation));
  const out: [CeilingZone, CeilingZone][] = [];
  for (let i = 0; i < zs.length; i++) for (let j = i + 1; j < zs.length; j++) if (polygonDistance(polys[i], polys[j]) === 0) out.push([zs[i], zs[j]]);
  return out;
}

/**
 * A new zone centred near `at`, kept inside the room's bounding box. Flat zones default to 9′ —
 * lower than a typical wall — and truss zones span the room's shorter dimension with the ridge
 * along the longer one.
 */
export function newCeilingZone(room: Room, kind: CeilingZone['kind'], at: Vec2): CeilingZone {
  const b = polygonBounds(room.vertices);
  const bx = b.maxX - b.minX, bz = b.maxZ - b.minZ;
  const H = room.wallHeight;
  const centre = pointInPolygon(at, room.vertices) ? at : polygonCentroid(room.vertices);
  let sx: number, sz: number;
  const z: CeilingZone =
    kind === 'flat'
      ? { id: newId('ceil'), kind, center: centre, width: 0, depth: 0, rotation: 0, height: Math.max(ft(8), Math.min(ft(10), H - ft(1))) }
      : { id: newId('ceil'), kind, center: centre, width: 0, depth: 0, rotation: bx >= bz ? 0 : Math.PI / 2, height: H, peakHeight: H + ft(8), trussSpacing: ft(12) };
  if (kind === 'flat') {
    sx = Math.min(ft(24), bx);
    sz = Math.min(ft(16), bz);
  } else {
    sx = Math.min(ft(40), bx);
    sz = Math.min(ft(30), bz);
  }
  setZoneExtents(z, sx, sz);
  z.center = {
    x: Math.min(Math.max(centre.x, b.minX + sx / 2), b.maxX - sx / 2),
    z: Math.min(Math.max(centre.z, b.minZ + sz / 2), b.maxZ - sz / 2),
  };
  return z;
}

/** How far below the ceiling a chandelier's bottom must be so it doesn't poke through. */
export function chandelierMinDrop(kind: ChandelierKind): number {
  return kind === 'iron-chandelier' ? 0.6 : 0.3;
}

/** Bottom height a chandelier can actually hang at under the ceiling at its position. */
export function chandelierHangHeight(room: Room, f: Fixture): number {
  if (!isChandelier(f)) return f.height;
  return Math.max(0.5, Math.min(f.height, ceilingAt(room, f.position) - chandelierMinDrop(f.kind)));
}

/** A new chandelier at `at` with a size and hanging height that suit the ceiling above it. */
export function newChandelier(room: Room, kind: ChandelierKind, at: Vec2): Fixture {
  const position = pointInPolygon(at, room.vertices) ? at : polygonCentroid(room.vertices);
  const ceil = ceilingAt(room, position);
  const height =
    kind === 'iron-chandelier'
      ? Math.max(ft(8), Math.min(ft(12), ceil - ft(3)))
      : Math.max(ft(7.5), ceil - ft(1.4));
  return {
    id: newId('fx'),
    kind,
    position: { ...position },
    height: Math.min(height, ceil - chandelierMinDrop(kind)),
    size: kind === 'iron-chandelier' ? ft(5) : ft(3),
  };
}

// ------------------------------------------------------------------ wall lights (sconces)

/** Which wall a wall light is on and how far along it (from the wall's first corner). */
export function sconcePlacement(room: Room, f: Fixture): { wall: number; along: number } {
  const near = nearestWall(room.vertices, f.position);
  const L = wallLength(room.vertices, near.index);
  return { wall: near.index, along: Math.max(0, Math.min(L, near.along)) };
}

/** A point `along` metres from the start of `wall`, kept a little away from the corners. */
export function pointOnWall(room: Room, wall: number, along: number): Vec2 {
  const vs = room.vertices;
  const L = wallLength(vs, wall);
  const edge = Math.min(0.15, L / 2);
  const t = Math.max(edge, Math.min(L - edge, along));
  return lerp2(vs[wall], vs[(wall + 1) % vs.length], L > 0 ? t / L : 0);
}

/**
 * A new wall light on the wall nearest `near`, at the closest spot that is not over a door or
 * window and at least 3′ from other wall lights. Falls back to other walls, longest first.
 */
export function newSconce(room: Room, near: Vec2): Fixture {
  const vs = room.vertices;
  const first = nearestWall(vs, near);
  const others = vs.map((_, i) => i).filter((i) => i !== first.index).sort((a, b) => wallLength(vs, b) - wallLength(vs, a));
  const lights = (room.features?.fixtures ?? []).filter((f) => f.kind === 'sconce');
  const clearOpening = 0.25, spacing = ft(3), step = 0.15;
  const ok = (wall: number, t: number) => {
    if (room.openings.some((o) => o.wallIndex === wall && t > o.offset - clearOpening && t < o.offset + o.width + clearOpening)) return false;
    const p = pointOnWall(room, wall, t);
    return lights.every((f) => dist(f.position, p) >= spacing);
  };
  for (const wall of [first.index, ...others]) {
    const L = wallLength(vs, wall);
    if (L < 0.6) continue;
    const start = wall === first.index ? Math.max(0.3, Math.min(L - 0.3, first.along)) : L / 2;
    for (let k = 0; k * step <= L; k++) {
      for (const t of k === 0 ? [start] : [start - k * step, start + k * step]) {
        if (t < 0.3 || t > L - 0.3 || !ok(wall, t)) continue;
        return { id: newId('fx'), kind: 'sconce', position: pointOnWall(room, wall, t), height: sconceDefaultHeight(room), size: ft(1) };
      }
    }
  }
  return { id: newId('fx'), kind: 'sconce', position: pointOnWall(room, first.index, first.along), height: sconceDefaultHeight(room), size: ft(1) };
}

export function sconceDefaultHeight(room: Room): number {
  return Math.min(ft(7.5), room.wallHeight - ft(1));
}
