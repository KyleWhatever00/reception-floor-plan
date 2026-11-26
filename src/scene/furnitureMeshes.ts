import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Furniture, SeatingConfig } from '../model/types';
import { COLORS, danceFloorTexture, linenMaterial, mat, std, textTexture } from './materials';
import { isRoundShape } from '../model/seats';

/** Geometry reused across all furniture (keyed by shape + dimensions). */
const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Part = { g: THREE.BufferGeometry; color: number; at?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] };

/** Merge simple parts into one vertex-coloured geometry (one draw call). */
export function mergeColored(parts: Part[]): THREE.BufferGeometry {
  const prepared = parts.map((p) => {
    let g = p.g.clone();
    if (g.index) g = g.toNonIndexed();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(p.at ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(p.rot ?? [0, 0, 0]))),
      new THREE.Vector3(...(p.scale ?? [1, 1, 1])),
    );
    g.applyMatrix4(m);
    const c = new THREE.Color(p.color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return g;
  });
  const merged = mergeGeometries(prepared, false)!;
  merged.computeBoundingSphere();
  return merged;
}

const vertexColorMat = (rough = 0.7, metal = 0) =>
  mat(`vc:${rough}:${metal}`, () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rough, metalness: metal }));

const sphere = (r: number) => geo(`sph:${r}`, () => new THREE.IcosahedronGeometry(r, 2));
const cyl = (rt: number, rb: number, h: number, seg = 16) => geo(`cyl:${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const box = (w: number, h: number, d: number) => geo(`box:${r3(w)}:${r3(h)}:${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));

/** Deterministic pseudo-random for decor clusters. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/**
 * A loose bouquet of blush, white and rose blooms with greenery. `greenY` sets the height of the
 * greenery ring (default: just under the blooms).
 */
function bouquetParts(radius: number, centerY: number, seed: number, count = 16, greenY?: number): Part[] {
  const rnd = rng(seed);
  const palette = [COLORS.blush, COLORS.ivory, COLORS.rose, COLORS.blush, 0xf6e3e0, COLORS.deepRose];
  const parts: Part[] = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * radius;
    const s = radius * (0.32 + rnd() * 0.2);
    parts.push({ g: sphere(1), color: palette[i % palette.length], at: [Math.cos(a) * d, centerY + rnd() * radius * 0.5, Math.sin(a) * d], scale: [s, s * 0.85, s] });
  }
  for (let i = 0; i < Math.round(count * 0.6); i++) {
    const a = rnd() * Math.PI * 2;
    const d = radius * (0.8 + rnd() * 0.35);
    const s = radius * (0.18 + rnd() * 0.12);
    const gy = greenY ?? centerY - radius * 0.1 + rnd() * radius * 0.3;
    parts.push({ g: sphere(1), color: i % 2 ? COLORS.greenery : COLORS.eucalyptus, at: [Math.cos(a) * d, greenY === undefined ? gy : greenY + rnd() * 0.03, Math.sin(a) * d], scale: [s * 1.6, s * 0.6, s] });
  }
  return parts;
}

