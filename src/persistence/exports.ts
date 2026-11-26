import type { Layout, Project } from '../model/types';
import type { SceneManager } from '../scene/sceneManager';
import { buildProjectFile, seatingCsv, serializeProjectFile, type ExportKind } from '../model/serialization';
import { seatStats, tablesWithSeats, guestById, unassignedGuests } from '../model/commands';
import { formatFeetShort, ft } from '../model/units';
import { lerp2, outwardNormal, wallLength, polygonArea } from '../model/geometry';
import { blobToDataUrl, getAsset } from './assets';
import { h, clear } from '../ui/dom';

export function safeFileName(s: string): string {
  return s.replace(/[^a-z0-9-_ ]+/gi, '').trim().replace(/\s+/g, '-').toLowerCase() || 'floor-plan';
}

export function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Plain download via a temporary link (works on iPad Safari; saves to Files/Downloads). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

export function canShareFiles(): boolean {
  try {
    const f = new File(['{}'], 'test.json', { type: 'application/json' });
    return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}

/** Share via the system share sheet (AirDrop, Messages, Mail…) with a download fallback. */
export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (canShareFiles()) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export async function projectFileBlob(project: Project, kind: ExportKind, includeImages: boolean): Promise<Blob> {
  let assets: Record<string, string> | undefined;
  if (includeImages) {
    assets = {};
    for (const l of project.layouts) {
      const id = l.room.overlay?.assetId;
      if (id && !assets[id]) {
        const b = await getAsset(id);
        if (b) assets[id] = await blobToDataUrl(b);
      }
    }
  }
  const text = serializeProjectFile(buildProjectFile(project, kind, assets));
  return new Blob([text], { type: 'application/json' });
}

export function projectFileName(project: Project, kind: ExportKind): string {
  const active = project.layouts.find((l) => l.id === project.activeLayoutId);
  const base = project.layouts.length > 1 ? 'wedding-floor-plan' : safeFileName(active?.name ?? 'floor-plan');
  return `${base}${kind === 'layout-only' ? '-layout-only' : ''}-${dateStamp()}.json`;
}

export function seatingCsvBlob(l: Layout): Blob {
  return new Blob(['﻿' + seatingCsv(l)], { type: 'text/csv' });
}

// --------------------------------------------------------------------- overhead image

const SERIF = '"Bodoni 72", Didot, "Playfair Display", Georgia, serif';
const SANS = '-apple-system, "Avenir Next", "Segoe UI", system-ui, sans-serif';

/** Compose a labelled, printable overhead plan (PNG). */
export function composePlanCanvas(sm: SceneManager, layout: Layout, opts: { showNames?: boolean } = {}): HTMLCanvasElement {
  const plan = sm.renderPlanImage(70, 3600);
  const { canvas: img, toPixel, ppm } = plan;
  const header = 120;
  const footer = 90;
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height + header + footer;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(img, 0, header);

  const P = (x: number, z: number) => {
    const p = toPixel({ x, z });
    return { x: p.x, y: p.y + header };
  };
  const scaleText = Math.max(0.7, Math.min(1.6, ppm / 55));

  // header
  ctx.fillStyle = '#1f1b1a';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${Math.round(40 * scaleText)}px ${SERIF}`;
  ctx.fillText(layout.name, 36, 58);
  ctx.font = `${Math.round(17 * scaleText)}px ${SANS}`;
  ctx.fillStyle = '#6b5f59';
  const st = seatStats(layout);
  const area = polygonArea(layout.room.vertices) / (ft(1) * ft(1));
  ctx.fillText(`${layout.room.name} · ${Math.round(area).toLocaleString()} sq ft · ${st.tables} tables · ${st.seats} seats · ${st.guests} guests (${st.assigned} seated)`, 36, 92);
  const status = layout.room.dimensionStatus;
  const badge = status === 'measured' ? 'MEASURED DIMENSIONS' : status === 'estimated' ? 'ESTIMATED DIMENSIONS' : 'DEMO ROOM — NOT ACTUAL VENUE DIMENSIONS';
  ctx.font = `600 ${Math.round(14 * scaleText)}px ${SANS}`;
  const bw = ctx.measureText(badge).width + 24;
  ctx.fillStyle = status === 'measured' ? '#e5efe8' : '#f7e3df';
  ctx.fillRect(out.width - bw - 36, 36, bw, 30);
  ctx.fillStyle = status === 'measured' ? '#2f5d43' : '#8a3b3f';
  ctx.fillText(badge, out.width - bw - 24, 57);

  // wall dimensions
  const vs = layout.room.vertices;
  ctx.font = `${Math.round(13 * scaleText)}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i], b = vs[(i + 1) % vs.length];
    const mid = lerp2(a, b, 0.5);
    const n = outwardNormal(vs, i);
    const off = layout.room.wallThickness + 0.45;
    const p = P(mid.x + n.x * off, mid.z + n.z * off);
    const text = formatFeetShort(wallLength(vs, i));
    const w = ctx.measureText(text).width + 10;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(p.x - w / 2, p.y - 10 * scaleText, w, 20 * scaleText);
    ctx.fillStyle = '#5a4e48';
    ctx.fillText(text, p.x, p.y);
  }

  // item labels
  for (const f of layout.furniture) {
    const p = P(f.position.x, f.position.z);
    const seated = f.seats?.length ? `${f.seats.filter((s) => s.guestId).length}/${f.seats.length}` : '';
    ctx.font = `600 ${Math.round(14 * scaleText)}px ${SANS}`;
    const lines = [f.label, seated].filter(Boolean);
    const lh = 17 * scaleText;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
    const hgt = lines.length * lh + 6;
    ctx.fillStyle = f.type === 'danceFloor' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.82)';
    ctx.beginPath();
    ctx.roundRect(p.x - w / 2, p.y - hgt / 2, w, hgt, 6);
    ctx.fill();
    ctx.fillStyle = '#1f1b1a';
    lines.forEach((l, i) => {
      if (i === 1) ctx.font = `${Math.round(12 * scaleText)}px ${SANS}`;
      ctx.fillText(l, p.x, p.y - ((lines.length - 1) * lh) / 2 + i * lh);
    });
    if (opts.showNames && f.seats?.length) {
      ctx.font = `${Math.round(10.5 * scaleText)}px ${SANS}`;
      const names = f.seats.map((s) => guestById(layout, s.guestId)?.name).filter(Boolean) as string[];
      names.forEach((n, i) => {
        const y = p.y + hgt / 2 + 8 + i * 12.5 * scaleText;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        const w2 = ctx.measureText(n).width + 6;
        ctx.fillRect(p.x - w2 / 2, y - 6 * scaleText, w2, 12.5 * scaleText);
        ctx.fillStyle = '#3d3532';
        ctx.fillText(n, p.x, y);
      });
    }
  }

  // scale bar
  const barFt = [5, 10, 20, 25, 50].find((v) => ft(v) * ppm > out.width * 0.12) ?? 50;
  const bx = 36, by = out.height - footer / 2;
  const bl = ft(barFt) * ppm;
  ctx.fillStyle = '#1f1b1a';
  ctx.fillRect(bx, by, bl, 4);
  ctx.fillRect(bx, by - 8, 2, 20);
  ctx.fillRect(bx + bl - 2, by - 8, 2, 20);
  ctx.textAlign = 'left';
  ctx.font = `${Math.round(14 * scaleText)}px ${SANS}`;
  ctx.fillText(`${barFt} ft`, bx + bl + 12, by + 2);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8a7d76';
  ctx.font = `${Math.round(12 * scaleText)}px ${SANS}`;
  ctx.fillText(`Planning aid only — confirm clearances, accessibility and egress with the venue. Exported ${new Date().toLocaleDateString()}`, out.width - 36, by + 2);
  return out;
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png'));
}

