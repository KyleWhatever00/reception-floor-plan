import * as THREE from 'three';
import type { CeilingZone, Fixture, FrameColor, Opening, Room, Vec2 } from '../model/types';
import { closestPointOnSegment, dist, isConvexCorner, lerp2, localToWorld, outwardNormal, pointInPolygon, polygonArea, subtractConvex, wallLength } from '../model/geometry';
import { ceilingAt, chandelierHangHeight, isChandelier, zoneAt, zoneCorners, zoneHeightAt } from '../model/ceilings';
import { boardTexture, COLORS, ductTexture, floorTexture, glowTexture, stoneTexture } from '../scene/materials';
import { mergeColored } from '../scene/furnitureMeshes';

export interface RoomObjects {
  group: THREE.Group;
  floor: THREE.Mesh;
  /** Walls, trims and columns: clipped to a cut-away height while editing. */
  clippable: THREE.Material[];
  /** Ceiling planes, trusses and hanging fixtures — hidden in build mode. */
  ceiling: THREE.Object3D;
  /** Architectural "poché" plan view of walls, shown only in build mode. */
  planWalls: THREE.Group;
  dispose: () => void;
}

interface Interval {
  s: number;
  e: number;
  kind: 'solid' | 'door' | 'window';
  opening?: Opening;
}

const FRAME_HEX: Record<FrameColor, number> = { white: 0xf3f0ea, black: 0x1d1b1a, bronze: 0x33261d, wood: 0x5b3c27 };

function wallIntervals(room: Room, i: number): Interval[] {
  const L = wallLength(room.vertices, i);
  const ops = room.openings.filter((o) => o.wallIndex === i).sort((a, b) => a.offset - b.offset);
  const out: Interval[] = [];
  let t = 0;
  for (const o of ops) {
    const s0 = Math.max(0, o.offset), e0 = Math.min(L, o.offset + o.width);
    if (s0 > t + 1e-4) out.push({ s: t, e: s0, kind: 'solid' });
    const s = Math.max(s0, t);
    if (e0 > s) out.push({ s, e: e0, kind: o.kind, opening: o });
    t = Math.max(t, e0);
  }
  if (t < L - 1e-4) out.push({ s: t, e: L, kind: 'solid' });
  return out;
}