function centerpieceGeometry(kind: string, tableRound: boolean, length: number): THREE.BufferGeometry | null {
  return geo(`cp:${kind}:${tableRound}:${r3(length)}`, () => {
    const parts: Part[] = [];
    if (kind === 'low-floral') {
      parts.push({ g: cyl(0.09, 0.07, 0.1, 20), color: COLORS.gold, at: [0, 0.05, 0] });
      parts.push(...bouquetParts(0.17, 0.14, 11));
      for (const a of [0, 2.1, 4.2]) parts.push({ g: cyl(0.025, 0.025, 0.09, 10), color: 0xfff7ea, at: [Math.cos(a) * 0.3, 0.045, Math.sin(a) * 0.3] });
    } else if (kind === 'tall-floral') {
      // full arrangement sitting right on the table: low gold bowl, a generous mound of blooms,
      // greenery trailing onto the cloth and a ring of votives (about 12″ tall overall)
      parts.push({ g: cyl(0.13, 0.09, 0.06, 24), color: COLORS.gold, at: [0, 0.03, 0] });
      parts.push(...bouquetParts(0.21, 0.13, 23, 24, 0.03));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        parts.push({ g: sphere(1), color: [COLORS.blush, COLORS.ivory, COLORS.rose][i % 3], at: [Math.cos(a) * 0.18, 0.065, Math.sin(a) * 0.18], scale: [0.055, 0.045, 0.055] });
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        parts.push({ g: cyl(0.025, 0.025, 0.08, 10), color: 0xfff7ea, at: [Math.cos(a) * 0.38, 0.04, Math.sin(a) * 0.38] });
      }
    } else if (kind === 'candles') {
      const n = tableRound ? 3 : Math.max(3, Math.round(length / 0.35));
      const span = tableRound ? 0.3 : Math.max(0.4, length - 0.6);
      for (let i = 0; i < n; i++) {
        const x = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
        const h = 0.1 + ((i * 37) % 3) * 0.05;
        parts.push({ g: cyl(0.035, 0.035, h, 12), color: 0xfff7ea, at: [x, h / 2, 0] });
      }
      // greenery runner
      const rnd = rng(5);
      const runner = tableRound ? 0.4 : span + 0.3;
      for (let i = 0; i < Math.round(runner / 0.06); i++) {
        const x = -runner / 2 + rnd() * runner;
        parts.push({ g: sphere(1), color: i % 3 ? COLORS.eucalyptus : COLORS.greenery, at: [x, 0.02, (rnd() - 0.5) * 0.18], scale: [0.06, 0.02, 0.04] });
        if (i % 5 === 0) parts.push({ g: sphere(1), color: COLORS.blush, at: [x, 0.04, (rnd() - 0.5) * 0.12], scale: [0.035, 0.03, 0.035] });
      }
    } else {
      return new THREE.BufferGeometry();
    }
    return mergeColored(parts);
  });
}

function addMesh(group: THREE.Group, g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, shadows = true): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** Floor-length linen table: round or rectangular. */
function linenTable(group: THREE.Group, f: Furniture, round: boolean) {
  const m = linenMaterial(f.appearance?.linenColor);
  if (round) {
    const r = f.width / 2;
    addMesh(group, geo(`rlinen:${r3(r)}:${r3(f.height)}`, () => new THREE.CylinderGeometry(r, r * 1.04, f.height, 56, 1)), m, 0, f.height / 2, 0);
  } else {
    addMesh(group, geo(`blinen:${r3(f.width)}:${r3(f.height)}:${r3(f.depth)}`, () => {
      const g = new THREE.BoxGeometry(f.width, f.height, f.depth);
      return g;
    }), m, 0, f.height / 2, 0);
  }
}

function centerpiece(group: THREE.Group, f: Furniture, round: boolean) {
  const kind = f.appearance?.centerpiece ?? 'none';
  if (kind === 'none') return;
  const g = centerpieceGeometry(kind, round, f.width);
  if (!g || !g.attributes.position) return;
  addMesh(group, g, vertexColorMat(0.75), 0, f.height + 0.002, 0);
}

function danceFloor(group: THREE.Group, f: Furniture) {
  const kind = f.appearance?.floor ?? 'checker';
  const base = danceFloorTexture(kind)!;
  const panel = 0.9144; // 3 ft panels
  const rx = f.width / panel / (kind === 'checker' ? 2 : 1);
  const rz = f.depth / panel / (kind === 'checker' ? 2 : 1);
  const key = `dancemat:${kind}:${r3(rx)}:${r3(rz)}`;
  const m = mat(key, () => {
    const t = base.clone();
    t.repeat.set(rx, rz);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, roughness: kind === 'black' ? 0.18 : 0.3, metalness: 0.05 });
  });
  const h = Math.max(0.01, f.height);
  addMesh(group, box(f.width, h, f.depth), m, 0, h / 2, 0, false);
  // thin black edge trim
  const trim = std(COLORS.black, 0.4);
  const t = 0.04;
  addMesh(group, box(f.width + t * 2, h * 0.9, t), trim, 0, h * 0.45, -f.depth / 2 - t / 2, false);
  addMesh(group, box(f.width + t * 2, h * 0.9, t), trim, 0, h * 0.45, f.depth / 2 + t / 2, false);
  addMesh(group, box(t, h * 0.9, f.depth), trim, -f.width / 2 - t / 2, h * 0.45, 0, false);
  addMesh(group, box(t, h * 0.9, f.depth), trim, f.width / 2 + t / 2, h * 0.45, 0, false);
}

