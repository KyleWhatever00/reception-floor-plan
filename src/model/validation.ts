import type { Furniture, FurnitureType, Layout, Opening, Project, Room, RoomFeatures, Settings } from './types';
import { SCHEMA_VERSION } from './types';
import { isSelfIntersecting, polygonArea, wallLength } from './geometry';
import { BOUNDS, DEFAULT_SEATING } from './catalog';
import { DEFAULT_SETTINGS } from './demo';
import { sideCountsOf } from './seats';

const TYPES: FurnitureType[] = ['roundTable', 'rectTable', 'sweetheart', 'cake', 'danceFloor', 'dj', 'bar', 'buffet', 'gift', 'welcome', 'decoration'];

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  errors: string[];
  warnings: string[];
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec = (v: unknown): boolean => isObj(v) && finite(v.x) && finite(v.z) && Math.abs(v.x) <= BOUNDS.maxCoord && Math.abs(v.z) <= BOUNDS.maxCoord;

/** Errors in a room outline / openings. Empty array means valid. */
export function validateRoom(room: Room): string[] {
  const errors: string[] = [];
  const vs = room.vertices;
  if (!Array.isArray(vs) || vs.length < 3) return ['The room outline needs at least 3 corners.'];
  if (vs.length > 200) errors.push('The room outline has more than 200 corners.');
  if (!vs.every(isVec)) return ['Every room corner needs finite X and Z coordinates.'];
  for (let i = 0; i < vs.length; i++) {
    if (wallLength(vs, i) < 0.05) errors.push(`Wall ${i + 1} is shorter than 2 inches — corners ${i + 1} and ${((i + 1) % vs.length) + 1} are (almost) on top of each other.`);
  }
  if (isSelfIntersecting(vs)) errors.push('The room outline crosses itself. Check the order of the corners.');
  if (polygonArea(vs) < 1) errors.push('The room area is less than 1 m² (about 11 sq ft).');
  if (!finite(room.wallHeight) || room.wallHeight < 1.5 || room.wallHeight > 30) errors.push('Wall height must be between 5 ft and 98 ft.');
  if (!finite(room.wallThickness) || room.wallThickness < 0.02 || room.wallThickness > 2) errors.push('Wall thickness must be between 1″ and 6½ ft.');
  if (!isVec(room.spawn)) errors.push('The entrance (spawn) point is invalid.');
  const ids = new Set<string>();
  for (const o of room.openings ?? []) {
    const name = `${o.kind === 'door' ? 'Door' : 'Window'} on wall ${Number(o.wallIndex) + 1}`;
    if (typeof o.id !== 'string' || ids.has(o.id)) errors.push(`${name} has a missing or duplicate ID.`);
    ids.add(o.id);
    if (o.kind !== 'door' && o.kind !== 'window') errors.push(`Opening ${o.id} has an unknown kind.`);
    if (!Number.isInteger(o.wallIndex) || o.wallIndex < 0 || o.wallIndex >= vs.length) {
      errors.push(`${name}: that wall does not exist.`);
      continue;
    }
    if (![o.offset, o.width, o.height, o.sillHeight].every(finite)) {
      errors.push(`${name} has non-numeric measurements.`);
      continue;
    }
    const wl = wallLength(vs, o.wallIndex);
    if (o.width <= 0.1) errors.push(`${name} is too narrow.`);
    if (o.offset < 0 || o.offset + o.width > wl + 1e-6) errors.push(`${name} does not fit on its wall.`);
    if (o.height <= 0 || o.sillHeight < 0 || o.sillHeight + o.height > room.wallHeight + 1e-6) errors.push(`${name} is taller than the wall.`);
  }
  for (const c of room.columns ?? []) {
    if (typeof c.id !== 'string' || ids.has(c.id)) errors.push('A column has a missing or duplicate ID.');
    ids.add(c.id);
    if (!isVec(c.position) || !finite(c.width) || !finite(c.depth) || c.width <= 0 || c.depth <= 0 || c.width > 10 || c.depth > 10) errors.push(`Column ${c.id} has invalid measurements.`);
  }
  if (room.overlay) {
    const o = room.overlay;
    if (typeof o.assetId !== 'string' || !finite(o.width) || o.width <= 0 || !finite(o.aspect) || o.aspect <= 0 || !isVec(o.center) || !finite(o.rotation) || !finite(o.opacity)) {
      errors.push('The reference image settings are invalid.');
    }
  }
  return errors;
}

const FRAMES = ['white', 'black', 'bronze', 'wood'];
const FIXTURES = ['iron-chandelier', 'crystal-chandelier', 'sconce', 'duct'];

