import type { Furniture, Layout, Room, SeatingConfig, Settings, Vec2 } from './types';
import {
  circlePolygon,
  dist,
  distPointSegment,
  lerp2,
  localToWorld,
  outwardNormal,
  pointInPolygon,
  polygonDistance,
  rectCorners,
  segmentsIntersect,
  v2,
  wallLength,
} from './geometry';
import { chairReach, isRoundShape, perimeterPerSeat, sideCountsOf } from './seats';
import { formatInches, inch } from './units';
import { isSolid } from './catalog';

export type WarningKind = 'overlap' | 'chairs' | 'outside' | 'wall' | 'door' | 'aisle' | 'spacing' | 'column' | 'danceFloor' | 'service' | 'spawn';

export interface LayoutWarning {
  kind: WarningKind;
  message: string;
  furnitureIds: string[];
  severity: 'warning' | 'advice';
}

export interface Analysis {
  warnings: LayoutWarning[];
  byFurniture: Map<string, LayoutWarning[]>;
}

/** The table / object itself. */
export function bodyFootprint(f: Furniture): Vec2[] {
  if (isRoundShape(f)) return circlePolygon(f.position, f.width / 2, 28);
  return rectCorners(f.position, f.width, f.depth, f.rotation);
}

/** The body plus room needed for chairs on every side that has seats. */
export function occupiedFootprint(f: Furniture, cfg: SeatingConfig): Vec2[] {
  const n = f.seats?.length ?? 0;
  if (!n) return bodyFootprint(f);
  const reach = chairReach(cfg);
  if (f.type === 'roundTable') return circlePolygon(f.position, f.width / 2 + reach, 28);
  const c = sideCountsOf(f);
  const top = c[0] ? reach : 0;
  const right = c[1] ? reach : 0;
  const bottom = c[2] ? reach : 0;
  const left = c[3] ? reach : 0;
  const hw = f.width / 2, hd = f.depth / 2;
  return [v2(-hw - left, -hd - top), v2(hw + right, -hd - top), v2(hw + right, hd + bottom), v2(-hw - left, hd + bottom)].map((p) =>
    localToWorld(f.position, f.rotation, p),
  );
}

/** Space behind a bar for the bartender (local −Z side). */
export const BAR_SERVICE_DEPTH = inch(36);
export function serviceZone(f: Furniture): Vec2[] | null {
  if (f.type !== 'bar') return null;
  const hw = f.width / 2, hd = f.depth / 2;
  return [v2(-hw, -hd - BAR_SERVICE_DEPTH), v2(hw, -hd - BAR_SERVICE_DEPTH), v2(hw, -hd), v2(-hw, -hd)].map((p) => localToWorld(f.position, f.rotation, p));
}

function boundingRadius(poly: Vec2[], c: Vec2): number {
  let r = 0;
  for (const p of poly) r = Math.max(r, dist(p, c));
  return r;
}

/** Inward clearance rectangle in front of each door. */
export function doorZones(room: Room, depth: number): { id: string; poly: Vec2[]; wallIndex: number }[] {
  const out: { id: string; poly: Vec2[]; wallIndex: number }[] = [];
  const vs = room.vertices;
  for (const o of room.openings) {
    if (o.kind !== 'door' || o.wallIndex >= vs.length) continue;
    const a = vs[o.wallIndex];
    const b = vs[(o.wallIndex + 1) % vs.length];
    const L = wallLength(vs, o.wallIndex);
    if (L <= 0) continue;
    const p0 = lerp2(a, b, o.offset / L);
    const p1 = lerp2(a, b, (o.offset + o.width) / L);
    const n = outwardNormal(vs, o.wallIndex);
    const inward = v2(-n.x * depth, -n.z * depth);
    out.push({ id: o.id, wallIndex: o.wallIndex, poly: [p0, p1, { x: p1.x + inward.x, z: p1.z + inward.z }, { x: p0.x + inward.x, z: p0.z + inward.z }] });
  }
  return out;
}

function polyOutsideRoom(poly: Vec2[], room: Vec2[]): boolean {
  if (!poly.every((p) => pointInPolygon(p, room))) return true;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    for (let j = 0; j < room.length; j++) if (segmentsIntersect(p, q, room[j], room[(j + 1) % room.length])) return true;
  }
  return false;
}