function djBooth(group: THREE.Group, f: Furniture) {
  const black = std(COLORS.black, 0.5);
  const white = std(0xf7f4ef, 0.6);
  addMesh(group, box(f.width, f.height, f.depth), black, 0, f.height / 2, 0);
  // white facade panel facing guests (+Z)
  addMesh(group, box(f.width * 0.92, f.height * 0.8, 0.02), white, 0, f.height * 0.48, f.depth / 2 + 0.011);
  // equipment
  addMesh(group, box(0.5, 0.06, 0.32), std(0x2c2c2e, 0.4, 0.3), 0, f.height + 0.03, -0.05);
  addMesh(group, box(0.32, 0.03, 0.25), std(0x3a3a3c, 0.4, 0.3), -0.45, f.height + 0.015, -0.05);
  addMesh(group, box(0.32, 0.03, 0.25), std(0x3a3a3c, 0.4, 0.3), 0.45, f.height + 0.015, -0.05);
  addMesh(group, box(0.36, 0.24, 0.02), std(0x111111, 0.3), 0.2, f.height + 0.16, -0.25);
  if (f.appearance?.speakers !== false) {
    for (const side of [-1, 1]) {
      const x = side * (f.width / 2 + 0.35);
      addMesh(group, cyl(0.02, 0.02, 1.3, 8), black, x, 0.65, 0);
      addMesh(group, box(0.35, 0.55, 0.32), black, x, 1.55, 0);
      addMesh(group, cyl(0.11, 0.11, 0.01, 20), std(0x333333, 0.5), x, 1.5, 0.165).rotation.x = Math.PI / 2;
      for (const a of [0, 2.1, 4.2]) {
        const leg = addMesh(group, cyl(0.012, 0.012, 0.5, 6), black, x + Math.cos(a) * 0.15, 0.2, Math.sin(a) * 0.15);
        leg.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      }
    }
  }
}

function bar(group: THREE.Group, f: Furniture) {
  const body = std(0xf3eee7, 0.7);
  const top = std(COLORS.black, 0.25, 0.1);
  addMesh(group, box(f.width, f.height - 0.04, f.depth), body, 0, (f.height - 0.04) / 2, 0);
  addMesh(group, box(f.width + 0.06, 0.04, f.depth + 0.08), top, 0, f.height - 0.02, 0.02);
  // panel detailing on the guest side (+Z)
  const panels = Math.max(1, Math.round(f.width / 0.6));
  for (let i = 0; i < panels; i++) {
    const x = -f.width / 2 + (f.width / panels) * (i + 0.5);
    addMesh(group, box(f.width / panels - 0.08, f.height * 0.6, 0.015), std(0xe9e1d6, 0.7), x, f.height * 0.45, f.depth / 2 + 0.008);
  }
  addMesh(group, box(f.width, 0.03, 0.04), std(COLORS.gold, 0.35, 0.6), 0, 0.1, f.depth / 2 + 0.02);
  // glassware + bottles on the back edge
  const glass = std(0xe8eef0, 0.08, 0.1, { transparent: true, opacity: 0.55 });
  for (let i = 0; i < 6; i++) addMesh(group, cyl(0.035, 0.03, 0.16, 10), glass, -f.width / 2 + 0.3 + i * 0.12, f.height + 0.08, -f.depth / 2 + 0.12, false);
  const bottleColors = [0x3a5a40, 0x7a3b2e, 0xe2d6b5, 0x2b2b2b];
  for (let i = 0; i < 5; i++) addMesh(group, cyl(0.035, 0.04, 0.3, 10), std(bottleColors[i % 4], 0.2, 0.1), f.width / 2 - 0.3 - i * 0.11, f.height + 0.15, -f.depth / 2 + 0.12);
}

