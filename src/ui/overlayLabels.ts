import type { AppContext } from './context';
import type { CeilingZone, Opening, Pilaster, Room, Vec2 } from '../model/types';
import { h, svgIcon } from './dom';
import { ICONS } from './icons';
import { seatPoses } from '../model/seats';
import { guestById, findFurniture } from '../model/commands';
import { formatFeetShort, formatFtIn, ft, inch } from '../model/units';
import { add, dist, dot, lerp2, localToWorld, outwardNormal, polygonArea, rotate, sub, unrotate, wallLength } from '../model/geometry';
import { ceilingAt, chandelierMinDrop, isChandelier, zoneCorners, zoneExtents } from '../model/ceilings';
import { occupiedFootprint } from '../model/warnings';
import { alongWall, keepsWinding, moveVertex, moveWall, nearestWall, tryRoom } from '../model/roomEdit';

type ScreenPt = { x: number; y: number };
type WallItemKind = 'opening' | 'pilaster';
type WallItem = Opening | Pilaster;

/** Callbacks for a drag that starts on an overlay handle. Return false from `start` to ignore the press. */
interface HandleDrag {
  start(e: PointerEvent, floor: Vec2): boolean | void;
  move(e: PointerEvent, floor: Vec2): void;
  end(moved: boolean, cancelled: boolean): void;
}

interface Pooled {
  el: HTMLElement;
  used: boolean;
}

/** Keyed pool of absolutely positioned DOM labels. */
class LabelPool {
  private items = new Map<string, Pooled>();
  constructor(private host: HTMLElement) {}
  begin(): void {
    for (const p of this.items.values()) p.used = false;
  }
  get(key: string, make: () => HTMLElement): HTMLElement {
    let p = this.items.get(key);
    if (!p) {
      p = { el: make(), used: true };
      this.items.set(key, p);
      this.host.appendChild(p.el);
    }
    p.used = true;
    p.el.hidden = false;
    return p.el;
  }
  end(): void {
    for (const [k, p] of this.items) {
      if (!p.used) {
        p.el.remove();
        this.items.delete(k);
      }
    }
  }
}

const place = (el: HTMLElement, x: number, y: number) => {
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
};

/**
 * DOM overlays drawn over the 3D canvas: table labels, guest names, wall dimensions, warning
 * badges, corner handles, the floating selection toolbar and the scale bar.
 */
export class OverlayLabels {
  readonly layer: HTMLElement;
  private pool: LabelPool;
  private hud: HTMLElement;
  private knob: HTMLElement;
  private scaleBar: HTMLElement;
  private scaleText: HTMLElement;
  editCorners = false;
  editCeilings = false;
  private svg: SVGSVGElement;
  showWallNumbers = false;
  private rotating: { id: number; start: number; base: number } | null = null;
  private handleDragId: number | null = null;
  private readout: HTMLElement;
  /** Called when a door, window or pilaster on the plan is tapped without dragging. */
  onWallItemClick: (id: string) => void = () => {};

