import { describe, expect, it } from 'vitest';
import { vintageVillasRoomEstimate } from '../src/model/venues';
import { ceilingAt, chandelierHangHeight, newCeilingZone, newChandelier, overlappingZones, ridgeLeftRight, setRidge, setZoneExtents, zoneExtents, zoneHeightAt } from '../src/model/ceilings';
import { polygonArea, subtractConvex, rectCorners } from '../src/model/geometry';
import { ft } from '../src/model/units';
import { validateProject } from '../src/model/validation';

describe('ceiling areas', () => {
  it('reads the vaulted and flat heights of the estimated Event Center', () => {
    const r = vintageVillasRoomEstimate();
    const [vault, flat] = r.features!.ceilings!;
    // ridge of the vault is along its centre line; the sides are at 14 ft
    expect(ceilingAt(r, vault.center)).toBeCloseTo(ft(23));
    expect(zoneHeightAt(vault, { x: vault.center.x, z: vault.center.z - vault.depth / 2 })).toBeCloseTo(ft(14));
    expect(ceilingAt(r, flat.center)).toBeCloseTo(ft(11));
    expect(overlappingZones(r)).toEqual([]);
  });
  it('falls back to the wall height outside every area', () => {
    const r = vintageVillasRoomEstimate();
    r.features!.ceilings = [];
    expect(ceilingAt(r, { x: 0, z: 0 })).toBeCloseTo(r.wallHeight);
  });
  it('turns the ridge without changing the covered area', () => {
    const r = vintageVillasRoomEstimate();
    const z = r.features!.ceilings![0];
    const before = zoneExtents(z);
    expect(ridgeLeftRight(z)).toBe(true);
    setRidge(z, false);
    expect(ridgeLeftRight(z)).toBe(false);
    expect(zoneExtents(z).sx).toBeCloseTo(before.sx);
    expect(zoneExtents(z).sz).toBeCloseTo(before.sz);
    setZoneExtents(z, ft(40), ft(20));
    expect(zoneExtents(z)).toEqual({ sx: ft(40), sz: ft(20) });
  });
  it('detects overlapping areas but not ones that only touch', () => {
    const r = vintageVillasRoomEstimate();
    expect(overlappingZones(r)).toHaveLength(0);
    r.features!.ceilings![1].center.z -= ft(4);
    expect(overlappingZones(r)).toHaveLength(1);
  });
  it('new areas stay inside the room and pass validation', () => {
    const r = vintageVillasRoomEstimate();
    for (const kind of ['flat', 'vaulted'] as const) {
      const z = newCeilingZone(r, kind, { x: 1000, z: 1000 });
      const c = rectCorners(z.center, z.width, z.depth, z.rotation);
      for (const p of c) {
        expect(Math.abs(p.x)).toBeLessThanOrEqual(ft(48) + 1e-6);
        expect(Math.abs(p.z)).toBeLessThanOrEqual(ft(25) + 1e-6);
      }
      if (kind === 'vaulted') expect(z.peakHeight!).toBeGreaterThan(z.height);
      else expect(z.height).toBeLessThan(r.wallHeight);
      r.features!.ceilings!.push(z);
    }
    const project = { schemaVersion: 1, activeLayoutId: 'l', settings: {}, layouts: [{ id: 'l', name: 'x', room: r, furniture: [], guests: [] }] };
    const res = validateProject(project as any);
    expect(res.errors).toEqual([]);
    // new areas survive a save/load round trip
    expect(res.value!.layouts[0].room.features!.ceilings).toHaveLength(4);
  });
});

describe('chandeliers', () => {
  it('hangs a new chandelier to suit the ceiling above it', () => {
    const r = vintageVillasRoomEstimate();
    const [vault, flat] = r.features!.ceilings!;
    const iron = newChandelier(r, 'iron-chandelier', vault.center);
    expect(iron.height).toBeCloseTo(ft(12));
    const crystal = newChandelier(r, 'crystal-chandelier', flat.center);
    expect(crystal.height).toBeCloseTo(ft(9.6));
  });
  it('never hangs through a lowered ceiling', () => {
    const r = vintageVillasRoomEstimate();
    const flat = r.features!.ceilings![1];
    const crystal = r.features!.fixtures!.find((f) => f.kind === 'crystal-chandelier')!;
    expect(chandelierHangHeight(r, crystal)).toBeCloseTo(crystal.height);
    flat.height = ft(9);
    expect(chandelierHangHeight(r, crystal)).toBeLessThan(ft(9));
  });
});

describe('subtractConvex', () => {
  it('cuts a rectangle out of an L-shaped room', () => {
    const L = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 4 }, { x: 4, z: 4 }, { x: 4, z: 10 }, { x: 0, z: 10 }];
    const pieces = subtractConvex(L, rectCorners({ x: 2, z: 2 }, 4, 4, 0));
    const area = pieces.reduce((s, p) => s + polygonArea(p), 0);
    expect(area).toBeCloseTo(polygonArea(L) - 16);
  });
  it('covering everything leaves nothing', () => {
    const sq = [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }];
    expect(subtractConvex(sq, rectCorners({ x: 2, z: 2 }, 6, 6, 0.3))).toEqual([]);
  });
});

import { newSconce, pointOnWall, sconcePlacement } from '../src/model/ceilings';
import { wallLength } from '../src/model/geometry';
describe('wall lights', () => {
  it('adds a light on the wall nearest the view, clear of doors, windows and other lights', () => {
    let r = vintageVillasRoomEstimate();
    const fixtures = r.features!.fixtures!;
    for (let k = 0; k < 8; k++) {
      // near the French-door wall (wall 1, z = -25 ft)
      const f = newSconce(r, { x: 0, z: -ft(23) });
      const { wall, along } = sconcePlacement(r, f);
      expect(wall).toBe(0);
      for (const o of r.openings.filter((x) => x.wallIndex === wall)) expect(along > o.offset - 0.2 && along < o.offset + o.width + 0.2).toBe(false);
      for (const s of fixtures.filter((x) => x.kind === 'sconce')) expect(Math.hypot(s.position.x - f.position.x, s.position.z - f.position.z)).toBeGreaterThanOrEqual(ft(3) - 1e-9);
      expect(f.height).toBeCloseTo(ft(7.5));
      fixtures.push(f);
    }
  });
  it('places and reads back positions along a wall', () => {
    const r = vintageVillasRoomEstimate();
    const p = pointOnWall(r, 1, ft(10));
    const f = { id: 'x', kind: 'sconce' as const, position: p, height: ft(8), size: ft(1) };
    expect(sconcePlacement(r, f).wall).toBe(1);
    expect(sconcePlacement(r, f).along).toBeCloseTo(ft(10));
    // clamped inside a short wall
    expect(sconcePlacement(r, { ...f, position: pointOnWall(r, 1, ft(500)) }).along).toBeLessThan(wallLength(r.vertices, 1));
  });
});