function serviceTableDecor(group: THREE.Group, f: Furniture) {
  const label = f.label.toLowerCase();
  const y = f.height;
  if (f.type === 'buffet' && !label.includes('dessert')) {
    const n = Math.max(1, Math.floor(f.width / 0.6));
    const steel = std(0xc9ccd0, 0.25, 0.85);
    for (let i = 0; i < n; i++) {
      const x = -f.width / 2 + (f.width / n) * (i + 0.5);
      addMesh(group, box(0.5, 0.12, 0.32), steel, x, y + 0.08, 0);
      const lid = addMesh(group, cyl(0.16, 0.16, 0.48, 16, ), steel, x, y + 0.14, 0);
      lid.rotation.z = Math.PI / 2;
      lid.scale.set(1, 1, 0.35);
    }
  } else if (f.type === 'buffet') {
    const n = Math.max(2, Math.floor(f.width / 0.45));
    for (let i = 0; i < n; i++) {
      const x = -f.width / 2 + (f.width / n) * (i + 0.5);
      const h = 0.08 + (i % 2) * 0.12;
      addMesh(group, cyl(0.02, 0.06, h, 12), std(COLORS.gold, 0.35, 0.6), x, y + h / 2, 0);
      addMesh(group, cyl(0.14, 0.14, 0.01, 20), std(0xffffff, 0.5), x, y + h, 0);
      const g = mergeColored(Array.from({ length: 6 }, (_, k) => ({ g: sphere(1), color: [COLORS.blush, 0x8a5a44, COLORS.ivory][k % 3], at: [Math.cos(k) * 0.07, 0.03, Math.sin(k) * 0.07] as [number, number, number], scale: [0.035, 0.03, 0.035] as [number, number, number] })));
      addMesh(group, g, vertexColorMat(0.7), x, y + h, 0);
    }
  } else if (f.type === 'gift') {
    const colors = [COLORS.blush, COLORS.ivory, 0xe6d5b8, COLORS.rose, 0xffffff];
    const rnd = rng(3);
    for (let i = 0; i < 7; i++) {
      const s = 0.12 + rnd() * 0.15;
      const x = (rnd() - 0.5) * (f.width - 0.4);
      const z = (rnd() - 0.5) * (f.depth - 0.3);
      const b = addMesh(group, box(s, s * 0.8, s), std(colors[i % colors.length], 0.7), x, y + (s * 0.8) / 2, z);
      b.rotation.y = rnd();
      const rb = addMesh(group, box(s * 1.01, s * 0.81, 0.02), std(COLORS.gold, 0.4, 0.5), x, y + (s * 0.8) / 2, z);
      rb.rotation.y = b.rotation.y;
    }
    addMesh(group, box(0.3, 0.25, 0.2), std(0xf7f2ea, 0.6), f.width / 2 - 0.3, y + 0.125, 0);
  } else if (f.type === 'welcome') {
    const frame = addMesh(group, box(0.32, 0.42, 0.02), std(COLORS.gold, 0.35, 0.6), -f.width / 4, y + 0.22, 0);
    frame.rotation.x = -0.2;
    const g = centerpieceGeometry('low-floral', true, 0)!;
    addMesh(group, g, vertexColorMat(0.75), f.width / 4, y, 0);
    for (let i = 0; i < 3; i++) addMesh(group, box(0.08, 0.002, 0.12), std(0xffffff, 0.6), -0.05 + i * 0.1, y + 0.002, f.depth / 4);
  }
}

function cake(group: THREE.Group, f: Furniture) {
  const round = f.variant !== 'rect';
  linenTable(group, f, round);
  const icing = std(0xfffaf3, 0.55);
  let y = f.height;
  const tiers: [number, number][] = [[0.17, 0.14], [0.13, 0.13], [0.09, 0.12]];
  addMesh(group, cyl(0.21, 0.21, 0.015, 32), std(COLORS.gold, 0.35, 0.6), 0, y + 0.0075, 0);
  y += 0.015;
  for (const [r, h] of tiers) {
    addMesh(group, cyl(r, r, h, 36), icing, 0, y + h / 2, 0);
    y += h;
  }
  addMesh(group, mergeColored(bouquetParts(0.07, 0.02, 41, 9)), vertexColorMat(0.75), 0, y, 0);
  addMesh(group, mergeColored(bouquetParts(0.06, 0.0, 9, 6)), vertexColorMat(0.75), 0.12, f.height + 0.17, 0.08);
}

