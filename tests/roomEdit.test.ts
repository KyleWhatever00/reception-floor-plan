import { describe, expect, it } from 'vitest';
import { demoRoom } from '../src/model/demo';
import { insertVertexAfter, removeVertex, moveVertex, parseOutline, rectangleRoom } from '../src/model/roomEdit';
import { validateRoom } from '../src/model/validation';
import { ft } from '../src/model/units';
import { wallLength, isConvexCorner } from '../src/model/geometry';

describe('room editing', () => {
  it('splitting a wall keeps openings on the correct half', () => {
    const r = demoRoom();
    const door = r.openings.find((o) => o.wallIndex === 4)!; // main door on wall 4 at 26 ft of 64 ft
    const { room, dropped } = insertVertexAfter(r, 4);
    expect(room.vertices).toHaveLength(r.vertices.length + 1);
    const moved = room.openings.find((o) => o.id === door.id);
    // wall is 64 ft; the 6 ft door at 26–32 ft sits entirely in the first half
    expect(moved?.wallIndex).toBe(4);
    expect(dropped).toBe(0);
    // windows on wall 5 (old) are now on wall 6
    expect(room.openings.filter((o) => o.wallIndex === 6).length).toBe(r.openings.filter((o) => o.wallIndex === 5).length);
    expect(validateRoom(room)).toEqual([]);
  });
  it('removing a corner drops openings on the removed wall and renumbers the rest', () => {
    const r = demoRoom();
    const { room, dropped } = removeVertex(r, 4); // merges walls 3 and 4, removes 4
    expect(room.vertices).toHaveLength(5);
    expect(dropped).toBeGreaterThan(0);
    for (const o of room.openings) expect(o.offset + o.width).toBeLessThanOrEqual(wallLength(room.vertices, o.wallIndex) + 1e-9);
  });
  it('moving a corner clamps openings to fit', () => {
    const r = demoRoom();
    const moved = moveVertex(r, 1, { x: r.vertices[1].x - ft(40), z: r.vertices[1].z });
    expect(validateRoom(moved)).toEqual([]);
  });
  it('parses pasted coordinates in feet and other units', () => {
    const { vertices, errors } = parseOutline("0, 0\n80, 0\n80' 6\", 50\n0, 15.24 m\n");
    expect(errors).toEqual([]);
    expect(vertices[2].x).toBeCloseTo(ft(80.5));
    expect(vertices[3].z).toBeCloseTo(15.24);
    expect(parseOutline('1, 2, 3').errors.length).toBe(1);
  });
  it('makes a valid rectangle', () => {
    const r = rectangleRoom(demoRoom(), ft(60), ft(40));
    expect(validateRoom(r)).toEqual([]);
  });
  it('detects convex and reflex corners of the L-shaped demo room', () => {
    const r = demoRoom();
    expect(r.vertices.map((_, i) => isConvexCorner(r.vertices, i))).toEqual([true, true, true, false, true, true]);
  });
});

import { vintageVillasRoomEstimate } from '../src/model/venues';
describe('room edits keep pilasters on their walls', () => {
  it('shifts pilasters when corners are added or removed', () => {
    const r = vintageVillasRoomEstimate();
    const before = r.features!.pilasters!.map((p) => p.wallIndex);
    expect(before.every((w) => w === 3)).toBe(true);
    const ins = insertVertexAfter(r, 0).room;
    expect(ins.features!.pilasters!.every((p) => p.wallIndex === 4)).toBe(true);
    const rem = removeVertex(ins, 1).room;
    expect(rem.features!.pilasters!.every((p) => p.wallIndex === 3)).toBe(true);
    expect(validateRoom(rem)).toEqual([]);
  });
});