function distanceToWalls(poly: Vec2[], room: Vec2[]): number {
  let best = Infinity;
  for (const p of poly) for (let j = 0; j < room.length; j++) best = Math.min(best, distPointSegment(p, room[j], room[(j + 1) % room.length]));
  // room corners poking towards a footprint edge
  for (const r of room) for (let i = 0; i < poly.length; i++) best = Math.min(best, distPointSegment(r, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

export function analyzeLayout(layout: Layout, settings: Settings): Analysis {
  const warnings: LayoutWarning[] = [];
  const cfg = layout.seating;
  const room = layout.room.vertices;
  const items = layout.furniture;
  const aisle = settings.aisleWidth;

  const body = new Map<string, Vec2[]>();
  const occ = new Map<string, Vec2[]>();
  const rad = new Map<string, number>();
  for (const f of items) {
    const b = bodyFootprint(f);
    const o = occupiedFootprint(f, cfg);
    body.set(f.id, b);
    occ.set(f.id, o);
    rad.set(f.id, boundingRadius(o, f.position));
  }

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      const gap = dist(a.position, b.position) - rad.get(a.id)! - rad.get(b.id)!;
      if (gap > aisle) continue;
      const floorInvolved = a.type === 'danceFloor' || b.type === 'danceFloor';
      if (floorInvolved) {
        if (a.type === 'danceFloor' && b.type === 'danceFloor') {
          if (polygonDistance(body.get(a.id)!, body.get(b.id)!) === 0) {
            warnings.push({ kind: 'overlap', severity: 'warning', furnitureIds: [a.id, b.id], message: `${a.label} overlaps ${b.label}.` });
          }
          continue;
        }
        const other = a.type === 'danceFloor' ? b : a;
        const floor = a.type === 'danceFloor' ? a : b;
        if (polygonDistance(occ.get(other.id)!, body.get(floor.id)!) === 0) {
          warnings.push({ kind: 'danceFloor', severity: 'warning', furnitureIds: [other.id, floor.id], message: `${other.label} sits on the ${floor.label.toLowerCase()}.` });
        }
        continue;
      }
      if (polygonDistance(body.get(a.id)!, body.get(b.id)!) === 0) {
        warnings.push({ kind: 'overlap', severity: 'warning', furnitureIds: [a.id, b.id], message: `${a.label} overlaps ${b.label}.` });
        continue;
      }
      const d = polygonDistance(occ.get(a.id)!, occ.get(b.id)!);
      if (d === 0) {
        const who = a.seats?.length ? a : b;
        const other = who === a ? b : a;
        warnings.push({ kind: 'chairs', severity: 'warning', furnitureIds: [a.id, b.id], message: `Chairs at ${who.label} run into ${other.label}.` });
      } else if (d < aisle && a.type !== 'decoration' && b.type !== 'decoration') {
        warnings.push({
          kind: 'aisle',
          severity: 'advice',
          furnitureIds: [a.id, b.id],
          message: `Narrow passage between ${a.label} and ${b.label} (about ${formatInches(d, 1)}; aim for ${formatInches(aisle, 1)}).`,
        });
      }
    }
  }

  for (const f of items) {
    const b = body.get(f.id)!;
    const o = occ.get(f.id)!;
    if (polyOutsideRoom(b, room)) {
      warnings.push({ kind: 'outside', severity: 'warning', furnitureIds: [f.id], message: `${f.label} extends past a wall.` });
    } else if (f.seats?.length && polyOutsideRoom(o, room)) {
      warnings.push({ kind: 'wall', severity: 'warning', furnitureIds: [f.id], message: `Chairs at ${f.label} go through a wall.` });
    } else if (f.seats?.length && distanceToWalls(o, room) < inch(6)) {
      warnings.push({ kind: 'wall', severity: 'advice', furnitureIds: [f.id], message: `Chairs at ${f.label} are tight against a wall.` });
    }
    const svc = serviceZone(f);
    if (svc) {
      if (polyOutsideRoom(svc, room)) {
        warnings.push({ kind: 'service', severity: 'advice', furnitureIds: [f.id], message: `The service area behind ${f.label} (${formatInches(BAR_SERVICE_DEPTH, 1)}) runs into a wall.` });
      }
      for (const g of items) {
        if (g.id === f.id || g.type === 'danceFloor') continue;
        if (polygonDistance(svc, occ.get(g.id)!) === 0) {
          warnings.push({ kind: 'service', severity: 'warning', furnitureIds: [f.id, g.id], message: `${g.label} blocks the service area behind ${f.label}.` });
        }
      }
    }
    for (const c of layout.room.columns) {
      const cp = rectCorners(c.position, c.width, c.depth, 0);
      if (polygonDistance(o, cp) === 0) warnings.push({ kind: 'column', severity: 'warning', furnitureIds: [f.id], message: `${f.label} runs into a column.` });
    }
    const per = perimeterPerSeat(f);
    if (per !== null && per + 1e-6 < settings.perimeterPerGuest) {
      warnings.push({
        kind: 'spacing',
        severity: 'advice',
        furnitureIds: [f.id],
        message: `${f.label} gives about ${formatInches(per, 1)} per guest (advisory ${formatInches(settings.perimeterPerGuest, 1)}).`,
      });
    }
  }

  for (const z of doorZones(layout.room, Math.max(aisle, 1))) {
    for (const f of items) {
      if (!isSolid(f)) continue;
      if (polygonDistance(occ.get(f.id)!, z.poly) === 0) {
        warnings.push({ kind: 'door', severity: 'warning', furnitureIds: [f.id], message: `${f.label} blocks the door on wall ${z.wallIndex + 1}.` });
      }
    }
  }

  const sp = layout.room.spawn;
  if (!pointInPolygon(sp, room)) {
    warnings.push({ kind: 'spawn', severity: 'advice', furnitureIds: [], message: 'The walkthrough entrance point is outside the room. The walkthrough will start at the nearest open spot.' });
  } else {
    for (const f of items) {
      if (!isSolid(f)) continue;
      if (polygonDistance(circlePolygon(sp, 0.25, 12), occ.get(f.id)!) === 0) {
        warnings.push({ kind: 'spawn', severity: 'advice', furnitureIds: [f.id], message: `${f.label} covers the walkthrough entrance point. The walkthrough will start at the nearest open spot.` });
        break;
      }
    }
  }

  const byFurniture = new Map<string, LayoutWarning[]>();
  for (const w of warnings) for (const id of w.furnitureIds) {
    if (!byFurniture.has(id)) byFurniture.set(id, []);
    byFurniture.get(id)!.push(w);
  }
  return { warnings, byFurniture };
}
