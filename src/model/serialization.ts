import type { Layout, Project } from './types';
import { validateProject, type ValidationResult } from './validation';

export const FILE_APP_ID = 'wedding-floor-plan-simulator';

export type ExportKind = 'project' | 'layout-only';

export interface ProjectFile {
  app: string;
  kind: ExportKind;
  exportedAt: string;
  project: Project;
  /** Optional embedded reference images, keyed by asset ID (data URLs). */
  assets?: Record<string, string>;
}

export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** Remove every guest record and seat assignment (for sharing a layout privately). */
export function stripGuests(project: Project): Project {
  const p = clone(project);
  for (const l of p.layouts) {
    l.guests = [];
    for (const f of l.furniture) for (const s of f.seats ?? []) delete s.guestId;
  }
  return p;
}

export function buildProjectFile(project: Project, kind: ExportKind, assets?: Record<string, string>): ProjectFile {
  const p = kind === 'layout-only' ? stripGuests(project) : clone(project);
  const file: ProjectFile = { app: FILE_APP_ID, kind, exportedAt: new Date().toISOString(), project: p };
  if (assets && Object.keys(assets).length) file.assets = assets;
  return file;
}

export function serializeProjectFile(file: ProjectFile): string {
  return JSON.stringify(file, null, 2);
}

export interface ParsedImport extends ValidationResult<Project> {
  assets: Record<string, string>;
  kind: ExportKind | 'unknown';
}

export function parseProjectFile(text: string): ParsedImport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['This file is not valid JSON. It may be damaged or not a floor-plan export.'], warnings: [], assets: {}, kind: 'unknown' };
  }
  const result = validateProject(data);
  const assets: Record<string, string> = {};
  let kind: ParsedImport['kind'] = 'unknown';
  if (typeof data === 'object' && data !== null) {
    const d = data as Record<string, any>;
    if (d.kind === 'project' || d.kind === 'layout-only') kind = d.kind;
    if (d.assets && typeof d.assets === 'object') {
      for (const [k, v] of Object.entries(d.assets)) {
        if (typeof v === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(v) && v.length < 25_000_000) assets[k] = v;
      }
    }
  }
  return { ...result, assets, kind };
}

export interface LayoutSummary {
  name: string;
  tables: number;
  seats: number;
  guests: number;
  assigned: number;
  status: string;
}

export function summarizeLayout(l: Layout): LayoutSummary {
  let seats = 0, assigned = 0, tables = 0;
  for (const f of l.furniture) {
    if (f.seats?.length) {
      tables++;
      seats += f.seats.length;
      assigned += f.seats.filter((s) => s.guestId).length;
    }
  }
  return { name: l.name, tables, seats, guests: l.guests.length, assigned, status: l.room.dimensionStatus };
}

/** Give every ID in a layout a fresh value (used when importing as new variants or cloning). */
export function reidentifyLayout(l: Layout, newId: (p: string) => string): Layout {
  const out = clone(l);
  out.id = newId('layout');
  const guestMap = new Map<string, string>();
  for (const g of out.guests) {
    const nid = newId('g');
    guestMap.set(g.id, nid);
    g.id = nid;
  }
  for (const f of out.furniture) {
    f.id = newId('f');
    for (const s of f.seats ?? []) {
      s.id = newId('seat');
      if (s.guestId) s.guestId = guestMap.get(s.guestId);
    }
  }
  for (const o of out.room.openings) o.id = newId('open');
  for (const c of out.room.columns) c.id = newId('col');
  return out;
}

export function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Table-by-table seating list as CSV. */
export function seatingCsv(l: Layout): string {
  const guestName = new Map(l.guests.map((g) => [g.id, g.name]));
  const rows = [['Table', 'Table number', 'Seat', 'Guest']];
  const tables = l.furniture.filter((f) => f.seats?.length);
  tables.sort((a, b) => (a.number ?? 9999) - (b.number ?? 9999) || a.label.localeCompare(b.label));
  for (const f of tables) {
    f.seats!.forEach((s, i) => rows.push([f.label, f.number !== undefined ? String(f.number) : '', String(i + 1), s.guestId ? guestName.get(s.guestId) ?? '' : '']));
  }
  const seated = new Set(tables.flatMap((f) => f.seats!.map((s) => s.guestId).filter(Boolean)));
  for (const g of l.guests) if (!seated.has(g.id)) rows.push(['(unassigned)', '', '', g.name]);
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
}

/** Minimal RFC-4180 CSV parser. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** Guest names from CSV: uses a "name"/"guest" column if present, else the first column. */
export function guestNamesFromCsv(text: string): string[] {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  let col = header.findIndex((h) => h === 'name' || h === 'guest' || h === 'guest name' || h === 'full name');
  let start = 1;
  if (col < 0) {
    const first = header.findIndex((h) => h === 'first name' || h === 'first');
    const last = header.findIndex((h) => h === 'last name' || h === 'last');
    if (first >= 0) {
      return rows.slice(1).map((r) => `${(r[first] ?? '').trim()} ${last >= 0 ? (r[last] ?? '').trim() : ''}`.trim()).filter(Boolean);
    }
    col = 0;
    start = header[0] === 'table' ? 1 : 0;
    if (header[0] === 'table') col = Math.max(0, header.length - 1);
  }
  return rows.slice(start).map((r) => (r[col] ?? '').trim()).filter(Boolean);
}
