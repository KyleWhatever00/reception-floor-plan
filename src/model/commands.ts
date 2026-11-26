import type { Furniture, Guest, Layout, Seat } from './types';
import { newId } from './ids';
import { isGuestTable } from './catalog';
import { add, v2 } from './geometry';

/** Pure layout operations. The store wraps these with history and change notification. */

export function findFurniture(l: Layout, id: string | null | undefined): Furniture | undefined {
  return id ? l.furniture.find((f) => f.id === id) : undefined;
}

export function findSeat(l: Layout, seatId: string): { table: Furniture; seat: Seat; index: number } | undefined {
  for (const f of l.furniture) {
    const i = f.seats?.findIndex((s) => s.id === seatId) ?? -1;
    if (i >= 0) return { table: f, seat: f.seats![i], index: i };
  }
  return undefined;
}

export function seatOfGuest(l: Layout, guestId: string): { table: Furniture; seat: Seat; index: number } | undefined {
  for (const f of l.furniture) {
    const i = f.seats?.findIndex((s) => s.guestId === guestId) ?? -1;
    if (i >= 0) return { table: f, seat: f.seats![i], index: i };
  }
  return undefined;
}

export function guestById(l: Layout, id: string | undefined): Guest | undefined {
  return id ? l.guests.find((g) => g.id === id) : undefined;
}

export function nextTableNumber(l: Layout): number {
  const used = new Set(l.furniture.map((f) => f.number).filter((n): n is number => typeof n === 'number'));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** Give a freshly created item a sensible label/number for this layout. */
export function prepareNew(l: Layout, f: Furniture): Furniture {
  if (isGuestTable(f)) {
    f.number = nextTableNumber(l);
    f.label = `Table ${f.number}`;
  } else {
    const same = l.furniture.filter((o) => o.label === f.label || o.label.startsWith(f.label + ' ')).length;
    if (same > 0) f.label = `${f.label} ${same + 1}`;
  }
  return f;
}

export function addFurniture(l: Layout, f: Furniture): Furniture {
  l.furniture.push(f);
  return f;
}

/** Copy an item (without guest assignments), offset so it does not sit exactly on top. */
export function duplicateFurniture(l: Layout, id: string, offset = v2(0.6, 0.6)): Furniture | undefined {
  const src = findFurniture(l, id);
  if (!src) return undefined;
  const copy: Furniture = JSON.parse(JSON.stringify(src));
  copy.id = newId('f');
  copy.position = add(src.position, offset);
  copy.seats = src.seats?.map(() => ({ id: newId('seat') }));
  if (isGuestTable(copy)) {
    copy.number = nextTableNumber(l);
    copy.label = `Table ${copy.number}`;
  } else {
    copy.label = `${src.label.replace(/ copy( \d+)?$/, '')} copy`;
  }
  l.furniture.push(copy);
  return copy;
}

/** Remove an item. Guests seated there become unassigned (their records are kept). */
export function deleteFurniture(l: Layout, id: string): string[] {
  const f = findFurniture(l, id);
  if (!f) return [];
  const displaced = (f.seats ?? []).map((s) => s.guestId).filter((g): g is string => !!g);
  l.furniture = l.furniture.filter((x) => x.id !== id);
  return displaced;
}

export function addGuests(l: Layout, names: string[]): Guest[] {
  const created = names.map((n) => n.trim()).filter(Boolean).map((name) => ({ id: newId('g'), name: name.slice(0, 200) }));
  l.guests.push(...created);
  return created;
}

export function renameGuest(l: Layout, id: string, name: string): void {
  const g = guestById(l, id);
  if (g && name.trim()) g.name = name.trim().slice(0, 200);
}

export function unassignGuest(l: Layout, guestId: string): void {
  for (const f of l.furniture) for (const s of f.seats ?? []) if (s.guestId === guestId) delete s.guestId;
}

export function removeGuest(l: Layout, guestId: string): void {
  unassignGuest(l, guestId);
  l.guests = l.guests.filter((g) => g.id !== guestId);
}

/**
 * Seat a guest. Any previous seat of that guest is cleared (no duplicate assignments).
 * If the target seat is occupied by someone else, that person becomes unassigned and is returned.
 */
export function assignGuestToSeat(l: Layout, guestId: string, seatId: string): string | undefined {
  const target = findSeat(l, seatId);
  if (!target || !guestById(l, guestId)) return undefined;
  const bumped = target.seat.guestId && target.seat.guestId !== guestId ? target.seat.guestId : undefined;
  unassignGuest(l, guestId);
  target.seat.guestId = guestId;
  return bumped;
}

/** Seat a guest in the first free seat at a table. Returns false if the table is full. */
export function assignGuestToTable(l: Layout, guestId: string, tableId: string): boolean {
  const t = findFurniture(l, tableId);
  const current = seatOfGuest(l, guestId);
  if (current && current.table.id === tableId) return true;
  const free = t?.seats?.find((s) => !s.guestId);
  if (!free) return false;
  assignGuestToSeat(l, guestId, free.id);
  return true;
}

export function clearSeat(l: Layout, seatId: string): void {
  const s = findSeat(l, seatId);
  if (s) delete s.seat.guestId;
}

export interface SeatStats {
  seats: number;
  assigned: number;
  guests: number;
  unassigned: number;
  tables: number;
}

export function seatStats(l: Layout): SeatStats {
  let seats = 0, assigned = 0, tables = 0;
  for (const f of l.furniture) {
    if (!f.seats?.length) continue;
    tables++;
    seats += f.seats.length;
    for (const s of f.seats) if (s.guestId) assigned++;
  }
  return { seats, assigned, guests: l.guests.length, unassigned: l.guests.length - assigned, tables };
}

export function unassignedGuests(l: Layout): Guest[] {
  const seated = new Set<string>();
  for (const f of l.furniture) for (const s of f.seats ?? []) if (s.guestId) seated.add(s.guestId);
  return l.guests.filter((g) => !seated.has(g.id));
}

export function tablesWithSeats(l: Layout): Furniture[] {
  return l.furniture
    .filter((f) => f.seats?.length)
    .sort((a, b) => (a.number ?? 9999) - (b.number ?? 9999) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}
