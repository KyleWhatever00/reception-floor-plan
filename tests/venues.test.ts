import { describe, expect, it } from 'vitest';
import { vintageVillasRoomEstimate, vintageVillasStarterLayout } from '../src/model/venues';
import { validateRoom, validateProject } from '../src/model/validation';
import { polygonArea } from '../src/model/geometry';
import { ft } from '../src/model/units';
import { analyzeLayout } from '../src/model/warnings';
import { DEFAULT_SETTINGS } from '../src/model/demo';
import { buildColliders, findFreeSpot, isFree } from '../src/walkthrough/collision';
import { SCHEMA_VERSION } from '../src/model/types';
import { buildProjectFile, serializeProjectFile, parseProjectFile } from '../src/model/serialization';

describe('Vintage Villas Event Center estimate', () => {
  it('is a valid room of about 4,800 sq ft, marked as estimated', () => {
    const r = vintageVillasRoomEstimate();
    expect(validateRoom(r)).toEqual([]);
    expect(polygonArea(r.vertices) / (ft(1) * ft(1))).toBeCloseTo(4800, 0);
    expect(r.dimensionStatus).toBe('estimated');
  });
  it('starter layout has no hard warnings and a free entrance', () => {
    const l = vintageVillasStarterLayout();
    const a = analyzeLayout(l, DEFAULT_SETTINGS);
    expect(a.warnings.filter((w) => w.severity === 'warning').map((w) => w.message)).toEqual([]);
    const cs = buildColliders(l);
    expect(isFree(l.room.spawn, 0.25, cs)).toBe(true);
    const p = findFreeSpot(l.room.spawn, 0.25, cs, l.room.vertices);
    expect(p).toEqual(l.room.spawn);
  });
  it('round-trips through export/import with all architectural features', () => {
    const l = vintageVillasStarterLayout();
    const project = { schemaVersion: SCHEMA_VERSION, activeLayoutId: l.id, layouts: [l], settings: { ...DEFAULT_SETTINGS } };
    expect(validateProject(project).ok).toBe(true);
    const parsed = parseProjectFile(serializeProjectFile(buildProjectFile(project, 'project')));
    expect(parsed.ok).toBe(true);
    expect(parsed.value!.layouts[0].room).toEqual(l.room);
  });
});
