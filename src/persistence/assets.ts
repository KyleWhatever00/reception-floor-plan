/**
 * Local image store for reference overlays (floor-plan scans). Uses IndexedDB so large images do
 * not fill localStorage. Falls back to memory (lost on reload) if IndexedDB is unavailable.
 */
const DB_NAME = 'wfp-assets';
const STORE = 'images';
const memory = new Map<string, Blob>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve) => {
        if (!d) return resolve(undefined);
        try {
          const req = fn(d.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export async function assetsPersistent(): Promise<boolean> {
  return (await db()) !== null;
}

export async function putAsset(id: string, blob: Blob): Promise<boolean> {
  memory.set(id, blob);
  const r = await tx('readwrite', (s) => s.put(blob, id));
  return r !== undefined;
}

export async function getAsset(id: string): Promise<Blob | null> {
  if (memory.has(id)) return memory.get(id)!;
  const b = await tx<Blob>('readonly', (s) => s.get(id) as IDBRequest<Blob>);
  if (b) memory.set(id, b);
  return b ?? null;
}

export async function deleteAsset(id: string): Promise<void> {
  memory.delete(id);
  await tx('readwrite', (s) => s.delete(id));
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  const [head, data] = url.split(',');
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Downscale very large images so the browser stays responsive on iPad. */
export async function normalizeImage(file: Blob, maxSide = 4096): Promise<{ blob: Blob; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This image could not be read.'));
      i.src = url;
    });
    const w = img.naturalWidth, hgt = img.naturalHeight;
    const scale = Math.min(1, maxSide / Math.max(w, hgt));
    if (scale === 1 && file.size < 8_000_000) return { blob: file, width: w, height: hgt };
    const c = document.createElement('canvas');
    c.width = Math.round(w * scale);
    c.height = Math.round(hgt * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
    return { blob, width: c.width, height: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
