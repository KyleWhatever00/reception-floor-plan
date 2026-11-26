import type { Furniture, Vec2 } from '../model/types';
import type { Store } from '../model/store';
import type { SceneManager } from '../scene/sceneManager';
import { dist, pointInPolygon, polygonBounds, polygonDistance, worldToLocal, v2 } from '../model/geometry';
import { isRoundShape, seatPoses } from '../model/seats';
import { inch, normalizeAngle, deg, ft } from '../model/units';
import { paletteItem } from '../model/catalog';
import { addFurniture, deleteFurniture, duplicateFurniture, findFurniture, prepareNew } from '../model/commands';
import { occupiedFootprint } from '../model/warnings';
import { isTypingTarget } from '../ui/dom';
import { confirmDialog, isDialogOpen, toast } from '../ui/dialogs';

export interface PickResult {
  furnitureId: string;
  seatId: string | null;
}

export type Tool =
  | { kind: 'select' }
  | { kind: 'spawn' }
  | { kind: 'calibrate'; points: Vec2[]; onDone: (a: Vec2, b: Vec2) => void };

type PointerState = { id: number; x: number; y: number; sx: number; sy: number; type: string };

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pressObject'; id: string; grab: Vec2 }
  | { kind: 'dragObject'; id: string; grab: Vec2 }
  | { kind: 'pressEmpty' }
  | { kind: 'pan' }
  | { kind: 'pinch'; d0: number; mx: number; my: number }
  | { kind: 'ignore' };

/**
 * Build-mode input: selection, dragging, snapping, pan/zoom (mouse, trackpad and touch).
 * All edits go through the store so the 3D walkthrough always sees the same layout.
 */
export class Editor {
  tool: Tool = { kind: 'select' };
  onToolChange: (t: Tool) => void = () => {};
  private pointers = new Map<number, PointerState>();
  private gesture: Gesture = { kind: 'idle' };
  private canvas: HTMLCanvasElement;
  private hoverRaf = 0;

  constructor(private store: Store, private sm: SceneManager, private surface: HTMLElement) {
    this.canvas = sm.renderer.domElement;
    // capture phase so we can claim object drags before OrbitControls sees the event
    surface.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    surface.addEventListener('pointermove', (e) => this.onMove(e));
    surface.addEventListener('pointerup', (e) => this.onUp(e, false));
    surface.addEventListener('pointercancel', (e) => this.onUp(e, true));
    surface.addEventListener('lostpointercapture', (e) => {
      if (this.pointers.has(e.pointerId)) this.onUp(e, false);
    });
    surface.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari trackpad pinch
    let gScale = 1;
    surface.addEventListener('gesturestart', ((e: any) => {
      e.preventDefault();
      gScale = 1;
    }) as EventListener);
    surface.addEventListener('gesturechange', ((e: any) => {
      e.preventDefault();
      if (this.store.mode !== 'build' || this.sm.view !== 'top') return;
      const r = this.canvas.getBoundingClientRect();
      this.sm.zoomTopAt(e.scale / gScale, e.clientX - r.left, e.clientY - r.top);
      gScale = e.scale;
    }) as EventListener);
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('blur', () => this.abortGestures());
  }

  setTool(t: Tool): void {
    this.tool = t;
    this.surface.classList.toggle('tool-active', t.kind !== 'select');
    this.onToolChange(t);
  }

