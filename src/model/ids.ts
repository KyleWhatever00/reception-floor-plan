/** Short random IDs. crypto.randomUUID is preferred when available. */
export function newId(prefix = ''): string {
  let core: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    core = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  } else {
    core = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
  return prefix ? `${prefix}_${core}` : core;
}
