import { describe, expect, it } from 'vitest';
import { Store } from '../src/model/store';
import { demoProject, blankLayout } from '../src/model/demo';
import { addGuests, assignGuestToSeat, assignGuestToTable, deleteFurniture, duplicateFurniture, removeGuest, seatStats, unassignedGuests } from '../src/model/commands';
import { resizeSeats } from '../src/model/seats';

describe('store history', () => {
  it('groups a drag into one undo step and undo/redo restore it', () => {
    const s = new Store(demoProject());
    const f = s.layout.furniture[0];
    const x0 = f.position.x;
    s.beginGesture();
    for (let i = 1; i <= 10; i++) s.applyTransient((l) => (l.furniture[0].position.x = x0 + i * 0.1));
    s.endGesture('Move');
    expect(s.canUndo).toBe(true);
    s.undo();
    expect(s.layout.furniture[0].position.x).toBeCloseTo(x0);
    expect(s.canUndo).toBe(false);
    s.redo();
    expect(s.layout.furniture[0].position.x).toBeCloseTo(x0 + 1);
  });
  it('cancelled gestures restore the original state', () => {
    const s = new Store(demoProject());
    const x0 = s.layout.furniture[0].position.x;
    s.applyTransient((l) => (l.furniture[0].position.x += 5));
    s.cancelGesture();
    expect(s.layout.furniture[0].position.x).toBeCloseTo(x0);
    expect(s.canUndo).toBe(false);
  });
  it('switching variants does not cross-contaminate layouts or history', () => {
    const s = new Store(demoProject());
    const a = s.layout;
    s.apply('Move', (l) => (l.furniture[0].position.x += 1));
    const b = blankLayout('B', a.room);
    s.addLayout(b);
    expect(s.layout.id).toBe(b.id);
    expect(s.canUndo).toBe(false);
    s.apply('Add guests', (l) => addGuests(l, ['Only In B']));
    s.switchLayout(a.id);
    expect(s.layout.guests.some((g) => g.name === 'Only In B')).toBe(false);
    expect(s.canUndo).toBe(true);
  });
});

describe('guest assignment', () => {
  it('prevents duplicate assignments and keeps records when seats or tables go away', () => {
    const s = new Store(demoProject());
    const l = s.layout;
    const [g] = addGuests(l, ['Test Guest']);
    const tables = l.furniture.filter((f) => f.seats?.length);
    const empty = tables.find((t) => t.seats!.every((x) => !x.guestId))!;
    assignGuestToSeat(l, g.id, empty.seats![0].id);
    assignGuestToSeat(l, g.id, empty.seats![1].id);
    const seatsWithG = l.furniture.flatMap((f) => f.seats ?? []).filter((x) => x.guestId === g.id);
    expect(seatsWithG).toHaveLength(1);
    resizeSeats(empty, 1);
    expect(unassignedGuests(l).some((u) => u.id === g.id)).toBe(true);
    expect(l.guests.some((x) => x.id === g.id)).toBe(true);
    assignGuestToTable(l, g.id, empty.id);
    deleteFurniture(l, empty.id);
    expect(l.guests.some((x) => x.id === g.id)).toBe(true);
    expect(unassignedGuests(l).some((u) => u.id === g.id)).toBe(true);
  });
  it('bumping a seated guest returns them to the unassigned pool', () => {
    const s = new Store(demoProject());
    const l = s.layout;
    const t = l.furniture.find((f) => f.seats?.[0]?.guestId)!;
    const occupant = t.seats![0].guestId!;
    const [g] = addGuests(l, ['Newcomer']);
    const bumped = assignGuestToSeat(l, g.id, t.seats![0].id);
    expect(bumped).toBe(occupant);
    expect(unassignedGuests(l).some((u) => u.id === occupant)).toBe(true);
  });
  it('duplicates tables without guests and removes guests cleanly', () => {
    const s = new Store(demoProject());
    const l = s.layout;
    const t = l.furniture.find((f) => f.seats?.[0]?.guestId)!;
    const before = seatStats(l);
    const copy = duplicateFurniture(l, t.id)!;
    expect(copy.seats!.every((x) => !x.guestId)).toBe(true);
    expect(copy.label).not.toBe(t.label);
    expect(seatStats(l).seats).toBe(before.seats + t.seats!.length);
    const gid = t.seats![0].guestId!;
    removeGuest(l, gid);
    expect(t.seats![0].guestId).toBeUndefined();
  });
});