export function floorGeometry(vertices: Vec2[]): THREE.BufferGeometry {
  const shape = new THREE.Shape(vertices.map((v) => new THREE.Vector2(v.x, -v.z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / 2.2;
    uv[i * 2 + 1] = pos.getZ(i) / 2.2;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Ceiling height at a floor point (used to hang fixtures). */
export function ceilingHeightAt(room: Room, p: Vec2): number {
  return ceilingAt(room, p);
}

export function buildRoom(room: Room): RoomObjects {
  const group = new THREE.Group();
  group.name = 'room';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const finish = room.features?.finish ?? {};

  const floorMat = track(new THREE.MeshStandardMaterial({ map: floorTexture(finish.floor), roughness: finish.floor === 'dark-walnut' ? 0.45 : 0.62, metalness: 0.02, color: 0xffffff }));
  const floor = new THREE.Mesh(track(floorGeometry(room.vertices)), floorMat);
  floor.receiveShadow = true;
  floor.name = 'floor';
  group.add(floor);

  const wallMat = track(new THREE.MeshStandardMaterial({ color: finish.wallColor ?? COLORS.wall, roughness: 0.92 }));
  const wallMat2 = track(new THREE.MeshStandardMaterial({ color: finish.wallColor ?? COLORS.wall, roughness: 0.92, side: THREE.DoubleSide }));
  const trimMat = track(new THREE.MeshStandardMaterial({ color: COLORS.trim, roughness: 0.6 }));
  const glassMat = track(new THREE.MeshStandardMaterial({ color: 0xcfe3ea, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
  const fabricMat = track(new THREE.MeshStandardMaterial({ color: 0xe9dfcf, roughness: 1 }));
  const exitMat = track(new THREE.MeshStandardMaterial({ color: 0x1f8f4e, emissive: 0x2fd36f, emissiveIntensity: 1.2 }));
  const frameMats = new Map<FrameColor, THREE.MeshStandardMaterial>();
  const frameMat = (c: FrameColor) => {
    let m = frameMats.get(c);
    if (!m) {
      m = track(new THREE.MeshStandardMaterial({ color: FRAME_HEX[c], roughness: c === 'white' ? 0.55 : 0.4, metalness: c === 'bronze' || c === 'black' ? 0.2 : 0 }));
      frameMats.set(c, m);
    }
    return m;
  };
  const stoneMats = new Map<string, THREE.MeshStandardMaterial>();
  const stoneMat = (w: number, h: number) => {
    const key = `${w.toFixed(2)}:${h.toFixed(2)}`;
    let m = stoneMats.get(key);
    if (!m) {
      const t = stoneTexture().clone();
      t.repeat.set(Math.max(0.5, w / 1.2), h / 1.2);
      t.needsUpdate = true;
      track(t);
      m = track(new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
      stoneMats.set(key, m);
    }
    return m;
  };

  const planWalls = new THREE.Group();
  planWalls.name = 'planWalls';
  const planMat = track(new THREE.MeshBasicMaterial({ color: 0x2a2423 }));
  const planWindowMat = track(new THREE.MeshBasicMaterial({ color: 0x9fbac4 }));
  const planStoneMat = track(new THREE.MeshBasicMaterial({ color: 0x8c7b66 }));
  const planDoorMat = track(new THREE.LineBasicMaterial({ color: 0x8a7a72 }));

  const H = room.wallHeight;
  const t = room.wallThickness;
  const vs = room.vertices;
  const clippable: THREE.Material[] = [wallMat, wallMat2, trimMat, glassMat, fabricMat, exitMat];

  const addBox = (parent: THREE.Object3D, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rotY: number, shadow = true) => {
    if (w <= 1e-4 || h <= 1e-4 || d <= 1e-4) return null;
    const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(w, h, d)), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % vs.length];
    const L = wallLength(vs, i);
    if (L < 1e-4) continue;
    const dir = { x: (b.x - a.x) / L, z: (b.z - a.z) / L };
    const n = outwardNormal(vs, i);
    const rotY = Math.atan2(-dir.z, dir.x);
    const at = (s: number, outward: number) => {
      const p = lerp2(a, b, s / L);
      return { x: p.x + n.x * outward, z: p.z + n.z * outward };
    };
    const convexStart = isConvexCorner(vs, i);
    const convexEnd = isConvexCorner(vs, (i + 1) % vs.length);
    for (const iv of wallIntervals(room, i)) {
      // extend first/last pieces through convex corners so walls meet cleanly
      const s = iv.s - (iv.s < 1e-4 && convexStart ? t : 0);
      const e = iv.e + (iv.e > L - 1e-4 && convexEnd ? t : 0);
      const len = e - s;
      const c = at((s + e) / 2, t / 2);
      const ilen = iv.e - iv.s;
      const ic = at((iv.s + iv.e) / 2, t / 2);
      if (iv.kind === 'solid') {
        addBox(group, len, H, t, wallMat, c.x, H / 2, c.z, rotY);
        const bb = at((iv.s + iv.e) / 2, -0.01);
        addBox(group, ilen, 0.13, 0.02, trimMat, bb.x, 0.065, bb.z, rotY, false);
        addBox(planWalls, len, 0.01, t, planMat, c.x, 0, c.z, rotY, false);
        continue;
      }
      const o = iv.opening!;
      const st = o.style ?? {};
      if (iv.kind === 'door') {
        const dh = Math.min(o.height, H);
        addBox(group, len, H - dh, t, wallMat, c.x, dh + (H - dh) / 2, c.z, rotY);
        const fm = frameMat(st.frame ?? (st.leaves === 'single' ? 'wood' : 'bronze'));
        clippable.push(fm);
        const jw = 0.07;
        for (const side of [-1, 1]) {
          const p = at(side < 0 ? iv.s + jw / 2 : iv.e - jw / 2, t / 2);
          addBox(group, jw, dh, t + 0.04, fm, p.x, dh / 2, p.z, rotY);
        }
        addBox(group, ilen, 0.09, t + 0.04, fm, ic.x, dh + 0.045, ic.z, rotY);
        // door leaves, shown swung open to the outside so the doorway stays walkable
        const leaves = st.leaves ?? 'double';
        const count = leaves === 'single' ? 1 : 2;
        const lw = (ilen - jw * 2) / count;
        for (let k = 0; k < count; k++) {
          const hingeS = k === 0 ? iv.s + jw : iv.e - jw;
          const hinge = at(hingeS, t + 0.03);
          const along = k === 0 ? 1 : -1;
          const leaf = new THREE.Group();
          // build leaf in local space: width along +X from hinge, thickness Z
          const lh = dh - 0.02;
          if (leaves === 'single') {
            addBox(leaf, lw, lh, 0.045, fm, lw / 2, lh / 2, 0, 0);
          } else {
            const stile = 0.09;
            addBox(leaf, lw, 0.22, 0.05, fm, lw / 2, 0.11, 0, 0);
            addBox(leaf, lw, stile, 0.05, fm, lw / 2, lh - stile / 2, 0, 0);
            addBox(leaf, stile, lh, 0.05, fm, stile / 2, lh / 2, 0, 0);
            addBox(leaf, stile, lh, 0.05, fm, lw - stile / 2, lh / 2, 0, 0);
            addBox(leaf, lw - stile * 2, lh - 0.22 - stile, 0.01, glassMat, lw / 2, 0.22 + (lh - 0.22 - stile) / 2, 0, 0, false);
            if (leaves === 'french') {
              for (let r = 1; r < 4; r++) addBox(leaf, lw - stile * 2, 0.025, 0.03, fm, lw / 2, 0.22 + ((lh - 0.22 - stile) * r) / 4, 0, 0, false);
              addBox(leaf, 0.025, lh - 0.22 - stile, 0.03, fm, lw / 2, 0.22 + (lh - 0.22 - stile) / 2, 0, 0, false);
            }
            addBox(leaf, 0.03, 0.3, 0.06, frameMat('black'), lw - stile - 0.05, lh * 0.45, 0.04, 0, false);
          }
          leaf.position.set(hinge.x, 0, hinge.z);
          // swing 90° outward: local +X points away from the building
          leaf.rotation.y = rotY + (along > 0 ? Math.PI / 2 : -Math.PI / 2) * -1;
          // ensure local +X maps to the outward normal
          const xAxis = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), leaf.rotation.y);
          if (xAxis.x * n.x + xAxis.z * n.z < 0) leaf.rotation.y += Math.PI;
          group.add(leaf);
        }
        if (st.exitSign) {
          const p = at((iv.s + iv.e) / 2, -0.04);
          const y = Math.min(H - 0.2, dh + 0.32);
          addBox(group, 0.36, 0.16, 0.05, exitMat, p.x, y, p.z, rotY, false);
        }
        // plan symbol: threshold line + swing arc
        const p0 = lerp2(a, b, iv.s / L);
        const p1 = lerp2(a, b, iv.e / L);
        const pts: THREE.Vector3[] = [];
        const r = ilen / count;
        const arc = (hingeP: Vec2, sign: number) => {
          for (let k = 0; k <= 12; k++) {
            const th = (k / 12) * (Math.PI / 2);
            pts.push(new THREE.Vector3(hingeP.x + (sign * dir.x * Math.cos(th) + n.x * Math.sin(th)) * r, 0, hingeP.z + (sign * dir.z * Math.cos(th) + n.z * Math.sin(th)) * r));
          }
          pts.push(new THREE.Vector3(hingeP.x, 0, hingeP.z));
        };
        arc(p0, 1);
        if (count === 2) arc(p1, -1);
        pts.push(new THREE.Vector3(p0.x, 0, p0.z), new THREE.Vector3(p1.x, 0, p1.z));
        planWalls.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(pts)), planDoorMat));
      } else {
        const sill = Math.max(0, o.sillHeight);
        const wh = Math.min(o.height, H - sill);
        if (sill > 0.001) addBox(group, len, sill, t, wallMat, c.x, sill / 2, c.z, rotY);
        addBox(group, len, H - sill - wh, t, wallMat, c.x, sill + wh + (H - sill - wh) / 2, c.z, rotY);
        addBox(group, ilen, wh, 0.012, glassMat, ic.x, sill + wh / 2, ic.z, rotY, false);
        const fm = frameMat(st.frame ?? 'white');
        clippable.push(fm);
        const fw = 0.06;
        addBox(group, ilen, fw, t + 0.03, fm, ic.x, sill + fw / 2, ic.z, rotY);
        addBox(group, ilen, fw, t + 0.03, fm, ic.x, sill + wh - fw / 2, ic.z, rotY);
        const panes = Math.max(1, st.panes ?? 1);
        for (let k = 0; k <= panes; k++) {
          const p = at(iv.s + fw / 2 + ((ilen - fw) * k) / panes, t / 2);
          addBox(group, k === 0 || k === panes ? fw : 0.045, wh, t + 0.03, fm, p.x, sill + wh / 2, p.z, rotY);
        }
        if (st.transom && st.transom > 0) addBox(group, ilen, 0.05, t + 0.03, fm, ic.x, sill + wh * st.transom, ic.z, rotY);
        const sl = at((iv.s + iv.e) / 2, -0.04);
        if (sill > 0.05) addBox(group, ilen + 0.08, 0.03, 0.1, trimMat, sl.x, sill, sl.z, rotY, false);
        if (st.curtains) {
          const top = Math.min(H - 0.05, sill + wh + 0.35);
          for (const side of [-1, 1]) {
            const p = at(side < 0 ? iv.s - 0.1 : iv.e + 0.1, -0.14);
            const cm = addBox(group, 0.55, top, 0.12, fabricMat, p.x, top / 2, p.z, rotY);
            if (cm) cm.scale.z = 1;
          }
        }
        addBox(planWalls, len, 0.01, t * 0.35, planWindowMat, c.x, 0, c.z, rotY, false);
        const pIn = at((s + e) / 2, 0.0125), pOut = at((s + e) / 2, t - 0.0125);
        addBox(planWalls, len, 0.01, 0.025, planMat, pIn.x, 0, pIn.z, rotY, false);
        addBox(planWalls, len, 0.01, 0.025, planMat, pOut.x, 0, pOut.z, rotY, false);
      }
    }
  }

  // stone / plaster pilasters on wall faces
  for (const p of room.features?.pilasters ?? []) {
    if (p.wallIndex < 0 || p.wallIndex >= vs.length) continue;
    const a = vs[p.wallIndex], b = vs[(p.wallIndex + 1) % vs.length];
    const L = wallLength(vs, p.wallIndex);
    if (L <= 0) continue;
    const n = outwardNormal(vs, p.wallIndex);
    const mid = lerp2(a, b, Math.min(L, Math.max(0, p.offset + p.width / 2)) / L);
    const rotY = Math.atan2(-(b.z - a.z), b.x - a.x);
    const m = p.material === 'stone' ? stoneMat(p.width, H) : trimMat;
    if (p.material === 'stone') clippable.push(m);
    addBox(group, p.width, H, p.depth, m, mid.x - n.x * (p.depth / 2), H / 2, mid.z - n.z * (p.depth / 2), rotY);
    addBox(planWalls, p.width, 0.01, p.depth, planStoneMat, mid.x - n.x * (p.depth / 2), 0, mid.z - n.z * (p.depth / 2), rotY, false);
  }

  for (const c of room.columns) {
    addBox(group, c.width, H, c.depth, trimMat, c.position.x, H / 2, c.position.z, 0);
    addBox(group, c.width + 0.08, 0.2, c.depth + 0.08, trimMat, c.position.x, 0.1, c.position.z, 0);
    addBox(planWalls, c.width, 0.01, c.depth, planMat, c.position.x, 0, c.position.z, 0, false);
  }

  // ---------------------------------------------------------------- ceilings & fixtures
  const ceiling = new THREE.Group();
  ceiling.name = 'ceiling';
  group.add(ceiling);
  const zones = room.features?.ceilings ?? [];
  const zoneGroups = new Map<string, THREE.Group>();
  // flat ceiling at wall height wherever no zone covers the room
  {
    let pieces: Vec2[][] = [vs];
    for (const z of zones) pieces = pieces.flatMap((pc) => subtractConvex(pc, zoneCorners(z)));
    const ceilMat = track(new THREE.MeshStandardMaterial({ color: 0xf7f2ea, roughness: 0.95, side: THREE.BackSide, emissive: 0x8a7f74, emissiveIntensity: 0.55 }));
    for (const pc of pieces) {
      if (pc.length < 3 || polygonArea(pc) < 0.05) continue;
      const ceil = new THREE.Mesh(track(floorGeometry(pc)), ceilMat);
      ceil.position.y = H;
      ceiling.add(ceil);
    }
  }
  for (const z of zones) {
    buildCeilingZone(z);
    buildZoneSteps(z);
  }
  for (const f of room.features?.fixtures ?? []) buildFixture(f);

  /**
   * Vertical wall strips where this zone's ceiling edge meets something at a different height: the
   * wall-height ceiling, a lower zone next door, or the top of an outside wall. Each edge is checked
   * in short pieces so an edge that is partly against a wall and partly open is handled. Where two
   * zones meet, only the taller one builds the step, so nothing is doubled.
   */
  function buildZoneSteps(z: CeilingZone): void {
    const hw = z.width / 2, hd = z.depth / 2;
    const edges = [
      { a: { x: -hw, z: -hd }, b: { x: hw, z: -hd }, out: { x: 0, z: -1 } },
      { a: { x: hw, z: -hd }, b: { x: hw, z: hd }, out: { x: 1, z: 0 } },
      { a: { x: hw, z: hd }, b: { x: -hw, z: hd }, out: { x: 0, z: 1 } },
      { a: { x: -hw, z: hd }, b: { x: -hw, z: -hd }, out: { x: -1, z: 0 } },
    ];
    const edgeH = z.height;
    const nearWall = (p: Vec2) => {
      for (let i = 0; i < vs.length; i++) if (dist(p, closestPointOnSegment(p, vs[i], vs[(i + 1) % vs.length])) < 0.35) return true;
      return false;
    };
    for (const e of edges) {
      const len = Math.hypot(e.b.x - e.a.x, e.b.z - e.a.z);
      const n = Math.max(1, Math.ceil(len / 0.5));
      const spans: { s: number; t: number; lo: number; hi: number }[] = [];
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const mid = lerp2(e.a, e.b, (t0 + t1) / 2);
        const midW = localToWorld(z.center, z.rotation, mid);
        const probe = localToWorld(z.center, z.rotation, { x: mid.x + e.out.x * 0.15, z: mid.z + e.out.z * 0.15 });
        let lo = 0, hi = 0;
        if (nearWall(midW) || !pointInPolygon(probe, vs)) {
          // against an outside wall: extend the wall up to a ceiling that is taller than it
          if (edgeH > H) (lo = H), (hi = edgeH);
        } else {
          const other = zoneAt(room, probe, z.id);
          const nh = other ? zoneHeightAt(other, probe)! : H;
          if (edgeH > nh) (lo = nh), (hi = edgeH);
          else if (!other && edgeH < nh) (lo = edgeH), (hi = nh);
        }
        if (hi - lo < 0.02) continue;
        const last = spans[spans.length - 1];
        if (last && Math.abs(last.t - t0) < 1e-9 && Math.abs(last.lo - lo) < 0.02 && Math.abs(last.hi - hi) < 0.02) last.t = t1;
        else spans.push({ s: t0, t: t1, lo, hi });
      }
      for (const sp of spans) {
        const p0 = lerp2(e.a, e.b, sp.s), p1 = lerp2(e.a, e.b, sp.t);
        const l = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        const mesh = new THREE.Mesh(track(new THREE.BoxGeometry(l, sp.hi - sp.lo, 0.2)), wallMat);
        mesh.position.set((p0.x + p1.x) / 2, (sp.lo + sp.hi) / 2, (p0.z + p1.z) / 2);
        mesh.rotation.y = Math.atan2(-(p1.z - p0.z), p1.x - p0.x);
        zg(z).add(mesh);
      }
    }
  }

  function zg(z: CeilingZone): THREE.Group {
    let g = zoneGroups.get(z.id);
    if (!g) {
      g = new THREE.Group();
      g.position.set(z.center.x, 0, z.center.z);
      g.rotation.y = z.rotation;
      ceiling.add(g);
      zoneGroups.set(z.id, g);
    }
    return g;
  }

  function buildCeilingZone(z: CeilingZone): void {
    const group = zg(z);
    const hw = z.width / 2, hd = z.depth / 2;
    if (z.kind === 'flat' || !z.peakHeight || z.peakHeight <= z.height + 0.05) {
      const m = track(new THREE.MeshStandardMaterial({ color: 0xf8f5ef, roughness: 0.95, side: THREE.DoubleSide, emissive: 0x9a8f84, emissiveIntensity: 0.5 }));
      const plane = new THREE.Mesh(track(new THREE.PlaneGeometry(z.width, z.depth)), m);
      plane.rotation.x = Math.PI / 2;
      plane.position.y = z.height;
      group.add(plane);
      // recessed can lights on a grid
      const spacing = 2.4;
      const nx = Math.max(1, Math.floor(z.width / spacing)), nz = Math.max(1, Math.floor(z.depth / spacing));
      const canMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d6, emissiveIntensity: 1.6 }));
      const cans = new THREE.InstancedMesh(track(new THREE.CircleGeometry(0.075, 16)), canMat, nx * nz);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
      let k = 0;
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) m4.compose(new THREE.Vector3(-hw + (z.width * (i + 0.5)) / nx, z.height - 0.005, -hd + (z.depth * (j + 0.5)) / nz), q, new THREE.Vector3(1, 1, 1)), cans.setMatrixAt(k++, m4);
      group.add(cans);
      return;
    }
    // vaulted: two sloped board planes, gable ends, exposed trusses
    const h = z.height, P = z.peakHeight;
    const slope = Math.hypot(hd, P - h);
    const boards = boardTexture();
    const bm = track(new THREE.MeshStandardMaterial({ map: boards, roughness: 0.85, side: THREE.DoubleSide, emissive: 0x6b5236, emissiveIntensity: 0.25 }));
    for (const side of [-1, 1]) {
      const g = new THREE.BufferGeometry();
      const pos = [-hw, h, side * hd, hw, h, side * hd, hw, P, 0, -hw, P, 0];
      const uv = [0, 0, z.width / 1.6, 0, z.width / 1.6, slope / 1.2, 0, slope / 1.2];
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      track(g);
      const mesh = new THREE.Mesh(g, bm);
      group.add(mesh);
      // swap UVs so boards run along the ridge
      boards.wrapS = boards.wrapT = THREE.RepeatWrapping;
    }
    for (const end of [-1, 1]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([end * hw, h, -hd, end * hw, h, hd, end * hw, P, 0], 3));
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();
      track(g);
      group.add(new THREE.Mesh(g, wallMat2));
    }
    const spacing = z.trussSpacing ?? 3.6;
    const parts: Parameters<typeof mergeColored>[0] = [];
    const cedar = 0xa8683c, steel = 0x1d1b1a;
    const bw = 0.2, bh = 0.32;
    const beam = (len: number) => new THREE.BoxGeometry(bw, bh, len);
    const topLen = slope;
    const topAng = Math.atan2(P - h, hd);
    if (spacing > 0.5) {
      const n = Math.floor(z.width / spacing);
      const start = -((n - 1) * spacing) / 2;
      for (let k = 0; k < n; k++) {
        const x = start + k * spacing;
        if (Math.abs(x) > hw - 0.4) continue;
        parts.push({ g: beam(z.depth), color: cedar, at: [x, h - bh / 2, 0] });
        // Rx(θ) maps local +Z to (y: −sinθ, z: cosθ): the −Z chord rises toward the ridge with θ = −angle
        parts.push({ g: beam(topLen), color: cedar, at: [x, (h + P) / 2 - bh * 0.6, -hd / 2], rot: [-topAng, 0, 0] });
        parts.push({ g: beam(topLen), color: cedar, at: [x, (h + P) / 2 - bh * 0.6, hd / 2], rot: [topAng, 0, 0] });
        parts.push({ g: new THREE.BoxGeometry(bw, P - h, bw), color: cedar, at: [x, (h + P) / 2 - bh / 2, 0] });
        const webLen = Math.hypot(hd / 2, (P - h) / 2);
        const webAng = Math.atan2((P - h) / 2, hd / 2);
        // struts from the king-post foot up to the middle of each top chord
        parts.push({ g: beam(webLen), color: cedar, at: [x, h + (P - h) / 4, -hd / 4], rot: [webAng, 0, 0] });
        parts.push({ g: beam(webLen), color: cedar, at: [x, h + (P - h) / 4, hd / 4], rot: [-webAng, 0, 0] });
        parts.push({ g: new THREE.BoxGeometry(bw + 0.02, 0.4, 0.42), color: steel, at: [x, h - 0.1, 0] });
        parts.push({ g: new THREE.BoxGeometry(bw + 0.02, 0.24, 0.24), color: steel, at: [x, P - 0.3, 0] });
      }
    }
    parts.push({ g: new THREE.BoxGeometry(z.width, bh, bw), color: cedar, at: [0, P - bh / 2, 0] });
    const trussMat = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
    const trusses = new THREE.Mesh(track(mergeColored(parts)), trussMat);
    trusses.castShadow = true;
    group.add(trusses);
  }

  function buildFixture(fx: Fixture): void {
    const ceilH = ceilingHeightAt(room, fx.position);
    // never let a chandelier poke through the ceiling above it
    const f = isChandelier(fx) ? { ...fx, height: chandelierHangHeight(room, fx) } : fx;
    const black = track(new THREE.MeshStandardMaterial({ color: 0x1b1918, roughness: 0.5, metalness: 0.4 }));
    const bulb = track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 2.2 }));
    if (f.kind === 'iron-chandelier') {
      const g = new THREE.Group();
      g.position.set(f.position.x, f.height, f.position.z);
      const r = f.size / 2;
      const ring = new THREE.Mesh(track(new THREE.TorusGeometry(r, 0.025, 8, 64)), black);
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const count = Math.max(8, Math.round((Math.PI * f.size) / 0.28));
      const sleeves: Parameters<typeof mergeColored>[0] = [];
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        sleeves.push({ g: new THREE.CylinderGeometry(0.018, 0.018, 0.09, 8), color: 0xf3ede2, at: [Math.cos(a) * r, 0.06, Math.sin(a) * r] });
        sleeves.push({ g: new THREE.CylinderGeometry(0.03, 0.03, 0.015, 8), color: 0x1b1918, at: [Math.cos(a) * r, 0.015, Math.sin(a) * r] });
      }
      g.add(new THREE.Mesh(track(mergeColored(sleeves)), track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }))));
      const bulbs = new THREE.InstancedMesh(track(new THREE.SphereGeometry(0.035, 10, 8)), bulb, count);
      const m4 = new THREE.Matrix4();
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2;
        bulbs.setMatrixAt(k, m4.makeTranslation(Math.cos(a) * r, 0.13, Math.sin(a) * r));
      }
      g.add(bulbs);
      const hub = Math.min(1.1, Math.max(0.3, ceilH - f.height - 0.2));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const from = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        const to = new THREE.Vector3(0, hub, 0);
        const len = from.distanceTo(to);
        const chain = new THREE.Mesh(track(new THREE.CylinderGeometry(0.006, 0.006, len, 4)), black);
        chain.position.copy(from.clone().add(to).multiplyScalar(0.5));
        chain.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        g.add(chain);
      }
      const rodLen = Math.max(0.05, ceilH - f.height - hub);
      const rod = new THREE.Mesh(track(new THREE.CylinderGeometry(0.012, 0.012, rodLen, 6)), black);
      rod.position.y = hub + rodLen / 2;
      g.add(rod);
      // soft glow halo so the ring reads as lit
      const halo = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })));
      halo.scale.set(f.size * 1.6, f.size * 0.6, 1);
      halo.position.y = 0.1;
      g.add(halo);
      ceiling.add(g);
    } else if (f.kind === 'crystal-chandelier') {
      const dh = Math.min(0.5, Math.max(0.2, ceilH - f.height));
      const g = new THREE.Group();
      g.position.set(f.position.x, f.height, f.position.z);
      const crystal = track(new THREE.MeshStandardMaterial({ color: 0xffe0a8, emissive: 0xffb860, emissiveIntensity: 1.1, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.92 }));
      const drum = new THREE.Mesh(track(new THREE.CylinderGeometry(f.size / 2, f.size / 2 * 0.96, dh, 40, 1, true)), crystal);
      drum.position.y = dh / 2;
      g.add(drum);
      const inner = new THREE.Mesh(track(new THREE.CylinderGeometry(f.size / 2 * 0.7, f.size / 2 * 0.7, 0.02, 32)), bulb);
      inner.position.y = 0.05;
      g.add(inner);
      const cap = new THREE.Mesh(track(new THREE.CylinderGeometry(f.size / 2 * 1.02, f.size / 2 * 1.02, 0.04, 40)), track(new THREE.MeshStandardMaterial({ color: 0xd8c08a, metalness: 0.6, roughness: 0.3 })));
      cap.position.y = dh;
      g.add(cap);
      const halo = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffcf8a, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending })));
      halo.scale.set(f.size * 2, f.size, 1);
      halo.position.y = dh * 0.4;
      g.add(halo);
      ceiling.add(g);
    } else if (f.kind === 'duct') {
      const end = f.end ?? f.position;
      const len = dist(f.position, end);
      if (len < 0.1) return;
      const tex = ductTexture().clone();
      tex.repeat.set(1, len / 0.35);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      track(tex);
      const m = track(new THREE.MeshStandardMaterial({ map: tex, metalness: 0.25, roughness: 0.4, emissive: 0x3a3d40, emissiveIntensity: 0.6 }));
      const duct = new THREE.Mesh(track(new THREE.CylinderGeometry(f.size / 2, f.size / 2, len, 24, 1, true)), m);
      duct.position.set((f.position.x + end.x) / 2, f.height, (f.position.z + end.z) / 2);
      duct.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(end.x - f.position.x, 0, end.z - f.position.z).normalize());
      ceiling.add(duct);
    } else if (f.kind === 'sconce') {
      // attach to the nearest wall, facing into the room
      let best = { d: Infinity, i: 0, q: f.position };
      for (let i = 0; i < vs.length; i++) {
        const q = closestPointOnSegment(f.position, vs[i], vs[(i + 1) % vs.length]);
        const d = dist(q, f.position);
        if (d < best.d) best = { d, i, q };
      }
      const n = outwardNormal(vs, best.i);
      const a = vs[best.i], b = vs[(best.i + 1) % vs.length];
      const rotY = Math.atan2(-(b.z - a.z), b.x - a.x);
      const g = new THREE.Group();
      g.position.set(best.q.x - n.x * 0.06, f.height, best.q.z - n.z * 0.06);
      g.rotation.y = rotY;
      // walls are clipped in build mode, so the sconce lives with the ceiling group (walkthrough only)
      const body = new THREE.Mesh(track(new THREE.BoxGeometry(0.13, 0.22, 0.09)), track(new THREE.MeshStandardMaterial({ color: 0xece6dc, roughness: 0.5 })));
      g.add(body);
      const washMat = track(new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffd7a0, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
      for (const dir of [-1, 1]) {
        const wash = new THREE.Mesh(track(new THREE.PlaneGeometry(0.7, 1.2)), washMat);
        wash.position.set(0, dir * 0.55, 0.02 - 0.045);
        // plane faces local +Z; the wall is behind (local −Z side is outward after rotation)
        g.add(wash);
      }
      // make local +Z face into the room
      const z = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      if (z.x * n.x + z.z * n.z > 0) g.rotation.y += Math.PI;
      ceiling.add(g);
    }
  }

  return {
    group,
    floor,
    clippable,
    ceiling,
    planWalls,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}
