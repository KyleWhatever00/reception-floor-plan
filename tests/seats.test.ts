import { describe, expect, it } from 'vitest';
import { paletteItem, DEFAULT_SEATING } from '../src/model/catalog';
import { applySideCounts, resizeSeats, seatPoses, perimeterPerSeat, guestsDisplacedBy } from '../src/model/seats';
import { inch } from '../src/model/units';
import { dist } from '../src/model/geometry';

const cfg = DEFAULT_SEATING;

describe('seat geometry', () => {
  it('a 60-inch round table is 1.524 m in diameter with 8 evenly spaced inward-facing chairs', () => {
    const t = paletteItem('round60')!.create({ x: 2, z: -3 });
    expect(t.width).toBeCloseTo(1.524, 6);
    expect(t.depth).toBeCloseTo(1.524, 6);
    const poses = seatPoses(t, cfg);
    expect(poses).toHaveLength(8);
    const r = 1.524 / 2 + cfg.chairOffset;
    for (const p of poses) {
      expect(dist(p.position, t.position)).toBeCloseTo(r, 6);
      // facing points from chair to table centre
      const toCenter = { x: t.position.x - p.position.x, z: t.position.z - p.position.z };
      const l = Math.hypot(toCenter.x, toCenter.z);
      expect(p.facing.x).toBeCloseTo(toCenter.x / l, 6);
      expect(p.facing.z).toBeCloseTo(toCenter.z / l, 6);
      // yaw rotates local +Z onto facing
      expect(Math.sin(p.yaw)).toBeCloseTo(p.facing.x, 6);
      expect(Math.cos(p.yaw)).toBeCloseTo(p.facing.z, 6);
    }
    for (let i = 0; i < 8; i++) {
      const d = dist(poses[i].position, poses[(i + 1) % 8].position);
      expect(d).toBeCloseTo(2 * r * Math.sin(Math.PI / 8), 6);
    }
  });

  it('moving and rotating a table carries its chairs along', () => {
    const t = paletteItem('rect8')!.create({ x: 0, z: 0 });
    const before = seatPoses(t, cfg);
    t.position = { x: 5, z: 1 };
    t.rotation = Math.PI / 2;
    const after = seatPoses(t, cfg);
    expect(after.map((s) => s.seatId)).toEqual(before.map((s) => s.seatId));
    for (let i = 0; i < before.length; i++) {
      expect(dist(after[i].position, t.position)).toBeCloseTo(dist(before[i].position, { x: 0, z: 0 }), 6);
    }
  });

  it('rectangular seats sit along the requested sides', () => {
    const t = paletteItem('rect6')!.create({ x: 0, z: 0 });
    const poses = seatPoses(t, cfg);
    expect(poses.filter((p) => p.side === 0)).toHaveLength(3);
    expect(poses.filter((p) => p.side === 2)).toHaveLength(3);
    for (const p of poses.filter((p) => p.side === 0)) expect(p.position.z).toBeCloseTo(-(t.depth / 2 + cfg.chairOffset));
    applySideCounts(t, [3, 1, 3, 1]);
    expect(seatPoses(t, cfg)).toHaveLength(8);
  });

  it('reducing seats returns displaced guests and keeps seat IDs stable', () => {
    const t = paletteItem('round60')!.create({ x: 0, z: 0 });
    const ids = t.seats!.map((s) => s.id);
    t.seats![7].guestId = 'g7';
    t.seats![2].guestId = 'g2';
    expect(guestsDisplacedBy(t, { count: 6 })).toEqual(['g7']);
    expect(t.seats).toHaveLength(8); // preview does not mutate
    const removed = resizeSeats(t, 6);
    expect(removed).toEqual(['g7']);
    expect(t.seats!.map((s) => s.id)).toEqual(ids.slice(0, 6));
    expect(t.seats![2].guestId).toBe('g2');
    resizeSeats(t, 10);
    expect(t.seats!.slice(0, 6).map((s) => s.id)).toEqual(ids.slice(0, 6));
  });

  it('side-count changes keep guests on their side', () => {
    const t = paletteItem('rect8')!.create({ x: 0, z: 0 });
    t.seats![5].guestId = 'near-side-guest'; // side 2, second seat
    applySideCounts(t, [2, 1, 4, 1]);
    const poses = seatPoses(t, cfg);
    const idx = t.seats!.findIndex((s) => s.guestId === 'near-side-guest');
    expect(poses[idx].side).toBe(2);
  });

  it('computes perimeter per guest', () => {
    const t = paletteItem('round60')!.create({ x: 0, z: 0 });
    expect(perimeterPerSeat(t)! / inch(1)).toBeCloseTo((Math.PI * 60) / 8, 4);
  });
});
