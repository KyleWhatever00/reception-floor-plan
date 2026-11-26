import { describe, expect, it } from 'vitest';
import { demoLayout } from '../src/model/demo';
import { buildColliders, findFreeSpot, isFree, moveWithCollisions, wallPieces } from '../src/walkthrough/collision';
import { pointInPolygon } from '../src/model/geometry';
import { paletteItem } from '../src/model/catalog';

describe('walkthrough collisions', () => {
  const layout = demoLayout();
  const cs = buildColliders(layout);
  const r = 0.25;

  it('splits walls at doors but not at windows', () => {
    const pieces = wallPieces(layout.room.vertices, layout.room.openings);
    const doors = layout.room.openings.filter((o) => o.kind === 'door').length;
    expect(pieces.length).toBe(layout.room.vertices.length + doors);
  });

  it('walls block movement', () => {
    const start = { x: 0, z: 0 };
    // walk 100 m in -Z: must stop inside the room
    let p = start;
    for (let i = 0; i < 200; i++) p = moveWithCollisions(p, { x: 0, z: -0.5 }, r, cs);
    expect(pointInPolygon(p, layout.room.vertices)).toBe(true);
  });

  it('the dance floor is walkable', () => {
    const floor = layout.furniture.find((f) => f.type === 'danceFloor')!;
    expect(isFree(floor.position, r, cs)).toBe(true);
  });

  it('tables and chairs are solid', () => {
    const t = layout.furniture.find((f) => f.type === 'roundTable')!;
    expect(isFree(t.position, r, cs)).toBe(false);
  });

  it('the main door is traversable', () => {
    const spawn = findFreeSpot(layout.room.spawn, r, cs, layout.room.vertices);
    // walk straight out (+Z) through the door in the bottom wall
    let p = spawn;
    for (let i = 0; i < 60; i++) p = moveWithCollisions(p, { x: 0, z: 0.25 }, r, cs);
    expect(pointInPolygon(p, layout.room.vertices)).toBe(false);
  });

  it('frame-rate independence: one big step equals many small steps in open space', () => {
    const open = { x: 0, z: 0 };
    const big = moveWithCollisions(open, { x: 0.8, z: 0 }, r, []);
    let small = open;
    for (let i = 0; i < 8; i++) small = moveWithCollisions(small, { x: 0.1, z: 0 }, r, []);
    expect(big.x).toBeCloseTo(small.x, 9);
  });

  it('finds a free spawn when the entrance is blocked', () => {
    const l2 = demoLayout();
    const blocker = paletteItem('round72')!.create({ ...l2.room.spawn });
    l2.furniture.push(blocker);
    const cs2 = buildColliders(l2);
    expect(isFree(l2.room.spawn, r, cs2)).toBe(false);
    const p = findFreeSpot(l2.room.spawn, r, cs2, l2.room.vertices);
    expect(isFree(p, r, cs2)).toBe(true);
    expect(pointInPolygon(p, l2.room.vertices)).toBe(true);
  });
});
