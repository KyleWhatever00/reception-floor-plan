import type { Project } from '../model/types';
import type { Store } from '../model/store';
import { validateProject } from '../model/validation';

export const STORAGE_KEY = 'wfp.project.v1';
const BACKUP_KEY_PREFIX = 'wfp.corrupt.';

export type LoadResult =
  | { status: 'ok'; project: Project; warnings: string[] }
  | { status: 'empty' }
  | { status: 'corrupt'; raw: string; errors: string[] }
  | { status: 'unavailable'; error: string };

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__wfp_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function loadSavedProject(): LoadResult {
  const s = storage();
  if (!s) return { status: 'unavailable', error: 'This browser is not allowing the app to save (private browsing or storage disabled).' };
  let raw: string | null;
  try {
    raw = s.getItem(STORAGE_KEY);
  } catch (e) {
    return { status: 'unavailable', error: String(e) };
  }
  if (!raw) return { status: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'corrupt', raw, errors: ['The saved data is not valid JSON.'] };
  }
  const v = validateProject(data);
  if (!v.ok || !v.value) return { status: 'corrupt', raw, errors: v.errors };
  return { status: 'ok', project: v.value, warnings: v.warnings };
}

/** Keep a copy of unreadable data before anything overwrites it. */
export function quarantineCorrupt(raw: string): string | null {
  const s = storage();
  if (!s) return null;
  const key = `${BACKUP_KEY_PREFIX}${new Date().toISOString()}`;
  try {
    s.setItem(key, raw);
    return key;
  } catch {
    return null;
  }
}

export type SaveStatus = { state: 'saved' | 'saving' | 'error' | 'paused'; message?: string; at?: Date };

/** Debounced autosave of the whole project to localStorage. */
export class AutoSaver {
  status: SaveStatus = { state: 'saved' };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: SaveStatus) => void>();
  private paused = false;

  constructor(private store: Store, private delay = 700) {
    store.subscribe((e) => {
      if (e.transient) return;
      if (e.kind === 'layout' || e.kind === 'project' || e.kind === 'settings') this.schedule();
    });
    const flush = () => this.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  }

  onStatus(fn: (s: SaveStatus) => void): void {
    this.listeners.add(fn);
    fn(this.status);
  }

  private set(s: SaveStatus): void {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }

  /** While paused (e.g. unresolved corrupt data) nothing is written. */
  pause(message: string): void {
    this.paused = true;
    this.set({ state: 'paused', message });
  }

  resume(): void {
    this.paused = false;
    this.schedule();
  }

  schedule(): void {
    if (this.paused) return;
    if (this.timer) clearTimeout(this.timer);
    this.set({ state: 'saving' });
    this.timer = setTimeout(() => this.write(), this.delay);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.write();
    }
  }

  private write(): void {
    this.timer = null;
    if (this.paused) return;
    const s = storage();
    if (!s) {
      this.set({ state: 'error', message: 'Browser storage is unavailable — export a backup to keep your work.' });
      return;
    }
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(this.store.project));
      this.set({ state: 'saved', at: new Date() });
    } catch (e) {
      const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
      this.set({ state: 'error', message: quota ? 'Browser storage is full — export a backup now.' : `Could not save: ${String(e)}` });
    }
  }
}
