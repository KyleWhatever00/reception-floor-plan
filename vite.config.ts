import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Emits dist/sw.js with a versioned precache list of every built file (no plugin dependency).
 * Paths are relative so the app works at a domain root or a GitHub Pages sub-path.
 */
function serviceWorker(): Plugin {
  let publicFiles: string[] = [];
  return {
    name: 'wfp-service-worker',
    apply: 'build',
    configResolved(config) {
      const dir = config.publicDir;
      const walk = (d: string): string[] =>
        readdirSync(d).flatMap((f: string) => {
          const p = join(d, f);
          return statSync(p).isDirectory() ? walk(p) : [relative(dir, p).split('\\').join('/')];
        });
      try {
        publicFiles = walk(dir).filter((f) => !f.startsWith('assets/venue/') && !f.endsWith('.md'));
      } catch {
        publicFiles = [];
      }
    },
    generateBundle(_opts, bundle) {
      const files = ['./', ...Object.keys(bundle).map((f) => `./${f}`), ...publicFiles.map((f) => `./${f}`)];
      const unique = [...new Set(files)].filter((f) => !f.endsWith('.map'));
      const hash = createHash('sha256');
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        hash.update(name);
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      const version = hash.digest('hex').slice(0, 12);
      const source = `/* Wedding Floor Plan service worker — generated at build time. */
const VERSION = ${JSON.stringify(version)};
const CACHE = 'wfp-shell-' + VERSION;
const PRECACHE = ${JSON.stringify(unique, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('wfp-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch external requests
  if (req.mode === 'navigate') {
    // network first so updates arrive promptly; fall back to the cached shell offline
    event.respondWith(
      fetch(req).catch(() => caches.open(CACHE).then((c) => c.match('./').then((r) => r || c.match('./index.html')))),
    );
    return;
  }
  event.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req))));
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base: the same build works at https://example.pages.dev/ and https://user.github.io/repo/
  base: './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 0,
  },
  server: { host: true },
  preview: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as any);