function normalizeStyle(st: any): Opening['style'] {
  if (!isObj(st)) return undefined;
  const out: NonNullable<Opening['style']> = {};
  if (FRAMES.includes(st.frame)) out.frame = st.frame;
  if (['single', 'double', 'french'].includes(st.leaves)) out.leaves = st.leaves;
  if (typeof st.exitSign === 'boolean') out.exitSign = st.exitSign;
  if (finite(st.panes) && st.panes >= 1 && st.panes <= 12) out.panes = Math.round(st.panes);
  if (finite(st.transom) && st.transom >= 0 && st.transom < 1) out.transom = st.transom;
  if (typeof st.curtains === 'boolean') out.curtains = st.curtains;
  return Object.keys(out).length ? out : undefined;
}

/** Keep only well-formed architectural details; anything malformed is dropped (decorative only). */
function normalizeFeatures(f: any): RoomFeatures | undefined {
  if (!isObj(f)) return undefined;
  const okLen = (v: unknown, max = 100) => finite(v) && v > 0 && v <= max;
  const out: RoomFeatures = {};
  if (Array.isArray(f.ceilings)) {
    out.ceilings = f.ceilings
      .filter((c: any) => isObj(c) && typeof c.id === 'string' && (c.kind === 'flat' || c.kind === 'vaulted') && isVec(c.center) && okLen(c.width, 300) && okLen(c.depth, 300) && finite(c.rotation) && okLen(c.height, 40))
      .map((c: any) => ({
        id: c.id, kind: c.kind, center: { x: c.center.x, z: c.center.z }, width: c.width, depth: c.depth, rotation: c.rotation, height: c.height,
        ...(okLen(c.peakHeight, 60) && c.peakHeight >= c.height ? { peakHeight: c.peakHeight } : {}),
        ...(finite(c.trussSpacing) && c.trussSpacing >= 0 && c.trussSpacing <= 50 ? { trussSpacing: c.trussSpacing } : {}),
      }));
  }
  if (Array.isArray(f.fixtures)) {
    out.fixtures = f.fixtures
      .filter((x: any) => isObj(x) && typeof x.id === 'string' && FIXTURES.includes(x.kind) && isVec(x.position) && okLen(x.height, 60) && okLen(x.size, 30) && (x.end === undefined || isVec(x.end)))
      .map((x: any) => ({ id: x.id, kind: x.kind, position: { x: x.position.x, z: x.position.z }, height: x.height, size: x.size, ...(x.end ? { end: { x: x.end.x, z: x.end.z } } : {}) }));
  }
  if (Array.isArray(f.pilasters)) {
    out.pilasters = f.pilasters
      .filter((p: any) => isObj(p) && typeof p.id === 'string' && Number.isInteger(p.wallIndex) && finite(p.offset) && okLen(p.width, 20) && okLen(p.depth, 10))
      .map((p: any) => ({ id: p.id, wallIndex: p.wallIndex, offset: p.offset, width: p.width, depth: p.depth, material: p.material === 'plaster' ? 'plaster' : 'stone' }));
  }
  if (isObj(f.finish)) {
    out.finish = {};
    if (['honey-oak', 'dark-walnut', 'light-oak'].includes(f.finish.floor)) out.finish.floor = f.finish.floor;
    if (typeof f.finish.wallColor === 'string' && /^#[0-9a-f]{6}$/i.test(f.finish.wallColor)) out.finish.wallColor = f.finish.wallColor;
    if (['lawn', 'lake-hill-country'].includes(f.finish.exterior)) out.finish.exterior = f.finish.exterior;
  }
  return out;
}

function normalizeRoom(r: any): Room {
  return {
    name: typeof r.name === 'string' ? r.name.slice(0, 200) : 'Reception hall',
    vertices: Array.isArray(r.vertices) ? r.vertices.map((v: any) => ({ x: v?.x, z: v?.z })) : [],
    wallHeight: r.wallHeight,
    wallThickness: finite(r.wallThickness) ? r.wallThickness : 0.2,
    openings: Array.isArray(r.openings)
      ? r.openings.map((o: any) => {
          const style = normalizeStyle(o?.style);
          return { id: o?.id, wallIndex: o?.wallIndex, offset: o?.offset, width: o?.width, height: o?.height, sillHeight: finite(o?.sillHeight) ? o.sillHeight : 0, kind: o?.kind, ...(style ? { style } : {}) };
        })
      : [],
    columns: Array.isArray(r.columns) ? r.columns : [],
    spawn: r.spawn,
    spawnYaw: finite(r.spawnYaw) ? r.spawnYaw : 0,
    dimensionStatus: ['demo', 'estimated', 'measured'].includes(r.dimensionStatus) ? r.dimensionStatus : 'estimated',
    overlay: isObj(r.overlay) ? r.overlay as Room['overlay'] : undefined,
    ...(isObj(r.features) ? { features: normalizeFeatures(r.features) } : {}),
    ...(typeof r.notes === 'string' ? { notes: r.notes.slice(0, 4000) } : {}),
  };
}

function validateFurniture(f: any, where: string, errors: string[]): Furniture | null {
  if (!isObj(f)) {
    errors.push(`${where}: an item is not an object.`);
    return null;
  }
  const name = `${where}: "${typeof f.label === 'string' ? f.label : f.id}"`;
  if (typeof f.id !== 'string' || !f.id) errors.push(`${name} is missing an ID.`);
  if (!TYPES.includes(f.type)) errors.push(`${name} has an unknown type "${String(f.type)}".`);
  if (!isVec(f.position)) errors.push(`${name} has an invalid position.`);
  if (!finite(f.rotation)) errors.push(`${name} has an invalid rotation.`);
  for (const k of ['width', 'depth'] as const) {
    if (!finite(f[k]) || f[k] < BOUNDS.minDim || f[k] > BOUNDS.maxDim) errors.push(`${name} has an out-of-range ${k}.`);
  }
  if (!finite(f.height) || f.height < 0 || f.height > BOUNDS.maxHeight) errors.push(`${name} has an out-of-range height.`);
  if (f.seats !== undefined) {
    if (!Array.isArray(f.seats) || f.seats.length > BOUNDS.maxSeats * 4) errors.push(`${name} has invalid seats.`);
  }
  if (f.sideCounts !== undefined) {
    const sc = f.sideCounts;
    if (!Array.isArray(sc) || sc.length !== 4 || !sc.every((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= BOUNDS.maxSeats)) {
      errors.push(`${name} has invalid seats-per-side counts.`);
    } else if (Array.isArray(f.seats) && sc.reduce((a: number, b: number) => a + b, 0) !== f.seats.length) {
      errors.push(`${name}: seats-per-side counts do not add up to the number of seats.`);
    }
  }
  return {
    id: f.id,
    type: f.type,
    label: typeof f.label === 'string' ? f.label.slice(0, 120) : '',
    number: finite(f.number) ? f.number : undefined,
    position: { x: f.position?.x, z: f.position?.z },
    rotation: f.rotation,
    width: f.width,
    depth: f.depth,
    height: f.height,
    seats: Array.isArray(f.seats) ? f.seats.map((s: any) => ({ id: s?.id, ...(typeof s?.guestId === 'string' ? { guestId: s.guestId } : {}) })) : undefined,
    sideCounts: Array.isArray(f.sideCounts) ? ([...f.sideCounts] as [number, number, number, number]) : undefined,
    variant: typeof f.variant === 'string' ? f.variant : undefined,
    appearance: isObj(f.appearance) ? { ...f.appearance } : undefined,
    notes: typeof f.notes === 'string' ? f.notes.slice(0, 2000) : undefined,
  };
}

export function validateLayout(l: any, errors: string[], warnings: string[]): Layout | null {
  if (!isObj(l)) {
    errors.push('A layout entry is not an object.');
    return null;
  }
  const lname = `Layout "${typeof l.name === 'string' ? l.name : l.id}"`;
  if (typeof l.id !== 'string' || !l.id) errors.push(`${lname} is missing an ID.`);
  if (!isObj(l.room)) {
    errors.push(`${lname} has no room.`);
    return null;
  }
  const room = normalizeRoom(l.room);
  for (const e of validateRoom(room)) errors.push(`${lname}: ${e}`);

  if (!Array.isArray(l.furniture)) errors.push(`${lname} has no furniture list.`);
  if (!Array.isArray(l.guests)) errors.push(`${lname} has no guest list.`);
  if ((l.furniture?.length ?? 0) > 2000) errors.push(`${lname} has more than 2000 items.`);
  if ((l.guests?.length ?? 0) > 5000) errors.push(`${lname} has more than 5000 guests.`);

  const guests: Layout['guests'] = [];
  const guestIds = new Set<string>();
  for (const g of l.guests ?? []) {
    if (!isObj(g) || typeof g.id !== 'string' || !g.id || typeof g.name !== 'string') {
      errors.push(`${lname}: a guest record is invalid.`);
      continue;
    }
    if (guestIds.has(g.id)) errors.push(`${lname}: duplicate guest ID ${g.id}.`);
    guestIds.add(g.id);
    guests.push({ id: g.id, name: g.name.slice(0, 200) });
  }

  const furniture: Furniture[] = [];
  const ids = new Set<string>();
  const seatIds = new Set<string>();
  const assigned = new Set<string>();
  for (const raw of l.furniture ?? []) {
    const f = validateFurniture(raw, lname, errors);
    if (!f) continue;
    if (ids.has(f.id)) errors.push(`${lname}: duplicate furniture ID ${f.id}.`);
    ids.add(f.id);
    for (const s of f.seats ?? []) {
      if (typeof s.id !== 'string' || !s.id || seatIds.has(s.id)) errors.push(`${lname}: "${f.label}" has a missing or duplicate seat ID.`);
      seatIds.add(s.id);
      if (s.guestId !== undefined) {
        if (!guestIds.has(s.guestId)) errors.push(`${lname}: "${f.label}" refers to a guest that is not in the guest list.`);
        else if (assigned.has(s.guestId)) errors.push(`${lname}: a guest is assigned to more than one seat.`);
        assigned.add(s.guestId);
      }
    }
    if (f.type === 'sweetheart' && !f.sideCounts && f.seats) f.sideCounts = sideCountsOf(f);
    furniture.push(f);
  }
  const s = isObj(l.seating) ? l.seating : {};
  const seating = { ...DEFAULT_SEATING };
  for (const k of ['chairWidth', 'chairDepth', 'chairHeight', 'chairOffset'] as const) {
    if (s[k] !== undefined) {
      if (finite(s[k]) && s[k] > 0 && s[k] < 3) seating[k] = s[k];
      else warnings.push(`${lname}: ignored an invalid chair ${k}.`);
    }
  }
  if (['gold', 'white', 'black', 'wood', 'clear'].includes(s.chairFinish)) seating.chairFinish = s.chairFinish;
  return {
    id: l.id,
    name: typeof l.name === 'string' && l.name.trim() ? l.name.slice(0, 120) : 'Untitled layout',
    room,
    furniture,
    guests,
    seating,
  };
}

function normalizeSettings(s: any): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!isObj(s)) return out;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const def = DEFAULT_SETTINGS[k];
    const v = s[k];
    if (typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v))) (out as any)[k] = v;
  }
  if (!['low', 'medium', 'high'].includes(out.quality)) out.quality = 'medium';
  if (!['day', 'evening'].includes(out.lighting)) out.lighting = 'evening';
  out.snapInches = Math.min(48, Math.max(0.25, out.snapInches));
  out.eyeHeight = Math.min(2.2, Math.max(0.8, out.eyeHeight));
  out.seatedEyeHeight = Math.min(1.6, Math.max(0.8, out.seatedEyeHeight));
  out.walkSpeed = Math.min(5, Math.max(0.3, out.walkSpeed));
  return out;
}