function sweetheart(group: THREE.Group, f: Furniture) {
  linenTable(group, f, false);
  // floral garland cascading down the guest-facing front (−Z side)
  const parts: Part[] = [];
  const rnd = rng(77);
  const n = Math.round(f.width / 0.05);
  for (let i = 0; i < n; i++) {
    const x = -f.width / 2 + (f.width * i) / (n - 1);
    const sag = Math.sin((i / (n - 1)) * Math.PI) * 0.12;
    const s = 0.045 + rnd() * 0.03;
    parts.push({ g: sphere(1), color: [COLORS.blush, COLORS.ivory, COLORS.rose, COLORS.greenery, COLORS.eucalyptus][i % 5], at: [x, -0.04 - sag, -f.depth / 2 - 0.03], scale: [s, s, s * 0.7] });
  }
  for (const side of [-1, 1]) for (let k = 0; k < 6; k++) {
    const s = 0.05 + rnd() * 0.03;
    parts.push({ g: sphere(1), color: [COLORS.blush, COLORS.ivory, COLORS.greenery][k % 3], at: [side * (f.width / 2 + 0.02), -0.08 - k * 0.07, -f.depth / 2 - 0.02], scale: [s, s, s] });
  }
  addMesh(group, mergeColored(parts), vertexColorMat(0.75), 0, f.height, 0);
}

function decoration(group: THREE.Group, f: Furniture) {
  if (f.variant === 'sign') {
    const black = std(COLORS.black, 0.4);
    const boardH = Math.min(0.9, f.height * 0.55);
    const legH = f.height;
    for (const x of [-f.width * 0.35, f.width * 0.35]) {
      const leg = addMesh(group, box(0.025, legH, 0.025), black, x, legH / 2, 0.05);
      leg.rotation.x = -0.12;
    }
    const back = addMesh(group, box(0.025, legH * 0.95, 0.025), black, 0, legH * 0.47, -f.depth / 2 + 0.06);
    back.rotation.x = 0.28;
    addMesh(group, box(f.width, 0.03, 0.06), black, 0, f.height - boardH - 0.12, 0.08);
    const tex = textTexture(f.label || 'Welcome');
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    const board = new THREE.Mesh(box(f.width * 0.95, boardH, 0.02), [std(0xfbf8f3, 0.7), std(0xfbf8f3, 0.7), std(0xfbf8f3, 0.7), std(0xfbf8f3, 0.7), face, std(0xfbf8f3, 0.7)]);
    board.position.set(0, f.height - boardH / 2 - 0.1, 0.1);
    board.rotation.x = -0.12;
    board.castShadow = true;
    board.userData.disposeMaterial = face;
    group.add(board);
    return;
  }
  // freestanding floral on a slim black pedestal
  const ped = Math.max(0.2, f.height - Math.min(f.width, 0.9) * 0.6);
  addMesh(group, cyl(0.12, 0.16, 0.05, 20), std(COLORS.black, 0.35), 0, 0.025, 0);
  addMesh(group, cyl(0.04, 0.05, ped, 14), std(COLORS.black, 0.35), 0, ped / 2, 0);
  addMesh(group, cyl(0.16, 0.08, 0.1, 20), std(COLORS.gold, 0.35, 0.6), 0, ped, 0);
  const r = Math.min(f.width, f.depth) / 2;
  addMesh(group, mergeColored(bouquetParts(r * 0.8, 0, 99, 26)), vertexColorMat(0.75), 0, ped + 0.05, 0);
}

/** Build the 3D object for one furniture item (chairs & place settings are instanced separately). */
export function buildFurnitureObject(f: Furniture): THREE.Group {
  const group = new THREE.Group();
  group.userData.furnitureId = f.id;
  switch (f.type) {
    case 'roundTable':
    case 'rectTable': {
      const round = isRoundShape(f);
      linenTable(group, f, round);
      centerpiece(group, f, round);
      break;
    }
    case 'sweetheart':
      sweetheart(group, f);
      centerpiece(group, f, false);
      break;
    case 'cake':
      cake(group, f);
      break;
    case 'danceFloor':
      danceFloor(group, f);
      break;
    case 'dj':
      djBooth(group, f);
      break;
    case 'bar':
      bar(group, f);
      break;
    case 'buffet':
    case 'gift':
    case 'welcome':
      linenTable(group, f, false);
      serviceTableDecor(group, f);
      break;
    case 'decoration':
      decoration(group, f);
      break;
  }
  return group;
}

