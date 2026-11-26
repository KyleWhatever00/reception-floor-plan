import type { Layout, Project, Settings } from './types';
import { findFurniture, findSeat } from './commands';

export type ChangeKind = 'layout' | 'settings' | 'project' | 'selection' | 'history' | 'mode';

export interface ChangeEvent {
  kind: ChangeKind;
  /** True while a drag/gesture is in progress (not yet committed to history). */
  transient?: boolean;
  /** True when the room geometry may have changed. */
  room?: boolean;
}

export type AppMode = 'build' | 'walk';

export interface Selection {
  furnitureId: string | null;
  seatId: string | null;
}

interface HistoryEntry {
  label: string;
  snapshot: string;
}

interface LayoutHistory {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

const HISTORY_LIMIT = 100;

/**
 * Single source of truth for the project. Both the 2D editor and the 3D walkthrough render from
 * `store.layout`; no other copies of furniture positions exist.
 */
export class Store {
  project: Project;
  selection: Selection = { furnitureId: null, seatId: null };
  mode: AppMode = 'build';
  private listeners = new Set<(e: ChangeEvent) => void>();
  private histories = new Map<string, LayoutHistory>();
  private gesture: { before: string; layoutId: string } | null = null;

  constructor(project: Project) {
    this.project = project;
  }

  get layout(): Layout {
    return this.project.layouts.find((l) => l.id === this.project.activeLayoutId) ?? this.project.layouts[0];
  }

  get settings(): Settings {
    return this.project.settings;
  }

  subscribe(fn: (e: ChangeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: ChangeEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }

  private hist(): LayoutHistory {
    const id = this.layout.id;
    let h = this.histories.get(id);
    if (!h) {
      h = { undo: [], redo: [] };
      this.histories.set(id, h);
    }
    return h;
  }

  private pushHistory(label: string, snapshot: string): void {
    const h = this.hist();
    h.undo.push({ label, snapshot });
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift();
    h.redo = [];
  }

  /** Apply a meaningful edit as one undoable step. */
  apply<T>(label: string, fn: (l: Layout) => T, opts: { room?: boolean } = {}): T {
    if (this.gesture) this.endGesture(label);
    const before = JSON.stringify(this.layout);
    const result = fn(this.layout);
    if (JSON.stringify(this.layout) !== before) {
      this.pushHistory(label, before);
      this.validateSelection();
      this.emit({ kind: 'layout', room: opts.room });
      this.emit({ kind: 'history' });
    }
    return result;
  }

  /** Start a continuous edit (drag, rotate handle). Changes during the gesture are not recorded individually. */
  beginGesture(): void {
    if (this.gesture) return;
    this.gesture = { before: JSON.stringify(this.layout), layoutId: this.layout.id };
  }

  get inGesture(): boolean {
    return this.gesture !== null;
  }

  applyTransient(fn: (l: Layout) => void, opts: { room?: boolean } = {}): void {
    if (!this.gesture) this.beginGesture();
    fn(this.layout);
    this.emit({ kind: 'layout', transient: true, room: opts.room });
  }

  /** Commit the gesture as a single history entry (if anything changed). */
  endGesture(label: string, opts: { room?: boolean } = {}): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.layoutId !== this.layout.id) return;
    if (JSON.stringify(this.layout) !== g.before) {
      this.pushHistory(label, g.before);
      this.emit({ kind: 'layout', room: opts.room });
      this.emit({ kind: 'history' });
    }
  }

  cancelGesture(): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (g.layoutId !== this.layout.id) return;
    this.replaceActiveLayout(JSON.parse(g.before));
    this.emit({ kind: 'layout', room: true });
  }

  private replaceActiveLayout(l: Layout): void {
    const i = this.project.layouts.findIndex((x) => x.id === this.layout.id);
    this.project.layouts[i] = l;
  }

  get canUndo(): boolean {
    return this.hist().undo.length > 0;
  }
  get canRedo(): boolean {
    return this.hist().redo.length > 0;
  }
  get undoLabel(): string | undefined {
    const u = this.hist().undo;
    return u[u.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    const r = this.hist().redo;
    return r[r.length - 1]?.label;
  }

  undo(): string | undefined {
    if (this.gesture) this.cancelGesture();
    const h = this.hist();
    const e = h.undo.pop();
    if (!e) return;
    h.redo.push({ label: e.label, snapshot: JSON.stringify(this.layout) });
    this.replaceActiveLayout(JSON.parse(e.snapshot));
    this.validateSelection();
    this.emit({ kind: 'layout', room: true });
    this.emit({ kind: 'history' });
    return e.label;
  }

  redo(): string | undefined {
    if (this.gesture) this.cancelGesture();
    const h = this.hist();
    const e = h.redo.pop();
    if (!e) return;
    h.undo.push({ label: e.label, snapshot: JSON.stringify(this.layout) });
    this.replaceActiveLayout(JSON.parse(e.snapshot));
    this.validateSelection();
    this.emit({ kind: 'layout', room: true });
    this.emit({ kind: 'history' });
    return e.label;
  }

  updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.project.settings, patch);
    this.emit({ kind: 'settings' });
  }

  select(furnitureId: string | null, seatId: string | null = null): void {
    if (this.selection.furnitureId === furnitureId && this.selection.seatId === seatId) return;
    this.selection = { furnitureId, seatId };
    this.emit({ kind: 'selection' });
  }

  private validateSelection(): void {
    const { furnitureId, seatId } = this.selection;
    if (furnitureId && !findFurniture(this.layout, furnitureId)) this.selection = { furnitureId: null, seatId: null };
    else if (seatId && !findSeat(this.layout, seatId)) this.selection = { furnitureId, seatId: null };
    this.emit({ kind: 'selection' });
  }

  setMode(mode: AppMode): void {
    if (this.mode === mode) return;
    if (this.gesture) this.endGesture('Edit');
    this.mode = mode;
    this.emit({ kind: 'mode' });
  }

  // ----- layout variants (not part of per-layout undo) -----

  switchLayout(id: string): void {
    if (!this.project.layouts.some((l) => l.id === id) || id === this.project.activeLayoutId) return;
    if (this.gesture) this.endGesture('Edit');
    this.project.activeLayoutId = id;
    this.selection = { furnitureId: null, seatId: null };
    this.emit({ kind: 'project' });
  }

  addLayout(l: Layout, activate = true): void {
    this.project.layouts.push(l);
    if (activate) this.project.activeLayoutId = l.id;
    this.selection = { furnitureId: null, seatId: null };
    this.emit({ kind: 'project' });
  }

  renameLayout(id: string, name: string): void {
    const l = this.project.layouts.find((x) => x.id === id);
    if (!l || !name.trim()) return;
    l.name = name.trim().slice(0, 120);
    this.emit({ kind: 'project' });
  }

  deleteLayout(id: string): boolean {
    if (this.project.layouts.length <= 1) return false;
    this.project.layouts = this.project.layouts.filter((l) => l.id !== id);
    this.histories.delete(id);
    if (this.project.activeLayoutId === id) this.project.activeLayoutId = this.project.layouts[0].id;
    this.selection = { furnitureId: null, seatId: null };
    this.emit({ kind: 'project' });
    return true;
  }

  replaceProject(p: Project): void {
    this.gesture = null;
    this.project = p;
    this.histories.clear();
    this.selection = { furnitureId: null, seatId: null };
    this.emit({ kind: 'project' });
    this.emit({ kind: 'settings' });
    this.emit({ kind: 'history' });
  }
}