/** Print a floor plan page plus a table-by-table seating list. */
export async function printPlan(sm: SceneManager, layout: Layout): Promise<void> {
  const canvas = composePlanCanvas(sm, layout);
  const url = URL.createObjectURL(await canvasToBlob(canvas));
  let root = document.getElementById('print-root');
  if (!root) {
    root = h('div', { id: 'print-root' });
    document.body.appendChild(root);
  }
  clear(root);
  const tables = tablesWithSeats(layout).map((t) =>
    h(
      'section',
      { class: 'print-table' },
      h('h3', null, `${t.label}`, h('small', null, ` · ${t.seats!.filter((s) => s.guestId).length}/${t.seats!.length} seats`)),
      h('ol', null, t.seats!.map((s) => h('li', null, guestById(layout, s.guestId)?.name ?? '—'))),
    ),
  );
  const un = unassignedGuests(layout);
  root.append(
    h('div', { class: 'print-page' }, h('img', { src: url, alt: 'Floor plan' })),
    h(
      'div',
      { class: 'print-page print-seating' },
      h('h2', null, `${layout.name} — seating`),
      h('div', { class: 'print-tables' }, tables),
      un.length ? h('section', { class: 'print-table' }, h('h3', null, `Unassigned (${un.length})`), h('ul', null, un.map((g) => h('li', null, g.name)))) : null,
    ),
  );
  const img = root.querySelector('img')!;
  await new Promise<void>((r) => (img.complete ? r() : (img.onload = () => r())));
  window.print();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