/** Upgrade older project shapes to the current schema. Add a branch per schema bump. */
export function migrate(raw: Record<string, any>): Record<string, any> {
  const p = { ...raw };
  // v0 (pre-release) files had no schemaVersion and a single `layout` field.
  if (p.schemaVersion === undefined && isObj(p.layout)) {
    p.layouts = [p.layout];
    p.activeLayoutId = p.layout.id;
    p.schemaVersion = 1;
  }
  return p;
}

/**
 * Validate and normalize anything that claims to be a project — a bare project, or an exported
 * file wrapper `{ app, kind, project }`. Never mutates the input.
 */
export function validateProject(input: unknown): ValidationResult<Project> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let raw: any = input;
  if (isObj(raw) && isObj(raw.project)) raw = raw.project;
  if (!isObj(raw)) return { ok: false, errors: ['This file does not contain a floor-plan project.'], warnings };
  raw = migrate(raw);
  if (!finite(raw.schemaVersion) || !Number.isInteger(raw.schemaVersion) || raw.schemaVersion < 1) {
    return { ok: false, errors: ['This file has no valid schema version — it may not be a floor-plan project.'], warnings };
  }
  if (raw.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, errors: [`This file was made by a newer version of the app (schema ${raw.schemaVersion}). Please update the app and try again.`], warnings };
  }
  if (!Array.isArray(raw.layouts) || raw.layouts.length === 0) return { ok: false, errors: ['The project has no layouts.'], warnings };
  if (raw.layouts.length > 50) errors.push('The project has more than 50 layouts.');
  const layouts: Layout[] = [];
  const ids = new Set<string>();
  for (const l of raw.layouts) {
    const v = validateLayout(l, errors, warnings);
    if (!v) continue;
    if (ids.has(v.id)) errors.push(`Two layouts share the ID ${v.id}.`);
    ids.add(v.id);
    layouts.push(v);
  }
  let active = raw.activeLayoutId;
  if (!ids.has(active)) {
    if (layouts.length) warnings.push('The active layout was missing; the first layout was selected.');
    active = layouts[0]?.id;
  }
  if (errors.length) return { ok: false, errors, warnings };
  return {
    ok: true,
    value: { schemaVersion: SCHEMA_VERSION, activeLayoutId: active, layouts, settings: normalizeSettings(raw.settings) },
    errors,
    warnings,
  };
}
