/**
 * Optional offline support. The service worker is generated at build time (see vite.config.ts)
 * with a versioned list of the app's own files. It is never registered in development.
 */
export type PwaState = 'offline-ready' | 'update';

export function registerServiceWorker(onState: (s: PwaState) => void): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      const hadController = !!navigator.serviceWorker.controller;
      const watch = (w: ServiceWorker | null) => {
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed') {
            if (hadController && navigator.serviceWorker.controller) onState('update');
            else onState('offline-ready');
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) onState('update');
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      if (reg.active && !reg.installing && !reg.waiting) onState('offline-ready');
      // When the user chooses Reload, activate the waiting worker, then reload once it takes over.
      // (A first install also fires controllerchange via clients.claim(); that must NOT reload.)
      let reloadRequested = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!reloadRequested) return;
        reloadRequested = false;
        location.reload();
      });
      (window as any).__wfpActivateUpdate = () => {
        if (!reg.waiting) return location.reload();
        reloadRequested = true;
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      };
      // check for updates when the app comes back to the foreground
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
    } catch {
      /* offline support is best-effort */
    }
  });
}