/** Dispose per-object (non-shared) resources. Shared geometry/materials stay cached. */
export function disposeFurnitureObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o.userData.disposeMaterial as THREE.MeshStandardMaterial | undefined;
    if (m) {
      m.map?.dispose();
      m.dispose();
    }
  });
}

// ---------------- chairs & place settings (instanced) ----------------

export function chairGeometries(cfg: SeatingConfig): { frame: THREE.BufferGeometry; cushion: THREE.BufferGeometry } {
  const key = `chair:${r3(cfg.chairWidth)}:${r3(cfg.chairDepth)}:${r3(cfg.chairHeight)}`;
  const frame = geo(`${key}:frame`, () => {
    const w = cfg.chairWidth, d = cfg.chairDepth, H = cfg.chairHeight;
    const seatY = Math.min(0.46, H * 0.5);
    const hw = w / 2 - 0.02, hd = d / 2 - 0.02;
    const legR = 0.012;
    const parts: Part[] = [];
    const legH = seatY;
    for (const x of [-hw, hw]) for (const z of [-hd, hd]) parts.push({ g: cyl(legR, legR * 0.8, legH, 8), color: 0xffffff, at: [x, legH / 2, z] });
    // back posts continue upward
    const backH = H - seatY;
    for (const x of [-hw, hw]) parts.push({ g: cyl(legR, legR, backH, 8), color: 0xffffff, at: [x, seatY + backH / 2, -hd], rot: [-0.08, 0, 0] });
    // seat frame
    parts.push({ g: box(w - 0.02, 0.03, d - 0.02), color: 0xffffff, at: [0, seatY - 0.015, 0] });
    // stretchers
    parts.push({ g: box(w - 0.04, 0.012, 0.012), color: 0xffffff, at: [0, 0.16, hd] });
    parts.push({ g: box(w - 0.04, 0.012, 0.012), color: 0xffffff, at: [0, 0.16, -hd] });
    parts.push({ g: box(0.012, 0.012, d - 0.04), color: 0xffffff, at: [-hw, 0.12, 0] });
    parts.push({ g: box(0.012, 0.012, d - 0.04), color: 0xffffff, at: [hw, 0.12, 0] });
    // Chiavari back rails + spindles
    const backZ = -hd - Math.sin(0.08) * backH * 0.5;
    for (const y of [seatY + backH * 0.35, seatY + backH * 0.68, H - 0.015]) parts.push({ g: box(w - 0.03, 0.022, 0.016), color: 0xffffff, at: [0, y, backZ] });
    for (const x of [-w * 0.17, 0, w * 0.17]) parts.push({ g: box(0.012, backH * 0.3, 0.012), color: 0xffffff, at: [x, seatY + backH * 0.515, backZ] });
    return mergeColored(parts);
  });
  const cushion = geo(`${key}:cushion`, () => {
    const seatY = Math.min(0.46, cfg.chairHeight * 0.5);
    const g = new THREE.BoxGeometry(cfg.chairWidth - 0.04, 0.045, cfg.chairDepth - 0.04, 1, 1, 1);
    g.translate(0, seatY + 0.02, 0.005);
    return g;
  });
  return { frame, cushion };
}

/** Plate, charger and napkin for one place setting, centred at origin, facing +Z diner. */
export function placeSettingGeometry(): THREE.BufferGeometry {
  return geo('placesetting', () =>
    mergeColored([
      { g: cyl(0.16, 0.16, 0.006, 32), color: COLORS.gold, at: [0, 0.003, 0] },
      { g: cyl(0.13, 0.12, 0.012, 32), color: 0xffffff, at: [0, 0.01, 0] },
      { g: box(0.09, 0.02, 0.14), color: COLORS.blush, at: [0, 0.025, 0], rot: [0, 0.3, 0] },
      { g: box(0.015, 0.004, 0.19), color: 0xc9ccd0, at: [-0.19, 0.003, 0] },
      { g: box(0.015, 0.004, 0.19), color: 0xc9ccd0, at: [0.19, 0.003, 0] },
      { g: cyl(0.035, 0.03, 0.12, 12), color: 0xe9f0f2, at: [-0.15, 0.06, 0.17] },
    ]),
  );
}

export { vertexColorMat };
