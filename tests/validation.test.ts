import { describe, expect, it } from 'vitest';
import { demoProject, demoRoom } from '../src/model/demo';
import { validateProject, validateRoom } from '../src/model/validation';
import { buildProjectFile, parseProjectFile, serializeProjectFile, stripGuests, seatingCsv, guestNamesFromCsv, parseCsv, reidentifyLayout } from '../src/model/serialization';
import { newId } from '../src/model/ids';
import { analyzeLayout } from '../src/model/warnings';

describe('room validation', () => {
  it('accepts the concave demo room', () => {
    expect(validateRoom(demoRoom())).toEqual([]);
  });
  it('rejects too few vertices, self-intersection and non-finite coordinates', () => {
    const r = demoRoom();
    expect(validateRoom({ ...r, vertices: r.vertices.slice(0, 2) })[0]).toMatch(/at least 3/);
    const bow = [{ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 10, z: 0 }, { x: 0, z: 10 }];
    expect(validateRoom({ ...r, vertices: bow, openings: [] }).join()).toMatch(/crosses itself/);
    expect(validateRoom({ ...r, vertices: [{ x: 0, z: 0 }, { x: NaN, z: 1 }, { x: 1, z: 1 }] }).join()).toMatch(/finite/);
  });
  it('rejects openings that do not fit their wall', () => {
    const r = demoRoom();
    r.openings[0].offset = 1000;
    expect(validateRoom(r).join()).toMatch(/does not fit/);
  });
});

describe('project validation and serialization', () => {
  it('round-trips a project through export/import with identical geometry and assignments', () => {
    const p = demoProject();
    const text = serializeProjectFile(buildProjectFile(p, 'project'));
    const parsed = parseProjectFile(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual(p);
  });
  it('privacy export contains no guest identities', () => {
    const p = demoProject();
    const names = p.layouts[0].guests.map((g) => g.name);
    const text = serializeProjectFile(buildProjectFile(p, 'layout-only'));
    for (const n of names) expect(text).not.toContain(n);
    expect(text).not.toContain('guestId');
    expect(stripGuests(p).layouts[0].guests).toEqual([]);
    expect(p.layouts[0].guests.length).toBeGreaterThan(0); // original untouched
  });
  it('rejects malformed JSON and newer schema versions without throwing', () => {
    expect(parseProjectFile('{nope').ok).toBe(false);
    const p = demoProject();
    p.schemaVersion = 99;
    expect(validateProject(p).errors.join()).toMatch(/newer version/);
  });
  it('rejects duplicate IDs and dangling guest references', () => {
    const p = demoProject();
    const l = p.layouts[0];
    l.furniture[1].id = l.furniture[0].id;
    expect(validateProject(p).errors.join()).toMatch(/duplicate furniture ID/);
    const p2 = demoProject();
    const t = p2.layouts[0].furniture.find((f) => f.seats?.length)!;
    t.seats![0].guestId = 'missing';
    expect(validateProject(p2).errors.join()).toMatch(/not in the guest list/);
    const p3 = demoProject();
    const seats = p3.layouts[0].furniture.flatMap((f) => f.seats ?? []);
    seats[seats.length - 1].guestId = seats.find((x) => x.guestId)!.guestId;
    expect(validateProject(p3).errors.join()).toMatch(/more than one seat/);
  });
  it('rejects out-of-range numbers', () => {
    const p = demoProject();
    p.layouts[0].furniture[0].width = -1;
    expect(validateProject(p).ok).toBe(false);
    const p2 = demoProject();
    (p2.layouts[0].furniture[0].position as any).x = 'far';
    expect(validateProject(p2).ok).toBe(false);
  });
  it('fills in missing settings with defaults', () => {
    const p: any = demoProject();
    delete p.settings;
    const v = validateProject(p);
    expect(v.ok).toBe(true);
    expect(v.value!.settings.snapInches).toBe(6);
  });
  it('reidentified layouts keep assignments but share no IDs', () => {
    const p = demoProject();
    const l = p.layouts[0];
    const r = reidentifyLayout(l, newId);
    const ids = new Set([l.id, ...l.furniture.map((f) => f.id), ...l.guests.map((g) => g.id)]);
    expect(ids.has(r.id)).toBe(false);
    for (const f of r.furniture) expect(ids.has(f.id)).toBe(false);
    const assigned = (x: typeof l) => x.furniture.flatMap((f) => f.seats ?? []).filter((s) => s.guestId).length;
    expect(assigned(r)).toBe(assigned(l));
    const pr = { ...p, layouts: [l, r] };
    expect(validateProject(pr).ok).toBe(true);
  });
});

describe('CSV', () => {
  it('exports a table-by-table seating list', () => {
    const p = demoProject();
    const csv = seatingCsv(p.layouts[0]);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(['Table', 'Table number', 'Seat', 'Guest']);
    expect(rows.some((r) => r[0] === '(unassigned)')).toBe(true);
  });
  it('parses quoted fields and guest name columns', () => {
    expect(parseCsv('a,"b, c",d\n"x ""y""",z\n')).toEqual([['a', 'b, c', 'd'], ['x "y"', 'z']]);
    expect(guestNamesFromCsv('Name,Email\nAvery,a@x\n"Smith, Jo",b@x\n')).toEqual(['Avery', 'Smith, Jo']);
    expect(guestNamesFromCsv('First Name,Last Name\nAvery,Lee\n')).toEqual(['Avery Lee']);
    expect(guestNamesFromCsv('Avery\nJordan\n')).toEqual(['Avery', 'Jordan']);
  });
});

describe('demo layout', () => {
  it('has no hard warnings (overlaps, blocked doors, walls)', () => {
    const p = demoProject();
    const a = analyzeLayout(p.layouts[0], p.settings);
    const hard = a.warnings.filter((w) => w.severity === 'warning');
    expect(hard.map((w) => w.message)).toEqual([]);
  });
});