import { keepsWinding, moveWall, nearestWall } from '../src/model/roomEdit';
import { lerp2 } from '../src/model/geometry';
describe('moving whole walls', () => {
  const centre = (r: ReturnType<typeof vintageVillasRoomEstimate>, id: string) => {
    const o = r.openings.find((x) => x.id === id)!;
    const a = r.vertices[o.wallIndex], b = r.vertices[(o.wallIndex + 1) % r.vertices.length];
    return lerp2(a, b, (o.offset + o.width / 2) / wallLength(r.vertices, o.wallIndex));
  };
  it('slides a wall outward, stretching its neighbours and keeping doors/windows in place', () => {
    const r = vintageVillasRoomEstimate();
    // wall 3 (index 2) is the patio side; move it 2 ft outward
    const moved = moveWall(r, 2, ft(2));
    expect(validateRoom(moved)).toEqual([]);
    expect(wallLength(moved.vertices, 1)).toBeCloseTo(wallLength(r.vertices, 1) + ft(2));
    expect(wallLength(moved.vertices, 3)).toBeCloseTo(wallLength(r.vertices, 3) + ft(2));
    expect(moved.openings).toHaveLength(r.openings.length);
    // the entrance door on wall 4 (index 3) starts at the moved corner but stays put in the room
    const door = r.openings.find((o) => o.wallIndex === 3 && o.kind === 'door')!;
    const before = centre(r, door.id), after = centre(moved, door.id);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.z).toBeCloseTo(before.z);
    // patio windows move with their wall
    const win = r.openings.find((o) => o.wallIndex === 2)!;
    expect(centre(moved, win.id).z).toBeCloseTo(centre(r, win.id).z + ft(2));
    // pilasters on wall 4 keep their room position too
    const p0 = r.features!.pilasters![0], p1 = moved.features!.pilasters![0];
    expect(p1.offset).toBeCloseTo(p0.offset + ft(2)); // wall 4 starts at the moved corner, so it grew at its start
  });
  it('stretches the ceiling zone whose edge was on the wall', () => {
    const r = vintageVillasRoomEstimate();
    const flat = r.features!.ceilings!.find((c) => c.kind === 'flat')!;
    const vault = r.features!.ceilings!.find((c) => c.kind === 'vaulted')!;
    const moved = moveWall(r, 2, ft(3));
    const f2 = moved.features!.ceilings!.find((c) => c.id === flat.id)!;
    const v2 = moved.features!.ceilings!.find((c) => c.id === vault.id)!;
    expect(f2.depth).toBeCloseTo(flat.depth + ft(3));
    expect(f2.center.z).toBeCloseTo(flat.center.z + ft(1.5));
    expect(v2.depth).toBeCloseTo(vault.depth);
    // moving the lake end (wall 2, index 1) in stretches/shrinks both zones' widths
    const shorter = moveWall(r, 1, -ft(4));
    for (const c of shorter.features!.ceilings!) expect(c.width).toBeCloseTo(r.features!.ceilings!.find((x) => x.id === c.id)!.width - ft(4));
  });
  it('refuses to move a wall past the opposite side (room turned inside out)', () => {
    const r = rectangleRoom(demoRoom(), ft(20), ft(20));
    expect(keepsWinding(r, moveWall(r, 0, -ft(10)))).toBe(true);
    expect(keepsWinding(r, moveWall(r, 0, -ft(25)))).toBe(false);
  });
  it('finds the nearest wall and the distance along it', () => {
    const r = rectangleRoom(demoRoom(), ft(20), ft(10));
    const near = nearestWall(r.vertices, { x: r.vertices[0].x + ft(5), z: r.vertices[0].z + 0.1 });
    expect(near.index).toBe(0);
    expect(near.along).toBeCloseTo(ft(5));
  });
});

import { addPilaster } from '../src/model/roomEdit';
describe('adding stone pilasters', () => {
  const overlaps = (a: { offset: number; width: number }, b: { offset: number; width: number }) => a.offset < b.offset + b.width - 1e-9 && b.offset < a.offset + a.width - 1e-9;
  it('puts a new pilaster on the longest wall without covering doors, windows or other pilasters', () => {
    let r = vintageVillasRoomEstimate();
    const before = r.features!.pilasters!.length;
    for (let k = 0; k < 6; k++) {
      const res = addPilaster(r);
      r = res.room;
      const p = res.pilaster;
      expect(p.material).toBe('stone');
      expect(p.width).toBeCloseTo(ft(3));
      expect(p.offset + p.width).toBeLessThanOrEqual(wallLength(r.vertices, p.wallIndex) + 1e-9);
      for (const o of r.openings.filter((x) => x.wallIndex === p.wallIndex)) expect(overlaps(p, o)).toBe(false);
      for (const q of r.features!.pilasters!.filter((x) => x.wallIndex === p.wallIndex && x.id !== p.id)) expect(overlaps(p, q)).toBe(false);
    }
    expect(r.features!.pilasters!.length).toBe(before + 6);
    expect(validateRoom(r)).toEqual([]);
  });
  it('works on a room with no features yet', () => {
    const r = rectangleRoom(demoRoom(), ft(20), ft(10));
    delete r.features;
    const { room, pilaster } = addPilaster(r);
    expect(room.features!.pilasters).toEqual([pilaster]);
    expect(pilaster.wallIndex === 0 || pilaster.wallIndex === 2).toBe(true);
  });
});