  get snapEnabled(): boolean {
    return this.store.settings.snapEnabled;
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private pickTolerance(type: string): number {
    const px = type === 'touch' ? 12 : 4;
    return this.sm.view === 'top' ? px / this.sm.top.ppm : 0.08;
  }

  /** What is under a floor point? Chairs first, then the smallest item containing the point. */
  pick(p: Vec2, tol = 0): PickResult | null {
    const l = this.store.layout;
    const cfg = l.seating;
    let best: { r: PickResult; d: number } | null = null;
    for (const f of l.furniture) {
      if (!f.seats?.length) continue;
      for (const s of seatPoses(f, cfg)) {
        const d = dist(p, s.position);
        const r = Math.max(cfg.chairWidth, cfg.chairDepth) / 2 + tol * 0.5;
        if (d <= r && (!best || d < best.d)) best = { r: { furnitureId: f.id, seatId: s.seatId }, d };
      }
    }
    if (best) return best.r;
    let hit: { f: Furniture; area: number } | null = null;
    for (const f of l.furniture) {
      let inside: boolean;
      if (isRoundShape(f)) inside = dist(p, f.position) <= f.width / 2 + tol;
      else {
        const q = worldToLocal(f.position, f.rotation, p);
        inside = Math.abs(q.x) <= f.width / 2 + tol && Math.abs(q.z) <= f.depth / 2 + tol;
      }
      if (!inside) continue;
      const area = f.width * f.depth;
      if (!hit || area < hit.area) hit = { f, area };
    }
    return hit ? { furnitureId: hit.f.id, seatId: null } : null;
  }

  /** Snap so that axis-aligned edges land on the grid (centre snapping when rotated). */
  snapPosition(f: Furniture, p: Vec2, force = false): Vec2 {
    if (!this.snapEnabled && !force) return p;
    const step = inch(this.store.settings.snapInches);
    const o = this.store.layout.room.vertices[0];
    const snap = (v: number, origin: number) => origin + Math.round((v - origin) / step) * step;
    const r = normalizeAngle(f.rotation);
    const quarter = Math.abs(Math.round(r / (Math.PI / 2)) * (Math.PI / 2) - r) < 1e-3;
    if (!quarter || isRoundShape(f)) {
      const hx = isRoundShape(f) ? f.width / 2 : 0;
      return v2(snap(p.x - hx, o.x) + hx, snap(p.z - hx, o.z) + hx);
    }
    const swap = Math.abs(Math.sin(r)) > 0.5;
    const hx = (swap ? f.depth : f.width) / 2;
    const hz = (swap ? f.width : f.depth) / 2;
    return v2(snap(p.x - hx, o.x) + hx, snap(p.z - hz, o.z) + hz);
  }

  snapAngle(a: number, free = false): number {
    if (!this.snapEnabled || free) return normalizeAngle(a);
    const step = deg(this.store.settings.rotationSnapDeg || 15);
    return normalizeAngle(Math.round(a / step) * step);
  }

  // -------------------------------------------------------------- pointer handling

  private onDown(e: PointerEvent): void {
    if (this.store.mode !== 'build') return;
    if (e.target !== this.canvas) return;
    const pt = this.local(e);
    if (e.pointerType === 'mouse' && e.button !== 0) {
      if (this.sm.view === 'top') {
        this.pointers.set(e.pointerId, { id: e.pointerId, ...pt, sx: pt.x, sy: pt.y, type: e.pointerType });
        this.canvas.setPointerCapture(e.pointerId);
        this.gesture = { kind: 'pan' };
        e.preventDefault();
      }
      return;
    }
    this.pointers.set(e.pointerId, { id: e.pointerId, ...pt, sx: pt.x, sy: pt.y, type: e.pointerType });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (this.pointers.size === 2) {
      if (this.gesture.kind === 'dragObject') this.store.cancelGesture();
      if (this.sm.view === 'top') {
        const [a, b] = [...this.pointers.values()];
        this.gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      } else this.gesture = { kind: 'ignore' };
      this.sm.orbit.enabled = this.sm.view === 'orbit';
      return;
    }
    if (this.pointers.size > 2) return;

    const floor = this.sm.screenToFloor(pt.x, pt.y);
    if (!floor) return;
    if (this.tool.kind === 'spawn') {
      if (!pointInPolygon(floor, this.store.layout.room.vertices)) {
        toast('Choose a spot inside the room.', { kind: 'error' });
      } else {
        this.store.apply('Set walkthrough entrance', (l) => (l.room.spawn = floor), { room: false });
        toast('Walkthrough entrance set.');
      }
      this.setTool({ kind: 'select' });
      this.gesture = { kind: 'ignore' };
      return;
    }
    if (this.tool.kind === 'calibrate') {
      this.tool.points.push(floor);
      if (this.tool.points.length === 2) {
        const [a, b] = this.tool.points;
        const done = this.tool.onDone;
        this.setTool({ kind: 'select' });
        done(a, b);
      } else this.onToolChange(this.tool);
      this.gesture = { kind: 'ignore' };
      return;
    }
    const hit = this.pick(floor, this.pickTolerance(e.pointerType));
    if (hit) {
      this.store.select(hit.furnitureId, hit.seatId);
      const f = findFurniture(this.store.layout, hit.furnitureId)!;
      this.gesture = { kind: 'pressObject', id: f.id, grab: v2(floor.x - f.position.x, floor.z - f.position.z) };
      if (this.sm.view === 'orbit') this.sm.orbit.enabled = false;
      e.preventDefault();
    } else {
      this.gesture = { kind: 'pressEmpty' };
    }
  }

  private onMove(e: PointerEvent): void {
    if (this.store.mode !== 'build') return;
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && e.buttons === 0) this.updateHover(e);
      return;
    }
    const pt = this.local(e);
    const dx = pt.x - p.x;
    const dy = pt.y - p.y;
    p.x = pt.x;
    p.y = pt.y;
    const g = this.gesture;
    const moved = Math.hypot(pt.x - p.sx, pt.y - p.sy);
    const threshold = p.type === 'touch' ? 8 : 4;
    switch (g.kind) {
      case 'pinch': {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        if (g.d0 > 0) this.sm.zoomTopAt(d / g.d0, mx, my);
        this.sm.panTopPixels(mx - g.mx, my - g.my);
        g.d0 = d;
        g.mx = mx;
        g.my = my;
        return;
      }
      case 'pressObject':
        if (moved < threshold) return;
        this.store.beginGesture();
        this.gesture = { kind: 'dragObject', id: g.id, grab: g.grab };
        this.surface.classList.add('dragging');
        this.dragTo(g.id, g.grab, pt, e.altKey);
        return;
      case 'dragObject':
        this.dragTo(g.id, g.grab, pt, e.altKey);
        return;
      case 'pressEmpty':
        if (moved < threshold) return;
        if (this.sm.view !== 'top') {
          this.gesture = { kind: 'ignore' };
          return;
        }
        this.gesture = { kind: 'pan' };
        this.surface.classList.add('panning');
        this.sm.panTopPixels(pt.x - p.sx, pt.y - p.sy);
        return;
      case 'pan':
        this.sm.panTopPixels(dx, dy);
        return;
    }
  }

  private dragTo(id: string, grab: Vec2, pt: { x: number; y: number }, free: boolean): void {
    const floor = this.sm.screenToFloor(pt.x, pt.y);
    const f = findFurniture(this.store.layout, id);
    if (!floor || !f) return;
    const raw = v2(floor.x - grab.x, floor.z - grab.z);
    const target = free ? raw : this.snapPosition(f, raw);
    if (target.x === f.position.x && target.z === f.position.z) return;
    this.store.applyTransient((l) => {
      const ff = findFurniture(l, id);
      if (ff) ff.position = target;
    });
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const g = this.gesture;
    if (g.kind === 'dragObject') {
      if (cancelled) this.store.cancelGesture();
      else {
        const f = findFurniture(this.store.layout, g.id);
        this.store.endGesture(`Move ${f?.label ?? 'item'}`);
      }
    } else if (g.kind === 'pressEmpty' && !cancelled) {
      this.store.select(null);
    }
    if (this.pointers.size === 0) {
      this.gesture = { kind: 'idle' };
      this.surface.classList.remove('dragging', 'panning');
      if (this.sm.view === 'orbit' && this.store.mode === 'build') this.sm.orbit.enabled = true;
    } else if (g.kind === 'pinch') {
      this.gesture = { kind: 'ignore' };
    }
  }

  abortGestures(): void {
    if (this.gesture.kind === 'dragObject') this.store.endGesture('Move item');
    this.pointers.clear();
    this.gesture = { kind: 'idle' };
    this.surface.classList.remove('dragging', 'panning');
  }

  private updateHover(e: PointerEvent): void {
    if (this.hoverRaf) return;
    this.hoverRaf = requestAnimationFrame(() => {
      this.hoverRaf = 0;
      const pt = this.local(e);
      const floor = this.sm.screenToFloor(pt.x, pt.y);
      const hit = floor && this.tool.kind === 'select' ? this.pick(floor, this.pickTolerance('mouse')) : null;
      this.surface.classList.toggle('hover-object', !!hit);
    });
  }

  private onWheel(e: WheelEvent): void {
    if (this.store.mode !== 'build' || this.sm.view !== 'top') return;
    e.preventDefault();
    const pt = this.local(e);
    const pixelMode = e.deltaMode === 0;
    const looksLikeMouseWheel = !pixelMode || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey || looksLikeMouseWheel) {
      const dy = pixelMode ? e.deltaY : e.deltaY * 33;
      this.sm.zoomTopAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), pt.x, pt.y);
    } else {
      this.sm.panTopPixels(-e.deltaX, -e.deltaY);
    }
  }

  // -------------------------------------------------------------- commands

  /** Centre of what the user is looking at. */
  viewCenter(): Vec2 {
    if (this.sm.view === 'top') return v2(this.sm.top.cx, this.sm.top.cz);
    return v2(this.sm.orbit.target.x, this.sm.orbit.target.z);
  }

  /** Find a nearby spot where the new item does not collide with anything. */
  findFreeSpot(f: Furniture, start: Vec2): Vec2 {
    const l = this.store.layout;
    const room = l.room.vertices;
    const others = l.furniture.map((o) => occupiedFootprint(o, l.seating));
    const fits = (p: Vec2) => {
      const test = { ...f, position: p };
      const occ = occupiedFootprint(test, l.seating);
      if (!occ.every((q) => pointInPolygon(q, room))) return false;
      return others.every((o) => polygonDistance(occ, o) > inch(18));
    };
    const s0 = this.snapPosition(f, start, true);
    if (fits(s0)) return s0;
    const b = polygonBounds(room);
    const maxR = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ);
    for (let r = 0.3; r < maxR; r += 0.3) {
      const n = Math.max(8, Math.ceil((2 * Math.PI * r) / 0.4));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const p = this.snapPosition(f, v2(start.x + Math.cos(a) * r, start.z + Math.sin(a) * r), true);
        if (fits(p)) return p;
      }
    }
    return s0;
  }

  /** Add a palette item. With `at`, drop it exactly there; otherwise find a free spot near the view centre. */
  addFromPalette(key: string, at?: Vec2): Furniture | undefined {
    const item = paletteItem(key);
    if (!item) return;
    const l = this.store.layout;
    const f = prepareNew(l, item.create(at ?? this.viewCenter()));
    f.position = at ? this.snapPosition(f, at) : this.findFreeSpot(f, this.viewCenter());
    this.store.apply(`Add ${f.label}`, (layout) => addFurniture(layout, f));
    this.store.select(f.id);
    return f;
  }

  rotateSelected(delta: number): void {
    const id = this.store.selection.furnitureId;
    const f = findFurniture(this.store.layout, id);
    if (!f) return;
    this.store.apply(`Rotate ${f.label}`, (l) => {
      const ff = findFurniture(l, id)!;
      ff.rotation = this.snapAngle(ff.rotation + delta, !this.snapEnabled);
    });
  }

  duplicateSelected(): void {
    const id = this.store.selection.furnitureId;
    const f = findFurniture(this.store.layout, id);
    if (!f) return;
    let created: Furniture | undefined;
    this.store.apply(`Duplicate ${f.label}`, (l) => {
      created = duplicateFurniture(l, f.id);
      if (created) {
        const others = l.furniture.filter((o) => o.id !== created!.id);
        l.furniture = others;
        created.position = this.findFreeSpot(created, v2(f.position.x + ft(2), f.position.z + ft(2)));
        l.furniture.push(created);
      }
    });
    if (created) this.store.select(created.id);
  }

  async deleteSelected(): Promise<void> {
    const id = this.store.selection.furnitureId;
    const f = findFurniture(this.store.layout, id);
    if (!f) return;
    const seated = (f.seats ?? []).filter((s) => s.guestId).length;
    if (seated > 0) {
      const ok = await confirmDialog(
        `Delete ${f.label}?`,
        `${seated} seated guest${seated === 1 ? '' : 's'} will move to the unassigned list. Their names are kept.`,
        'Delete table',
        true,
      );
      if (!ok) return;
    }
    this.store.apply(`Delete ${f.label}`, (l) => deleteFurniture(l, f.id));
    toast(`Deleted ${f.label}.`, { action: { label: 'Undo', onClick: () => this.store.undo() } });
  }

  nudgeSelected(dx: number, dz: number): void {
    const id = this.store.selection.furnitureId;
    const f = findFurniture(this.store.layout, id);
    if (!f) return;
    this.store.apply(`Move ${f.label}`, (l) => {
      const ff = findFurniture(l, id)!;
      ff.position = v2(ff.position.x + dx, ff.position.z + dz);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.store.mode !== 'build' || isTypingTarget(e.target) || isDialogOpen()) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    if (mod && key.toLowerCase() === 'z') {
      e.preventDefault();
      const label = e.shiftKey ? this.store.redo() : this.store.undo();
      if (label) toast(`${e.shiftKey ? 'Redid' : 'Undid'}: ${label}`, { ms: 1800 });
      return;
    }
    if (mod && key.toLowerCase() === 'y') {
      e.preventDefault();
      const label = this.store.redo();
      if (label) toast(`Redid: ${label}`, { ms: 1800 });
      return;
    }
    if (mod && key.toLowerCase() === 'd') {
      e.preventDefault();
      this.duplicateSelected();
      return;
    }
    if (mod) return;
    const sel = this.store.selection.furnitureId;
    const step = e.shiftKey ? ft(1) : inch(this.store.settings.snapEnabled ? this.store.settings.snapInches : 1);
    switch (key) {
      case 'Escape':
        if (this.tool.kind !== 'select') this.setTool({ kind: 'select' });
        else this.store.select(null);
        break;
      case 'Delete':
      case 'Backspace':
        if (sel) {
          e.preventDefault();
          void this.deleteSelected();
        }
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (!sel) return;
        e.preventDefault();
        this.nudgeSelected(key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0);
        break;
      case 'r':
      case 'R':
        if (sel) this.rotateSelected(deg(e.shiftKey ? -15 : 15));
        break;
      case 'q':
        if (sel) this.rotateSelected(deg(15));
        break;
      case 'e':
        if (sel) this.rotateSelected(deg(-15));
        break;
      case 'f':
        this.sm.fitTopView();
        break;
      case '=':
      case '+':
        this.sm.zoomTopAt(1.25, this.sm.viewportSize.w / 2, this.sm.viewportSize.h / 2);
        break;
      case '-':
      case '_':
        this.sm.zoomTopAt(0.8, this.sm.viewportSize.w / 2, this.sm.viewportSize.h / 2);
        break;
    }
  }
}