  constructor(private ctx: AppContext, viewport: HTMLElement) {
    this.layer = h('div', { class: 'label-layer', 'aria-hidden': 'true' });
    this.pool = new LabelPool(this.layer);
    this.knob = h('button', { class: 'hud-btn hud-knob', title: 'Drag to rotate', 'aria-label': 'Drag to rotate' }, svgIcon(ICONS.rotate));
    this.hud = h(
      'div',
      { class: 'selection-hud', role: 'toolbar', 'aria-label': 'Selected item' },
      h('button', { class: 'hud-btn', title: 'Rotate left 15°', 'aria-label': 'Rotate left', onclick: () => ctx.editor.rotateSelected(Math.PI / 12) }, svgIcon(ICONS.rotL)),
      this.knob,
      h('button', { class: 'hud-btn', title: 'Rotate right 15°', 'aria-label': 'Rotate right', onclick: () => ctx.editor.rotateSelected(-Math.PI / 12) }, svgIcon(ICONS.rotR)),
      h('span', { class: 'hud-sep' }),
      h('button', { class: 'hud-btn', title: 'Duplicate', 'aria-label': 'Duplicate', onclick: () => ctx.editor.duplicateSelected() }, svgIcon(ICONS.copy)),
      h('button', { class: 'hud-btn', title: 'Edit details', 'aria-label': 'Edit details', onclick: () => ctx.openInspector() }, svgIcon(ICONS.settings)),
      h('button', { class: 'hud-btn hud-danger', title: 'Delete', 'aria-label': 'Delete', onclick: () => ctx.editor.deleteSelected() }, svgIcon(ICONS.trash)),
    );
    this.hud.hidden = true;
    this.scaleText = h('span');
    this.scaleBar = h('div', { class: 'scale-bar', 'aria-hidden': 'true' }, h('div', { class: 'scale-line' }), this.scaleText);
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'zone-svg');
    this.svg.setAttribute('aria-hidden', 'true');
    viewport.append(this.svg);
    this.readout = h('div', { class: 'drag-readout', 'aria-live': 'polite' });
    this.readout.hidden = true;
    viewport.append(this.layer, this.hud, this.scaleBar, this.readout);
    this.bindKnob();
    ctx.sm.onAfterRender(() => this.update());
    ctx.store.subscribe(() => ctx.sm.invalidate());
  }

  private bindKnob(): void {
    const { sm, store, editor } = this.ctx;
    const floorAt = (e: PointerEvent): Vec2 | null => {
      const r = sm.renderer.domElement.getBoundingClientRect();
      return sm.screenToFloor(e.clientX - r.left, e.clientY - r.top);
    };
    this.knob.addEventListener('pointerdown', (e) => {
      const f = findFurniture(store.layout, store.selection.furnitureId);
      const p = floorAt(e);
      if (!f || !p) return;
      e.preventDefault();
      e.stopPropagation();
      this.knob.setPointerCapture(e.pointerId);
      this.rotating = { id: e.pointerId, start: Math.atan2(p.z - f.position.z, p.x - f.position.x), base: f.rotation };
      store.beginGesture();
    });
    this.knob.addEventListener('pointermove', (e) => {
      if (!this.rotating || e.pointerId !== this.rotating.id) return;
      const f = findFurniture(store.layout, store.selection.furnitureId);
      const p = floorAt(e);
      if (!f || !p) return;
      const a = Math.atan2(p.z - f.position.z, p.x - f.position.x);
      const rot = editor.snapAngle(this.rotating.base - (a - this.rotating.start), e.altKey);
      if (rot !== f.rotation) store.applyTransient((l) => (findFurniture(l, f.id)!.rotation = rot));
    });
    const end = (e: PointerEvent) => {
      if (!this.rotating || e.pointerId !== this.rotating.id) return;
      this.rotating = null;
      const f = findFurniture(store.layout, store.selection.furnitureId);
      store.endGesture(`Rotate ${f?.label ?? 'item'}`);
    };
    this.knob.addEventListener('pointerup', end);
    this.knob.addEventListener('pointercancel', end);
    this.knob.addEventListener('click', (e) => e.preventDefault());
  }

  // -------------------------------------------------------------- room editing handles

  private floorAt(e: PointerEvent): Vec2 | null {
    const r = this.ctx.sm.renderer.domElement.getBoundingClientRect();
    return this.ctx.sm.screenToFloor(e.clientX - r.left, e.clientY - r.top);
  }

  /** Snap step in metres, or 0 when snapping is off (or Option/Alt is held). */
  private snapStep(e: PointerEvent): number {
    const s = this.ctx.store.settings;
    return s.snapEnabled && !e.altKey ? inch(s.snapInches) : 0;
  }

  private showReadout(e: PointerEvent, text: string): void {
    const r = this.ctx.sm.renderer.domElement.getBoundingClientRect();
    if (this.readout.textContent !== text) this.readout.textContent = text;
    this.readout.hidden = false;
    const { w, h: vh } = this.ctx.sm.viewportSize;
    let x = e.clientX - r.left + 18, y = e.clientY - r.top + 18;
    const rw = this.readout.offsetWidth, rh = this.readout.offsetHeight;
    if (x + rw > w - 8) x = Math.max(8, e.clientX - r.left - rw - 18);
    if (y + rh > vh - 8) y = Math.max(8, e.clientY - r.top - rh - 18);
    place(this.readout, x, y);
  }

  /** Wire pointer events on a handle: one undo step per drag, room rebuilt live. */
  private bindHandle(el: HTMLElement, d: HandleDrag): void {
    const { store } = this.ctx;
    let moved = false;
    let sx = 0, sy = 0;
    el.addEventListener('pointerdown', (e) => {
      if (store.mode !== 'build' || this.handleDragId !== null) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = this.floorAt(e);
      if (!p) return;
      e.preventDefault();
      e.stopPropagation();
      if (d.start(e, p) === false) return;
      el.setPointerCapture(e.pointerId);
      this.handleDragId = e.pointerId;
      moved = false;
      sx = e.clientX;
      sy = e.clientY;
      el.classList.add('active');
      store.beginGesture();
    });
    el.addEventListener('pointermove', (e) => {
      if (this.handleDragId !== e.pointerId) return;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < (e.pointerType === 'touch' ? 6 : 3)) return;
      moved = true;
      const p = this.floorAt(e);
      if (p) d.move(e, p);
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (this.handleDragId !== e.pointerId) return;
      this.handleDragId = null;
      el.classList.remove('active');
      this.readout.hidden = true;
      d.end(moved, cancelled);
    };
    el.addEventListener('pointerup', (e) => end(e, false));
    el.addEventListener('pointercancel', (e) => end(e, true));
    el.addEventListener('lostpointercapture', (e) => end(e, false));
  }

  private cornerHandle(i: number): HTMLElement {
    const el = h('div', { class: 'corner-handle', title: `Corner ${i + 1} — drag to move` }, String(i + 1));
    const { store } = this.ctx;
    let index = i;
    this.bindHandle(el, {
      start: () => void (index = Number(el.dataset.index)),
      move: (e, p) => {
        const step = this.snapStep(e);
        if (step) p = { x: Math.round(p.x / step) * step, z: Math.round(p.z / step) * step };
        const next = moveVertex(store.layout.room, index, p);
        if (keepsWinding(store.layout.room, next) && tryRoom(next).length === 0) store.applyTransient((l) => (l.room = next), { room: true });
        const vs = store.layout.room.vertices;
        const n = vs.length;
        const prev = (index - 1 + n) % n;
        this.showReadout(e, `Wall ${prev + 1}: ${formatFeetShort(wallLength(vs, prev))} · Wall ${index + 1}: ${formatFeetShort(wallLength(vs, index))}`);
      },
      end: (_moved, cancelled) => (cancelled ? store.cancelGesture() : store.endGesture('Move corner', { room: true })),
    });
    return el;
  }

  /** Handle on the inside of a wall: drag it to slide the whole wall in or out. */
  private wallHandle(i: number): HTMLElement {
    const el = h('div', { class: 'wall-handle', title: `Wall ${i + 1} — drag to move the whole wall in or out`, 'aria-label': `Move wall ${i + 1}` }, h('span', null, '⇅'));
    const { store } = this.ctx;
    let drag: { index: number; base: Room; p0: Vec2; n: Vec2 } | null = null;
    this.bindHandle(el, {
      start: (_e, p) => {
        const index = Number(el.dataset.index);
        const base: Room = JSON.parse(JSON.stringify(store.layout.room));
        drag = { index, base, p0: p, n: outwardNormal(base.vertices, index) };
      },
      move: (e, p) => {
        if (!drag) return;
        const step = this.snapStep(e);
        let delta = dot(sub(p, drag.p0), drag.n);
        if (step) delta = Math.round(delta / step) * step;
        const next = moveWall(drag.base, drag.index, delta);
        if (keepsWinding(drag.base, next) && tryRoom(next).length === 0) store.applyTransient((l) => (l.room = next), { room: true });
        const shown = dot(sub(store.layout.room.vertices[drag.index], drag.base.vertices[drag.index]), drag.n);
        const dir = Math.abs(shown) < 1e-6 ? 'not moved' : `${formatFtIn(Math.abs(shown))} ${shown > 0 ? 'out' : 'in'}`;
        this.showReadout(e, `Wall ${drag.index + 1}: ${dir} · ${sqFt(store.layout.room)} sq ft`);
      },
      end: (_moved, cancelled) => {
        drag = null;
        if (cancelled) store.cancelGesture();
        else store.endGesture('Move wall', { room: true });
      },
    });
    return el;
  }

  /** Doors/windows and pilasters share the same wall-anchored placement (wall, offset, width). */
  private wallItems(room: Room, kind: WallItemKind): WallItem[] {
    return kind === 'opening' ? room.openings : room.features?.pilasters ?? [];
  }

  private findWallItem(room: Room, kind: WallItemKind, id: string): WallItem | undefined {
    return this.wallItems(room, kind).find((x) => x.id === id);
  }

  private wallItemName(kind: WallItemKind, item: WallItem): string {
    if (kind === 'pilaster') return (item as Pilaster).material === 'plaster' ? 'Plaster pilaster' : 'Stone pilaster';
    return (item as Opening).kind === 'door' ? 'Door' : 'Window';
  }

  private wallItemText(kind: WallItemKind, o: WallItem, room: Room): string {
    const L = wallLength(room.vertices, o.wallIndex);
    const after = Math.max(0, L - o.offset - o.width);
    return `${this.wallItemName(kind, o)} on wall ${o.wallIndex + 1} · ${formatFtIn(o.offset)} from corner ${o.wallIndex + 1}, ${formatFtIn(after)} to corner ${((o.wallIndex + 1) % room.vertices.length) + 1} · ${formatFtIn(o.width)} wide`;
  }

  /** A door, window or pilaster: drag along its wall, or onto another wall. Tap to edit its details. */
  private wallItemHandle(kind: WallItemKind, id: string): HTMLElement {
    const el = h('div', { class: kind === 'opening' ? 'opening-handle' : 'opening-handle pilaster' });
    const { store } = this.ctx;
    let drag: { grab: number; wall: number } | null = null;
    this.bindHandle(el, {
      start: (_e, p) => {
        const o = this.findWallItem(store.layout.room, kind, id);
        if (!o) return false;
        drag = { wall: o.wallIndex, grab: alongWall(store.layout.room.vertices, o.wallIndex, p) - o.offset };
      },
      move: (e, p) => {
        const room = store.layout.room;
        const o = this.findWallItem(room, kind, id);
        if (!o || !drag) return;
        const vs = room.vertices;
        const near = nearestWall(vs, p);
        if (near.index !== drag.wall) {
          const cur = vs[drag.wall], nxt = vs[(drag.wall + 1) % vs.length];
          const t = Math.max(0, Math.min(1, alongWall(vs, drag.wall, p) / (wallLength(vs, drag.wall) || 1)));
          const dCur = dist(p, lerp2(cur, nxt, t));
          // a little hysteresis so it doesn't flicker between walls at a corner
          if (near.distance < dCur - 0.25 && o.width <= wallLength(vs, near.index)) {
            drag.wall = near.index;
            drag.grab = o.width / 2;
          }
        }
        const L = wallLength(vs, drag.wall);
        const step = this.snapStep(e);
        let offset = alongWall(vs, drag.wall, p) - drag.grab;
        if (step) offset = Math.round(offset / step) * step;
        offset = Math.max(0, Math.min(L - o.width, offset));
        const wall = drag.wall;
        if (offset !== o.offset || wall !== o.wallIndex) {
          store.applyTransient((l) => {
            const x = this.findWallItem(l.room, kind, id);
            if (x) {
              x.wallIndex = wall;
              x.offset = offset;
            }
          }, { room: true });
        }
        const now = this.findWallItem(store.layout.room, kind, id);
        if (now) this.showReadout(e, this.wallItemText(kind, now, store.layout.room));
      },
      end: (moved, cancelled) => {
        drag = null;
        const o = this.findWallItem(store.layout.room, kind, id);
        if (cancelled) store.cancelGesture();
        else store.endGesture(`Move ${o ? this.wallItemName(kind, o).toLowerCase() : 'item'}`, { room: true });
        if (!moved && !cancelled) this.onWallItemClick(id);
      },
    });
    return el;
  }

  /** Grip at one end of a door, window or pilaster: drag to change its width (the other end stays put). */
  private wallItemGrip(kind: WallItemKind, id: string, side: 0 | 1): HTMLElement {
    const el = h('div', { class: 'opening-grip', title: 'Drag to resize' });
    const { store } = this.ctx;
    const MIN = kind === 'opening' ? inch(12) : inch(4);
    this.bindHandle(el, {
      start: () => !!this.findWallItem(store.layout.room, kind, id),
      move: (e, p) => {
        const room = store.layout.room;
        const o = this.findWallItem(room, kind, id);
        if (!o) return;
        const L = wallLength(room.vertices, o.wallIndex);
        const step = this.snapStep(e);
        let t = alongWall(room.vertices, o.wallIndex, p);
        if (step) t = Math.round(t / step) * step;
        let offset = o.offset, width = o.width;
        if (side === 0) {
          const endT = o.offset + o.width;
          offset = Math.max(0, Math.min(endT - MIN, t));
          width = endT - offset;
        } else {
          width = Math.max(MIN, Math.min(L, t) - o.offset);
        }
        if (kind === 'pilaster') width = Math.min(width, ft(20));
        if (offset !== o.offset || width !== o.width) {
          store.applyTransient((l) => {
            const x = this.findWallItem(l.room, kind, id);
            if (x) {
              x.offset = offset;
              x.width = width;
            }
          }, { room: true });
        }
        const now = this.findWallItem(store.layout.room, kind, id);
        if (now) this.showReadout(e, this.wallItemText(kind, now, store.layout.room));
      },
      end: (_moved, cancelled) => {
        const o = this.findWallItem(store.layout.room, kind, id);
        if (cancelled) store.cancelGesture();
        else store.endGesture(`Resize ${o ? this.wallItemName(kind, o).toLowerCase() : 'item'}`, { room: true });
      },
    });
    return el;
  }

  /** Column (pillar) handle: drag to move it. */
  private columnHandle(id: string): HTMLElement {
    const el = h('div', { class: 'column-handle', title: 'Pillar — drag to move' });
    const { store } = this.ctx;
    let grab: Vec2 = { x: 0, z: 0 };
    this.bindHandle(el, {
      start: (_e, p) => {
        const c = store.layout.room.columns.find((x) => x.id === id);
        if (!c) return false;
        grab = sub(p, c.position);
      },
      move: (e, p) => {
        const c = store.layout.room.columns.find((x) => x.id === id);
        if (!c) return;
        const step = this.snapStep(e);
        let q = sub(p, grab);
        if (step) q = { x: Math.round(q.x / step) * step, z: Math.round(q.z / step) * step };
        if (q.x !== c.position.x || q.z !== c.position.z) {
          store.applyTransient((l) => {
            const x = l.room.columns.find((y) => y.id === id);
            if (x) x.position = q;
          }, { room: true });
        }
        this.showReadout(e, `Pillar at ${formatFtIn(q.x)}, ${formatFtIn(q.z)}`);
      },
      end: (_moved, cancelled) => (cancelled ? store.cancelGesture() : store.endGesture('Move pillar', { room: true })),
    });
    return el;
  }

  // -------------------------------------------------------------- ceilings & chandeliers

  private zoneLabelText(z: CeilingZone, n: number): string {
    return z.kind === 'vaulted'
      ? `${n} · Truss ${formatFeetShort(z.height)}–${formatFeetShort(z.peakHeight ?? z.height)}`
      : `${n} · Flat ${formatFeetShort(z.height)}`;
  }

  private zoneReadout(z: CeilingZone, room: Room): string {
    const n = (room.features?.ceilings ?? []).findIndex((x) => x.id === z.id) + 1;
    const { sx, sz } = zoneExtents(z);
    return `Ceiling area ${n} · ${formatFeetShort(sx)} left–right × ${formatFeetShort(sz)} top–bottom`;
  }

  /**
   * Lines a zone edge can snap to, as coordinates along one of the zone's local axes (measured from
   * the world origin): walls and other zones' edges that run parallel to that edge.
   */
  private zoneSnapLines(room: Room, z: CeilingZone, axis: 'x' | 'z'): number[] {
    const along = (p: Vec2) => unrotate(p, z.rotation)[axis];
    const edgeDir = rotate(axis === 'x' ? { x: 0, z: 1 } : { x: 1, z: 0 }, z.rotation);
    const lines: number[] = [];
    const vs = room.vertices;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      const L = dist(a, b);
      if (L < 1e-6) continue;
      if (Math.abs(dot(edgeDir, { x: (b.x - a.x) / L, z: (b.z - a.z) / L })) > 0.995) lines.push(along(a));
    }
    for (const o of room.features?.ceilings ?? []) {
      if (o.id === z.id) continue;
      const c = zoneCorners(o);
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4];
        const L = dist(a, b);
        if (L > 1e-6 && Math.abs(dot(edgeDir, { x: (b.x - a.x) / L, z: (b.z - a.z) / L })) > 0.995) lines.push(along(a));
      }
    }
    return lines;
  }

  private snapTolerance(): number {
    const { sm } = this.ctx;
    return Math.max(0.15, (sm.view === 'top' ? 14 / sm.top.ppm : 0.3));
  }

  /** Ceiling area label: drag to move the whole area, tap to open its settings. */
  private zoneMoveHandle(id: string): HTMLElement {
    const el = h('div', { class: 'zone-label' });
    const { store } = this.ctx;
    let drag: { base: CeilingZone; p0: Vec2 } | null = null;
    this.bindHandle(el, {
      start: (_e, p) => {
        const z = store.layout.room.features?.ceilings?.find((x) => x.id === id);
        if (!z) return false;
        drag = { base: JSON.parse(JSON.stringify(z)), p0: p };
      },
      move: (e, p) => {
        if (!drag) return;
        const room = store.layout.room;
        const b = drag.base;
        // work in the zone's own axes so rotated zones behave too
        const c0 = unrotate(add(b.center, sub(p, drag.p0)), b.rotation);
        const half = { x: b.width / 2, z: b.depth / 2 };
        const step = this.snapStep(e);
        const tol = this.snapTolerance();
        const snapped = { x: c0.x, z: c0.z };
        for (const axis of ['x', 'z'] as const) {
          let best: number | null = null;
          if (step) {
            for (const line of this.zoneSnapLines(room, b, axis)) {
              for (const s of [-1, 1]) {
                const shift = line - (c0[axis] + s * half[axis]);
                if (Math.abs(shift) < tol && (best === null || Math.abs(shift) < Math.abs(best))) best = shift;
              }
            }
          }
          if (best !== null) snapped[axis] = c0[axis] + best;
          else if (step) snapped[axis] = Math.round((c0[axis] - half[axis]) / step) * step + half[axis];
        }
        const center = rotate(snapped, b.rotation);
        store.applyTransient((l) => {
          const z = l.room.features?.ceilings?.find((x) => x.id === id);
          if (z) z.center = center;
        }, { room: true });
        const z = store.layout.room.features?.ceilings?.find((x) => x.id === id);
        if (z) this.showReadout(e, this.zoneReadout(z, store.layout.room));
      },
      end: (moved, cancelled) => {
        drag = null;
        if (cancelled) store.cancelGesture();
        else store.endGesture('Move ceiling area', { room: true });
        if (!moved && !cancelled) this.onWallItemClick(id);
      },
    });
    return el;
  }

  /** Tab on one edge of a ceiling area: drag to resize (the opposite edge stays put). */
  private zoneEdgeHandle(id: string, edge: number): HTMLElement {
    const el = h('div', { class: 'zone-edge', title: 'Drag to resize this ceiling area' });
    const { store } = this.ctx;
    const axis: 'x' | 'z' = edge === 1 || edge === 3 ? 'x' : 'z';
    const side = edge === 1 || edge === 2 ? 1 : -1;
    let base: CeilingZone | null = null;
    this.bindHandle(el, {
      start: () => {
        const z = store.layout.room.features?.ceilings?.find((x) => x.id === id);
        if (!z) return false;
        base = JSON.parse(JSON.stringify(z));
      },
      move: (e, p) => {
        if (!base) return;
        const b = base;
        const room = store.layout.room;
        const half = axis === 'x' ? b.width / 2 : b.depth / 2;
        const c = unrotate(b.center, b.rotation)[axis];
        const fixed = c - side * half;
        let m = unrotate(p, b.rotation)[axis];
        const step = this.snapStep(e);
        if (step) {
          const tol = this.snapTolerance();
          let best: number | null = null;
          for (const line of this.zoneSnapLines(room, b, axis)) if (Math.abs(line - m) < tol && (best === null || Math.abs(line - m) < Math.abs(best - m))) best = line;
          if (best !== null) m = best;
          else m = fixed + side * Math.round((side * (m - fixed)) / step) * step;
        }
        const size = Math.max(ft(3), side * (m - fixed));
        m = fixed + side * size;
        const shift = (m + fixed) / 2 - c;
        const center = add(b.center, rotate(axis === 'x' ? { x: shift, z: 0 } : { x: 0, z: shift }, b.rotation));
        store.applyTransient((l) => {
          const z = l.room.features?.ceilings?.find((x) => x.id === id);
          if (!z) return;
          z.center = center;
          if (axis === 'x') z.width = size;
          else z.depth = size;
        }, { room: true });
        const z = store.layout.room.features?.ceilings?.find((x) => x.id === id);
        if (z) this.showReadout(e, this.zoneReadout(z, store.layout.room));
      },
      end: (_moved, cancelled) => {
        base = null;
        if (cancelled) store.cancelGesture();
        else store.endGesture('Resize ceiling area', { room: true });
      },
    });
    return el;
  }

  /** Chandelier: drag to move (it stays below the ceiling), tap to open its settings. */
  private chandelierHandle(id: string): HTMLElement {
    const el = h('div', { class: 'fixture-handle' });
    const { store } = this.ctx;
    let base: { position: Vec2; height: number; grab: Vec2 } | null = null;
    this.bindHandle(el, {
      start: (_e, p) => {
        const f = store.layout.room.features?.fixtures?.find((x) => x.id === id);
        if (!f) return false;
        base = { position: { ...f.position }, height: f.height, grab: sub(p, f.position) };
      },
      move: (e, p) => {
        if (!base) return;
        const room = store.layout.room;
        const f = room.features?.fixtures?.find((x) => x.id === id);
        if (!f || !isChandelier(f)) return;
        let q = sub(p, base.grab);
        const step = this.snapStep(e);
        if (step) q = { x: Math.round(q.x / step) * step, z: Math.round(q.z / step) * step };
        // keep its original height unless the ceiling here is too low for it
        const ceil = ceilingAt(room, q);
        const height = Math.max(0.5, Math.min(base.height, ceil - chandelierMinDrop(f.kind)));
        store.applyTransient((l) => {
          const x = l.room.features?.fixtures?.find((y) => y.id === id);
          if (x) {
            x.position = q;
            x.height = height;
          }
        }, { room: true });
        this.showReadout(e, `${f.kind === 'iron-chandelier' ? 'Iron ring' : 'Crystal drum'} chandelier · ceiling here ${formatFeetShort(ceil)} · bottom at ${formatFtIn(height)}`);
      },
      end: (moved, cancelled) => {
        base = null;
        if (cancelled) store.cancelGesture();
        else store.endGesture('Move chandelier', { room: true });
        if (!moved && !cancelled) this.onWallItemClick(id);
      },
    });
    return el;
  }

  /** Wall light (sconce): drag along the walls, or onto another wall. */
  private sconceHandle(id: string): HTMLElement {
    const el = h('div', { class: 'sconce-handle' });
    const { store } = this.ctx;
    let wall = -1;
    this.bindHandle(el, {
      start: () => {
        const f = store.layout.room.features?.fixtures?.find((x) => x.id === id);
        if (!f) return false;
        wall = nearestWall(store.layout.room.vertices, f.position).index;
      },
      move: (e, p) => {
        const room = store.layout.room;
        const vs = room.vertices;
        const near = nearestWall(vs, p);
        if (near.index !== wall) {
          const t = Math.max(0, Math.min(1, alongWall(vs, wall, p) / (wallLength(vs, wall) || 1)));
          const dCur = dist(p, lerp2(vs[wall], vs[(wall + 1) % vs.length], t));
          if (near.distance < dCur - 0.25) wall = near.index;
        }
        const L = wallLength(vs, wall);
        const step = this.snapStep(e);
        let t = alongWall(vs, wall, p);
        if (step) t = Math.round(t / step) * step;
        t = Math.max(Math.min(0.15, L / 2), Math.min(L - Math.min(0.15, L / 2), t));
        const q = lerp2(vs[wall], vs[(wall + 1) % vs.length], t / (L || 1));
        store.applyTransient((l) => {
          const x = l.room.features?.fixtures?.find((y) => y.id === id);
          if (x) x.position = q;
        }, { room: true });
        const n = vs.length;
        const over = room.openings.find((o) => o.wallIndex === wall && t > o.offset - 0.1 && t < o.offset + o.width + 0.1);
        this.showReadout(e, `Wall light on wall ${wall + 1} · ${formatFtIn(t)} from corner ${wall + 1}, ${formatFtIn(L - t)} to corner ${((wall + 1) % n) + 1}${over ? ` · over a ${over.kind}` : ''}`);
      },
      end: (moved, cancelled) => {
        if (cancelled) store.cancelGesture();
        else store.endGesture('Move wall light', { room: true });
        if (!moved && !cancelled) this.onWallItemClick(id);
      },
    });
    return el;
  }

  /** Wall lights sit on the wall line; draw their handles just inside the room. */
  private placeSconces(): void {
    const { store, sm } = this.ctx;
    const room = store.layout.room;
    const vs = room.vertices;
    for (const f of room.features?.fixtures ?? []) {
      if (f.kind !== 'sconce') continue;
      const w = nearestWall(vs, f.position).index;
      const n = outwardNormal(vs, w);
      const a = sm.worldToScreen(f.position.x, 0, f.position.z);
      const b = sm.worldToScreen(f.position.x - n.x, 0, f.position.z - n.z);
      const k = 13 / (Math.hypot(b.x - a.x, b.y - a.y) || 1);
      const el = this.pool.get(`sc:${f.id}`, () => this.sconceHandle(f.id));
      el.title = `Wall light on wall ${w + 1} — drag along a wall to move it, tap to edit`;
      place(el, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    }
  }

  /** Outline every ceiling area and position its handles, plus the chandeliers. */
  private updateCeilingHandles(): void {
    const { store, sm } = this.ctx;
    const room = store.layout.room;
    const zones = room.features?.ceilings ?? [];
    const scr = (p: Vec2): ScreenPt => sm.worldToScreen(p.x, 0, p.z);
    const f1 = (n: number) => n.toFixed(1);
    let svg = '';
    zones.forEach((z, i) => {
      const pts = zoneCorners(z).map(scr);
      const truss = z.kind === 'vaulted';
      svg += `<polygon class="zone ${truss ? 'truss' : 'flat'}" points="${pts.map((p) => `${f1(p.x)},${f1(p.y)}`).join(' ')}"/>`;
      if (truss) {
        const a = scr(localToWorld(z.center, z.rotation, { x: -z.width / 2, z: 0 }));
        const b = scr(localToWorld(z.center, z.rotation, { x: z.width / 2, z: 0 }));
        svg += `<line class="ridge" x1="${f1(a.x)}" y1="${f1(a.y)}" x2="${f1(b.x)}" y2="${f1(b.y)}"/>`;
      }
      const c = scr(z.center);
      const label = this.pool.get(`zl:${z.id}`, () => this.zoneMoveHandle(z.id));
      const text = this.zoneLabelText(z, i + 1);
      if (label.textContent !== text) label.textContent = text;
      label.classList.toggle('truss', truss);
      label.title = `Ceiling area ${i + 1} — drag to move, tap to edit`;
      place(label, c.x, c.y);
      for (let e = 0; e < 4; e++) {
        const p0 = pts[e], p1 = pts[(e + 1) % 4];
        const el = this.pool.get(`ze:${z.id}:${e}`, () => this.zoneEdgeHandle(z.id, e));
        el.classList.toggle('truss', truss);
        el.style.transform = `translate(${Math.round((p0.x + p1.x) / 2)}px, ${Math.round((p0.y + p1.y) / 2)}px) rotate(${Math.atan2(p1.y - p0.y, p1.x - p0.x)}rad)`;
      }
    });
    if (this.svg.innerHTML !== svg) this.svg.innerHTML = svg;
    for (const f of room.features?.fixtures ?? []) {
      if (!isChandelier(f)) continue;
      const el = this.pool.get(`fx:${f.id}`, () => this.chandelierHandle(f.id));
      el.classList.toggle('iron', f.kind === 'iron-chandelier');
      el.classList.toggle('crystal', f.kind === 'crystal-chandelier');
      el.title = `${f.kind === 'iron-chandelier' ? 'Iron ring' : 'Crystal drum'} chandelier — drag to move, tap to edit`;
      const r = Math.max(9, (f.size / 2) * (sm.view === 'top' ? sm.top.ppm : 30));
      el.style.width = el.style.height = `${Math.round(Math.min(r * 2, 64))}px`;
      const p = scr(f.position);
      place(el, p.x, p.y);
    }
  }

  /** Position every room-editing handle for this frame. */
  private updateRoomHandles(): void {
    const { store, sm } = this.ctx;
    const room = store.layout.room;
    const vs = room.vertices;
    const n = vs.length;
    const scr = (p: Vec2): ScreenPt => sm.worldToScreen(p.x, 0, p.z);
    const angle = (a: ScreenPt, b: ScreenPt) => Math.atan2(b.y - a.y, b.x - a.x);
    const placeRot = (el: HTMLElement, p: ScreenPt, rad: number) => {
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) rotate(${rad}rad)`;
    };

    // walls: handle sits just inside the wall's midpoint
    for (let i = 0; i < n; i++) {
      const a = scr(vs[i]), b = scr(vs[(i + 1) % n]);
      const segPx = Math.hypot(b.x - a.x, b.y - a.y);
      if (segPx < 70 && this.handleDragId === null) continue;
      const mid = lerp2(vs[i], vs[(i + 1) % n], 0.5);
      const nrm = outwardNormal(vs, i);
      const ms = scr(mid);
      const ins = scr({ x: mid.x - nrm.x, z: mid.z - nrm.z });
      const k = 30 / (Math.hypot(ins.x - ms.x, ins.y - ms.y) || 1);
      const el = this.pool.get(`wh:${i}`, () => this.wallHandle(i));
      el.dataset.index = String(i);
      el.title = `Wall ${i + 1} — drag to move the whole wall in or out`;
      placeRot(el, { x: ms.x + (ins.x - ms.x) * k, y: ms.y + (ins.y - ms.y) * k }, angle(a, b));
    }

    // doors, windows & pilasters: a bar over each one plus resize grips at its ends.
    // Pilasters stand on the wall's inside face, so their bar sits that far into the room.
    for (const kind of ['opening', 'pilaster'] as const) {
      for (const o of this.wallItems(room, kind)) {
        if (o.wallIndex >= n) continue;
        const a = vs[o.wallIndex], b = vs[(o.wallIndex + 1) % n];
        const L = wallLength(vs, o.wallIndex) || 1;
        const inset = kind === 'pilaster' ? (o as Pilaster).depth : 0;
        const nrm = outwardNormal(vs, o.wallIndex);
        const at = (t: number) => {
          const q = lerp2(a, b, Math.min(1, Math.max(0, t / L)));
          return scr({ x: q.x - nrm.x * inset, z: q.z - nrm.z * inset });
        };
        const s0 = at(o.offset);
        const s1 = at(o.offset + o.width);
        const px = Math.hypot(s1.x - s0.x, s1.y - s0.y);
        const el = this.pool.get(`oh:${o.id}`, () => this.wallItemHandle(kind, o.id));
        if (kind === 'opening') {
          el.classList.toggle('door', (o as Opening).kind === 'door');
          el.classList.toggle('window', (o as Opening).kind === 'window');
        }
        el.style.width = `${Math.max(18, px)}px`;
        el.title = `${this.wallItemName(kind, o)} on wall ${o.wallIndex + 1} — drag along a wall to move it, tap to edit`;
        placeRot(el, { x: (s0.x + s1.x) / 2, y: (s0.y + s1.y) / 2 }, angle(s0, s1));
        if (px >= 34 || this.handleDragId !== null) {
          place(this.pool.get(`og0:${o.id}`, () => this.wallItemGrip(kind, o.id, 0)), s0.x, s0.y);
          place(this.pool.get(`og1:${o.id}`, () => this.wallItemGrip(kind, o.id, 1)), s1.x, s1.y);
        }
      }
    }

    // pillars
    for (const c of room.columns) {
      const el = this.pool.get(`ch:${c.id}`, () => this.columnHandle(c.id));
      place(el, scr(c.position).x, scr(c.position).y);
    }

    // corners last so they sit on top
    vs.forEach((v, i) => {
      const p = scr(v);
      const el = this.pool.get(`c:${i}`, () => this.cornerHandle(i));
      el.dataset.index = String(i);
      if (el.textContent !== String(i + 1)) el.textContent = String(i + 1);
      place(el, p.x, p.y);
    });
  }

  update(): void {
    const { store, sm } = this.ctx;
    const layout = store.layout;
    const s = store.settings;
    const walk = store.mode === 'walk';
    const { w: vw, h: vh } = sm.viewportSize;
    this.pool.begin();

    if (!walk) {
      const ppm = sm.view === 'top' ? sm.top.ppm : 30;
      // furniture labels
      if (s.showLabels) {
        for (const f of layout.furniture) {
          if (f.type === 'decoration' && ppm < 30 && store.selection.furnitureId !== f.id) continue;
          const p = sm.worldToScreen(f.position.x, f.height + 0.05, f.position.z);
          if (!p.visible || p.x < -100 || p.y < -100 || p.x > vw + 100 || p.y > vh + 100) continue;
          const el = this.pool.get(`f:${f.id}`, () => h('div', { class: 'plan-label' }, h('strong'), h('small')));
          const assigned = f.seats?.filter((x) => x.guestId).length ?? 0;
          const strong = el.firstChild as HTMLElement;
          const small = el.lastChild as HTMLElement;
          if (strong.textContent !== f.label) strong.textContent = f.label;
          const sub = f.seats?.length ? `${assigned}/${f.seats.length} seated` : '';
          if (small.textContent !== sub) small.textContent = sub;
          small.hidden = !sub || ppm < 9;
          el.classList.toggle('compact', ppm < 14);
          el.classList.toggle('selected', store.selection.furnitureId === f.id);
          place(el, p.x, p.y);
        }
      }
      // guest names at seats
      if (s.showNames && sm.view === 'top' && sm.top.ppm >= 38) {
        for (const f of layout.furniture) {
          if (!f.seats?.length) continue;
          for (const pose of seatPoses(f, layout.seating)) {
            const seat = f.seats.find((x) => x.id === pose.seatId);
            const g = guestById(layout, seat?.guestId);
            if (!g) continue;
            const out = 0.42;
            const p = sm.worldToScreen(pose.position.x - pose.facing.x * out, 0, pose.position.z - pose.facing.z * out);
            if (p.x < -80 || p.y < -40 || p.x > vw + 80 || p.y > vh + 40) continue;
            const el = this.pool.get(`n:${pose.seatId}`, () => h('div', { class: 'name-label' }));
            if (el.textContent !== g.name) el.textContent = g.name;
            el.classList.toggle('selected', store.selection.seatId === pose.seatId);
            place(el, p.x, p.y);
          }
        }
      }
      // warning badges (shape + icon so colour is not the only cue)
      for (const [id, ws] of sm.analysis.byFurniture) {
        if (!ws.some((w) => w.severity === 'warning')) continue;
        const f = layout.furniture.find((x) => x.id === id);
        if (!f) continue;
        const occ = occupiedFootprint(f, layout.seating);
        let r = 0;
        for (const q of occ) r = Math.max(r, dist(q, f.position));
        const p = sm.worldToScreen(f.position.x + r * 0.72, 0.1, f.position.z - r * 0.72);
        const el = this.pool.get(`w:${id}`, () => h('div', { class: 'warn-badge', title: '' }, svgIcon(ICONS.warn)));
        el.title = ws.map((w) => w.message).join('\n');
        place(el, p.x, p.y);
      }
      // wall dimensions
      const vs = layout.room.vertices;
      if (s.showDimensions || this.showWallNumbers) {
        for (let i = 0; i < vs.length; i++) {
          const a = vs[i], b = vs[(i + 1) % vs.length];
          const L = wallLength(vs, i);
          const n = outwardNormal(vs, i);
          const off = layout.room.wallThickness + (sm.view === 'top' ? 22 / sm.top.ppm : 0.6);
          const mid = lerp2(a, b, 0.5);
          const p = sm.worldToScreen(mid.x + n.x * off, 0, mid.z + n.z * off);
          const segPx = L * ppm;
          if (segPx < 38 && !this.showWallNumbers) continue;
          const el = this.pool.get(`d:${i}`, () => h('div', { class: 'dim-label' }));
          const text = `${this.showWallNumbers ? `Wall ${i + 1} · ` : ''}${formatFeetShort(L)}`;
          if (el.textContent !== text) el.textContent = text;
          place(el, p.x, p.y);
        }
      }
      // room editing handles: corners, walls, doors, windows, pillars
      if (this.editCorners) this.updateRoomHandles();
      if (this.editCeilings) this.updateCeilingHandles();
      if (this.editCorners || this.editCeilings) this.placeSconces();
      else if (this.svg.firstChild) this.svg.replaceChildren();
      // calibration taps
      const tool = this.ctx.editor.tool;
      if (tool.kind === 'calibrate') {
        tool.points.forEach((pt, i) => {
          const p = sm.worldToScreen(pt.x, 0, pt.z);
          const el = this.pool.get(`t:${i}`, () => h('div', { class: 'tap-marker' }));
          place(el, p.x, p.y);
        });
      }
    } else {
      if (this.svg.firstChild) this.svg.replaceChildren();
      // walkthrough: floating table names for nearby tables
      const cam = sm.walkCam.position;
      for (const f of layout.furniture) {
        if (!f.seats?.length && f.type !== 'cake' && f.type !== 'bar' && f.type !== 'dj') continue;
        const d = Math.hypot(f.position.x - cam.x, f.position.z - cam.z);
        if (d > 9 || d < 1.4 || this.ctx.walk.seatedTable === f.id) continue;
        const p = sm.worldToScreen(f.position.x, f.height + 0.85, f.position.z, sm.walkCam);
        if (!p.visible || p.x < 0 || p.y < 0 || p.x > vw || p.y > vh) continue;
        const el = this.pool.get(`wl:${f.id}`, () => h('div', { class: 'walk-label' }));
        if (el.textContent !== f.label) el.textContent = f.label;
        el.style.opacity = String(Math.max(0, Math.min(1, (9 - d) / 3)));
        place(el, p.x, p.y);
      }
    }
    this.pool.end();
    this.updateHud(walk);
    this.updateScaleBar(walk);
  }

  private updateHud(walk: boolean): void {
    const { store, sm } = this.ctx;
    const f = findFurniture(store.layout, store.selection.furnitureId);
    if (walk || !f || this.ctx.editor.tool.kind !== 'select') {
      this.hud.hidden = true;
      return;
    }
    const occ = occupiedFootprint(f, store.layout.seating);
    let minY = Infinity, maxY = -Infinity, sumX = 0;
    for (const q of occ) {
      const p = sm.worldToScreen(q.x, f.height, q.z);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
      sumX += p.x;
    }
    const cx = sumX / occ.length;
    const { w, h: vh } = sm.viewportSize;
    const hudW = this.hud.offsetWidth || 260;
    const hudH = this.hud.offsetHeight || 48;
    let y = minY - hudH - 12;
    if (y < 8) y = maxY + 12;
    if (y + hudH > vh - 8) y = Math.max(8, Math.min(vh - hudH - 8, minY - hudH - 12));
    const x = Math.max(8, Math.min(w - hudW - 8, cx - hudW / 2));
    this.hud.hidden = false;
    place(this.hud, x, y);
  }

  private updateScaleBar(walk: boolean): void {
    const { sm } = this.ctx;
    const show = !walk && sm.view === 'top';
    this.scaleBar.hidden = !show;
    if (!show) return;
    const ppm = sm.top.ppm;
    const target = 110;
    const candidates = [1, 2, 5, 10, 20, 25, 50, 100];
    let feet = candidates[0];
    for (const c of candidates) if (ft(c) * ppm <= target * 1.4) feet = c;
    const px = ft(feet) * ppm;
    (this.scaleBar.firstChild as HTMLElement).style.width = `${px}px`;
    const text = `${feet} ft`;
    if (this.scaleText.textContent !== text) this.scaleText.textContent = text;
  }
}

const sqFt = (room: Room): string => Math.round(polygonArea(room.vertices) / (ft(1) * ft(1))).toLocaleString();
