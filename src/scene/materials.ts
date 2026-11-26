import * as THREE from 'three';
import type { ChairFinish, DanceFloorMaterial } from '../model/types';

/** Shared colours for the blush / ivory / black palette. */
export const COLORS = {
  ivory: 0xfbf8f3,
  linen: 0xf8f6f2,
  blush: 0xecc8c4,
  rose: 0xd8a2a3,
  deepRose: 0xb9787d,
  greenery: 0x7d8f6e,
  eucalyptus: 0x9fb09a,
  black: 0x1f1b1a,
  gold: 0xc8a96a,
  wall: 0xf1e9df,
  trim: 0xfdfbf7,
  floorBase: 0xc9a57c,
  ground: 0xb9c4a2,
  selection: 0xd2737d,
  warning: 0xd9822b,
};

const cache = new Map<string, THREE.Material>();

export function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = cache.get(key);
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m;
}

export const std = (color: number | string, roughness = 0.8, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) =>
  mat(`std:${color}:${roughness}:${metalness}:${JSON.stringify(extra)}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));

export function linenMaterial(color: string | undefined): THREE.Material {
  const c = color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#f8f6f2';
  return mat(`linen:${c}`, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0, map: linenTexture() }));
}

export function chairColors(finish: ChairFinish): { frame: number; cushion: number; metal: number; rough: number } {
  switch (finish) {
    case 'white':
      return { frame: 0xf4f1ec, cushion: 0xf8f4ee, metal: 0, rough: 0.55 };
    case 'black':
      return { frame: 0x1e1b1a, cushion: 0xf2ece4, metal: 0.1, rough: 0.45 };
    case 'wood':
      return { frame: 0x8a6142, cushion: 0xf2ece4, metal: 0, rough: 0.7 };
    case 'clear':
      return { frame: 0xdde3e6, cushion: 0xf8f4ee, metal: 0, rough: 0.15 };
    default:
      return { frame: 0xd6b878, cushion: 0xf6efe4, metal: 0.25, rough: 0.42 };
  }
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const texCache = new Map<string, THREE.Texture>();
function cachedTex(key: string, make: () => THREE.Texture): THREE.Texture {
  let t = texCache.get(key);
  if (!t) {
    t = make();
    texCache.set(key, t);
  }
  return t;
}

/** Subtle weave so linens are not flat. */
function linenTexture(): THREE.Texture {
  return cachedTex('linen', () =>
    canvasTexture(64, (ctx, s) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < s; i += 2) {
        ctx.fillStyle = `rgba(0,0,0,${0.015 + (i % 4 === 0 ? 0.01 : 0)})`;
        ctx.fillRect(i, 0, 1, s);
        ctx.fillRect(0, i, s, 1);
      }
    }),
  );
}

/** Warm wood plank floor; one texture tile = 2 m. */
export function plankTexture(): THREE.Texture {
  return cachedTex('planks', () =>
    canvasTexture(512, (ctx, s) => {
      const rows = 12;
      const h = s / rows;
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * s * 0.5;
        while (x < s) {
          const w = s * (0.35 + rnd() * 0.4);
          const shade = 0.88 + rnd() * 0.18;
          const base = [204, 176, 142].map((c) => Math.round(c * shade));
          ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
          ctx.fillRect(x, r * h, w, h);
          ctx.strokeStyle = 'rgba(60,40,25,0.10)';
          for (let g = 0; g < 5; g++) {
            const y = r * h + rnd() * h;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.bezierCurveTo(x + w * 0.3, y + rnd() * 3 - 1.5, x + w * 0.6, y + rnd() * 3 - 1.5, x + w, y);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(60,40,25,0.35)';
          ctx.fillRect(x, r * h, 1.5, h);
          x += w;
        }
        ctx.fillStyle = 'rgba(60,40,25,0.4)';
        ctx.fillRect(0, r * h, s, 1.5);
      }
    }),
  );
}

export function danceFloorTexture(kind: DanceFloorMaterial): THREE.Texture | null {
  if (kind === 'white' || kind === 'black') {
    return cachedTex(`dance:${kind}`, () =>
      canvasTexture(256, (ctx, s) => {
        ctx.fillStyle = kind === 'white' ? '#f7f5f2' : '#1c1a1a';
        ctx.fillRect(0, 0, s, s);
        ctx.strokeStyle = kind === 'white' ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.10)';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, s - 2, s - 2);
      }),
    );
  }
  if (kind === 'checker') {
    return cachedTex('dance:checker', () =>
      canvasTexture(256, (ctx, s) => {
        const h = s / 2;
        ctx.fillStyle = '#f6f3ef';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#1f1b1a';
        ctx.fillRect(h, 0, h, h);
        ctx.fillRect(0, h, h, h);
      }),
    );
  }
  return cachedTex('dance:wood', () =>
    canvasTexture(256, (ctx, s) => {
      const n = 4;
      const q = s / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          const light = (i + j) % 2 === 0;
          ctx.fillStyle = light ? '#c99a6b' : '#b3825a';
          ctx.fillRect(i * q, j * q, q, q);
          ctx.strokeStyle = 'rgba(70,40,20,0.25)';
          for (let k = 1; k < 4; k++) {
            ctx.beginPath();
            if (light) {
              ctx.moveTo(i * q, j * q + (k * q) / 4);
              ctx.lineTo(i * q + q, j * q + (k * q) / 4);
            } else {
              ctx.moveTo(i * q + (k * q) / 4, j * q);
              ctx.lineTo(i * q + (k * q) / 4, j * q + q);
            }
            ctx.stroke();
          }
        }
    }),
  );
}

/** Texture with text, used for signs and table cards. */
export function textTexture(text: string, opts: { w?: number; h?: number; bg?: string; fg?: string; font?: string } = {}): THREE.CanvasTexture {
  const w = opts.w ?? 512;
  const h = opts.h ?? 384;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = opts.bg ?? '#fbf8f3';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c8a96a';
  ctx.lineWidth = 6;
  ctx.strokeRect(18, 18, w - 36, h - 36);
  ctx.fillStyle = opts.fg ?? '#1f1b1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let size = 72;
  ctx.font = `${size}px ${opts.font ?? '"Bodoni 72", Didot, "Times New Roman", serif'}`;
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > w - 90 && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > 3) {
    size = 52;
    ctx.font = `${size}px ${opts.font ?? '"Bodoni 72", Didot, "Times New Roman", serif'}`;
  }
  const lh = size * 1.15;
  lines.slice(0, 4).forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (Math.min(lines.length, 4) - 1) / 2) * lh));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Plank floor in a few finishes (one tile = 2.2 m). */
export function floorTexture(finish: 'honey-oak' | 'dark-walnut' | 'light-oak' = 'honey-oak'): THREE.Texture {
  if (finish === 'honey-oak') return plankTexture();
  const base = finish === 'dark-walnut' ? [92, 58, 40] : [214, 190, 160];
  return cachedTex(`planks:${finish}`, () =>
    canvasTexture(512, (ctx, s) => {
      const rows = 12;
      const h = s / rows;
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let r = 0; r < rows; r++) {
        let x = -rnd() * s * 0.5;
        while (x < s) {
          const w = s * (0.4 + rnd() * 0.45);
          const shade = 0.85 + rnd() * 0.25;
          const c = base.map((v) => Math.min(255, Math.round(v * shade)));
          ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
          ctx.fillRect(x, r * h, w, h);
          ctx.strokeStyle = finish === 'dark-walnut' ? 'rgba(20,10,5,0.22)' : 'rgba(90,60,30,0.10)';
          for (let g = 0; g < 6; g++) {
            const y = r * h + rnd() * h;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.bezierCurveTo(x + w * 0.3, y + rnd() * 3 - 1.5, x + w * 0.6, y + rnd() * 3 - 1.5, x + w, y);
            ctx.stroke();
          }
          ctx.fillStyle = 'rgba(15,8,4,0.45)';
          ctx.fillRect(x, r * h, 1.5, h);
          x += w;
        }
        ctx.fillStyle = 'rgba(15,8,4,0.5)';
        ctx.fillRect(0, r * h, s, 1.5);
      }
    }),
  );
}

/** Austin limestone blocks (one tile = 1.2 m). */
export function stoneTexture(): THREE.Texture {
  return cachedTex('stone', () =>
    canvasTexture(256, (ctx, s) => {
      let seed = 5;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      ctx.fillStyle = '#cdbfa8';
      ctx.fillRect(0, 0, s, s);
      const rows = 6;
      const h = s / rows;
      for (let r = 0; r < rows; r++) {
        let x = r % 2 ? -h * 0.8 : 0;
        while (x < s) {
          const w = h * (1.2 + rnd() * 1.3);
          const t = 0.86 + rnd() * 0.2;
          ctx.fillStyle = `rgb(${Math.round(214 * t)},${Math.round(199 * t)},${Math.round(176 * t)})`;
          ctx.fillRect(x + 2, r * h + 2, w - 4, h - 4);
          x += w;
        }
      }
    }),
  );
}

/** Tongue-and-groove pine ceiling boards (stripes along U). */
export function boardTexture(): THREE.Texture {
  return cachedTex('boards', () =>
    canvasTexture(256, (ctx, s) => {
      let seed = 3;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const n = 8;
      for (let i = 0; i < n; i++) {
        const t = 0.9 + rnd() * 0.14;
        ctx.fillStyle = `rgb(${Math.round(226 * t)},${Math.round(204 * t)},${Math.round(170 * t)})`;
        ctx.fillRect(0, (i * s) / n, s, s / n);
        ctx.fillStyle = 'rgba(90,60,30,0.25)';
        ctx.fillRect(0, (i * s) / n, s, 1.5);
      }
    }),
  );
}

/** Spiral duct rings. */
export function ductTexture(): THREE.Texture {
  return cachedTex('duct', () =>
    canvasTexture(64, (ctx, s) => {
      const g = ctx.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, '#9aa0a6');
      g.addColorStop(0.5, '#d9dde0');
      g.addColorStop(1, '#8d9399');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = 'rgba(40,45,50,0.35)';
      ctx.fillRect(0, 0, 3, s);
    }),
  );
}

/** Soft radial glow for wall-sconce light washes and bulbs. */
export function glowTexture(): THREE.Texture {
  return cachedTex('glow', () => {
    const t = canvasTexture(128, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,226,170,0.95)');
      g.addColorStop(0.35, 'rgba(255,214,150,0.45)');
      g.addColorStop(1, 'rgba(255,210,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }, false);
    return t;
  });
}

/** Sky gradient used as the walkthrough background. */
export function skyTexture(): THREE.Texture {
  return cachedTex('sky', () => {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#6fa6d8');
    g.addColorStop(0.45, '#a9cbe6');
    g.addColorStop(0.5, '#dfe9ef');
    g.addColorStop(1, '#dfe9ef');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  });
}
