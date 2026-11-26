import type { Furniture, FurnitureType, Seat, SeatingConfig, Vec2 } from './types';
import { localToWorld, rotate, v2, yawFacing } from './geometry';
import { newId } from './ids';

export const SEATED_TYPES: FurnitureType[] = ['roundTable', 'rectTable', 'sweetheart'];

export function hasSeats(f: Furniture): boolean {
  return SEATED_TYPES.includes(f.type);
}

export function isRoundShape(f: Furniture): boolean {
  return f.type === 'roundTable' || (f.type === 'cake' && f.variant !== 'rect');
}

export interface SeatPose {
  seatId: string;
  index: number;
  /** Chair centre, world space. */
  position: Vec2;
  /** Unit vector the seated guest faces (towards the table), world space. */
  facing: Vec2;
  /** Three.js rotation.y for the chair mesh (its local +Z points along `facing`). */
  yaw: number;
  /** Which side of a rectangular table (0–3); −1 for round tables. */
  side: number;
}

interface LocalPose {
  local: Vec2;
  facing: Vec2;
  side: number;
}

/** Positions of each seat in the table's local frame, in seat-array order. */
export function localSeatLayout(f: Furniture, cfg: SeatingConfig): LocalPose[] {
  const n = f.seats?.length ?? 0;
  if (n === 0) return [];
  if (f.type === 'roundTable') {
    const r = f.width / 2 + cfg.chairOffset;
    const out: LocalPose[] = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / n;
      const p = v2(Math.cos(a) * r, Math.sin(a) * r);
      out.push({ local: p, facing: v2(-Math.cos(a), -Math.sin(a)), side: -1 });
    }
    return out;
  }
  const counts = sideCountsOf(f);
  const hw = f.width / 2;
  const hd = f.depth / 2;
  const off = cfg.chairOffset;
  const out: LocalPose[] = [];
  const along = (len: number, k: number, count: number) => -len / 2 + (len * (k + 0.5)) / count;
  // side 0: far edge (−Z), left → right
  for (let k = 0; k < counts[0]; k++) out.push({ local: v2(along(f.width, k, counts[0]), -(hd + off)), facing: v2(0, 1), side: 0 });
  // side 1: right edge (+X), far → near
  for (let k = 0; k < counts[1]; k++) out.push({ local: v2(hw + off, along(f.depth, k, counts[1])), facing: v2(-1, 0), side: 1 });
  // side 2: near edge (+Z), right → left
  for (let k = 0; k < counts[2]; k++) out.push({ local: v2(-along(f.width, k, counts[2]), hd + off), facing: v2(0, -1), side: 2 });
  // side 3: left edge (−X), near → far
  for (let k = 0; k < counts[3]; k++) out.push({ local: v2(-(hw + off), -along(f.depth, k, counts[3])), facing: v2(1, 0), side: 3 });
  return out.slice(0, n);
}

export function sideCountsOf(f: Furniture): [number, number, number, number] {
  if (f.sideCounts) return f.sideCounts;
  if (f.type === 'sweetheart') return [0, 0, f.seats?.length ?? 2, 0];
  const n = f.seats?.length ?? 0;
  const half = Math.ceil(n / 2);
  return [half, 0, n - half, 0];
}

/** World-space seat poses derived from canonical furniture + seating config. */
export function seatPoses(f: Furniture, cfg: SeatingConfig): SeatPose[] {
  const seats = f.seats ?? [];
  return localSeatLayout(f, cfg).map((lp, i) => {
    const facing = rotate(lp.facing, f.rotation);
    return {
      seatId: seats[i].id,
      index: i,
      position: localToWorld(f.position, f.rotation, lp.local),
      facing,
      yaw: yawFacing(facing),
      side: lp.side,
    };
  });
}

export function makeSeats(n: number): Seat[] {
  return Array.from({ length: n }, () => ({ id: newId('seat') }));
}

/**
 * Change the number of seats at a round (or otherwise single-run) table. Seats are kept in
 * order; extra seats are appended, removed seats come off the end. Returns the guest IDs that
 * were sitting in removed seats (they become unassigned — the guest records are untouched).
 */
export function resizeSeats(f: Furniture, n: number): string[] {
  const seats = f.seats ?? [];
  const removed: string[] = [];
  if (n < seats.length) {
    for (const s of seats.slice(n)) if (s.guestId) removed.push(s.guestId);
    f.seats = seats.slice(0, n);
  } else {
    f.seats = seats.concat(makeSeats(n - seats.length));
  }
  return removed;
}

/**
 * Apply new per-side counts to a rectangular table while keeping each existing guest on the
 * same side. Returns displaced guest IDs.
 */
export function applySideCounts(f: Furniture, counts: [number, number, number, number]): string[] {
  const old = sideCountsOf(f);
  const seats = f.seats ?? [];
  const removed: string[] = [];
  const next: Seat[] = [];
  let cursor = 0;
  for (let side = 0; side < 4; side++) {
    const slice = seats.slice(cursor, cursor + old[side]);
    cursor += old[side];
    if (counts[side] < slice.length) {
      for (const s of slice.slice(counts[side])) if (s.guestId) removed.push(s.guestId);
      next.push(...slice.slice(0, counts[side]));
    } else {
      next.push(...slice, ...makeSeats(counts[side] - slice.length));
    }
  }
  f.sideCounts = [...counts];
  f.seats = next;
  return removed;
}

/** Guest IDs that would lose their seat if the seat count were reduced as described. */
export function guestsDisplacedBy(f: Furniture, opts: { count?: number; sideCounts?: [number, number, number, number] }): string[] {
  const clone: Furniture = JSON.parse(JSON.stringify(f));
  if (opts.sideCounts) return applySideCounts(clone, opts.sideCounts);
  if (opts.count !== undefined) return resizeSeats(clone, opts.count);
  return [];
}

/** Perimeter available per seated guest (advisory). */
export function perimeterPerSeat(f: Furniture): number | null {
  const n = f.seats?.length ?? 0;
  if (!n) return null;
  if (f.type === 'roundTable') return (Math.PI * f.width) / n;
  const c = sideCountsOf(f);
  const per: number[] = [];
  if (c[0]) per.push(f.width / c[0]);
  if (c[2]) per.push(f.width / c[2]);
  if (c[1]) per.push(f.depth / c[1]);
  if (c[3]) per.push(f.depth / c[3]);
  return per.length ? Math.min(...per) : null;
}

/** Radius / half-extent that includes chairs, for occupied-footprint checks. */
export function chairReach(cfg: SeatingConfig): number {
  return cfg.chairOffset + cfg.chairDepth / 2;
}
