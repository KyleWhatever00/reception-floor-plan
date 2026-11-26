import * as THREE from 'three';
import type { Room, Vec2 } from '../model/types';
import { lerp2, outwardNormal, polygonBounds, polygonCentroid, wallLength } from '../model/geometry';
import { COLORS, glowTexture } from './materials';
import { mergeColored } from './furnitureMeshes';

/** The wall with the most glass — used to place the patio, oaks and the lake view. */
export function viewWall(room: Room): number {
  const glass = new Array(room.vertices.length).fill(0);
  for (const o of room.openings) if (o.wallIndex < glass.length) glass[o.wallIndex] += o.width * (o.kind === 'window' ? o.height : o.height * 0.5);
  let best = 0;
  for (let i = 1; i < glass.length; i++) if (glass[i] > glass[best] || (glass[i] === glass[best] && wallLength(room.vertices, i) > wallLength(room.vertices, best))) best = i;
  return best;
}

let oakGeo: THREE.BufferGeometry | null = null;
function oakGeometry(): THREE.BufferGeometry {
  if (oakGeo) return oakGeo;
  let seed = 17;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const parts: Parameters<typeof mergeColored>[0] = [];
  const bark = 0x5d5349;
  // a leaning, branching live-oak trunk
  parts.push({ g: new THREE.CylinderGeometry(0.22, 0.32, 3.2, 10), color: bark, at: [0.3, 1.5, 0], rot: [0, 0, -0.18] });
  parts.push({ g: new THREE.CylinderGeometry(0.14, 0.2, 3.4, 8), color: bark, at: [1.6, 4.0, 0.3], rot: [0.1, 0, -0.75] });
  parts.push({ g: new THREE.CylinderGeometry(0.12, 0.18, 3.0, 8), color: bark, at: [-0.6, 4.1, -0.4], rot: [-0.2, 0, 0.55] });
  const leaf = [0x4f6b3a, 0x5d7a43, 0x445f33, 0x6b8550];
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 1 + rnd() * 3.6;
    const s = 1.1 + rnd() * 1.3;
    parts.push({ g: new THREE.IcosahedronGeometry(1, 1), color: leaf[i % leaf.length], at: [0.6 + Math.cos(a) * r, 5.2 + rnd() * 1.6, Math.sin(a) * r * 0.8], scale: [s * 1.3, s * 0.65, s] });
  }
  oakGeo = mergeColored(parts);
  return oakGeo;
}

/**
 * Outdoor surroundings seen through windows and doors: lawn, patio with live oaks and
 * string lights, and (optionally) a Hill Country lake view below a bluff.
 */
export function buildExterior(room: Room): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  group.name = 'exterior';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);
  const kind = room.features?.finish?.exterior ?? 'lawn';
  const vs = room.vertices;
  const b = polygonBounds(vs);
  const c = polygonCentroid(vs);
  const grass = track(new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }));

  if (kind === 'lawn') {
    const ground = new THREE.Mesh(track(new THREE.PlaneGeometry(400, 400)), grass);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(c.x, -0.02, c.z);
    ground.receiveShadow = true;
    group.add(ground);
    return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
  }

  const wi = viewWall(room);
  const wa = vs[wi], wb = vs[(wi + 1) % vs.length];
  const n = outwardNormal(vs, wi);
  const along = { x: (wb.x - wa.x), z: (wb.z - wa.z) };
  const L = Math.hypot(along.x, along.z);
  const u = { x: along.x / L, z: along.z / L };
  // distance from the centroid to the view wall along its normal
  const wallDist = (wa.x - c.x) * n.x + (wa.z - c.z) * n.z;
  const bluff = wallDist + 30; // lawn ends 30 m beyond the view wall
  const yaw = Math.atan2(n.x, n.z);

  // lawn: a big plane whose front edge is the bluff
  const lawnDepth = 400;
  const lawn = new THREE.Mesh(track(new THREE.PlaneGeometry(500, lawnDepth)), grass);
  lawn.rotation.set(-Math.PI / 2, 0, yaw);
  // local −Y of the plane (after −90° X) maps to +Z; we position by centre
  const lawnCenterDist = bluff - lawnDepth / 2;
  lawn.position.set(c.x + n.x * lawnCenterDist, -0.02, c.z + n.z * lawnCenterDist);
  lawn.receiveShadow = true;
  group.add(lawn);

  // limestone bluff face and the lake below
  const cliffMat = track(new THREE.MeshStandardMaterial({ color: 0xb9a88c, roughness: 1 }));
  const cliff = new THREE.Mesh(track(new THREE.PlaneGeometry(500, 34)), cliffMat);
  cliff.position.set(c.x + n.x * bluff, -17, c.z + n.z * bluff);
  cliff.rotation.y = yaw;
  group.add(cliff);
  const lake = new THREE.Mesh(track(new THREE.CircleGeometry(3000, 64)), track(new THREE.MeshStandardMaterial({ color: 0x4d97bf, roughness: 0.25, metalness: 0.1 })));
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(c.x + n.x * (bluff + 2900), -34, c.z + n.z * (bluff + 2900));
  group.add(lake);
  // far shore: low Hill Country ridges
  const hillMat = track(new THREE.MeshStandardMaterial({ color: 0x8c9a72, roughness: 1, flatShading: true }));
  const hillGeo = track(new THREE.IcosahedronGeometry(1, 1));
  for (let i = -6; i <= 6; i++) {
    const h = new THREE.Mesh(hillGeo, hillMat);
    const d = 1500 + (i % 3) * 120;
    const side = i * 260;
    h.position.set(c.x + n.x * d + u.x * side, -40, c.z + n.z * d + u.z * side);
    h.scale.set(260 + (i % 2) * 80, 70 + ((i + 6) % 4) * 18, 160);
    h.rotation.y = yaw;
    group.add(h);
  }
  // patio pavers along the view wall
  const patioDepth = 6;
  const pavers = new THREE.Mesh(track(new THREE.PlaneGeometry(L + 4, patioDepth)), track(new THREE.MeshStandardMaterial({ color: 0xc9b9a0, roughness: 0.95 })));
  const mid = lerp2(wa, wb, 0.5);
  pavers.rotation.set(-Math.PI / 2, 0, Math.atan2(-u.z, u.x));
  pavers.position.set(mid.x + n.x * (room.wallThickness + patioDepth / 2), 0.005, mid.z + n.z * (room.wallThickness + patioDepth / 2));
  group.add(pavers);
  // cable railing at the patio edge
  const rail = track(new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.5, roughness: 0.4 }));
  const railD = room.wallThickness + patioDepth;
  const railMid = { x: mid.x + n.x * railD, z: mid.z + n.z * railD };
  const top = new THREE.Mesh(track(new THREE.BoxGeometry(L + 4, 0.05, 0.05)), rail);
  top.position.set(railMid.x, 1.05, railMid.z);
  top.rotation.y = Math.atan2(-u.z, u.x);
  group.add(top);
  for (let s = -L / 2 - 2; s <= L / 2 + 2; s += 2.4) {
    const post = new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 1.05, 0.05)), rail);
    post.position.set(railMid.x + u.x * s, 0.52, railMid.z + u.z * s);
    group.add(post);
  }
  // live oaks + string lights
  const oak = oakGeometry();
  const oakMat = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  const trees: Vec2[] = [];
  const count = Math.max(2, Math.round(L / 11));
  for (let k = 0; k < count; k++) {
    const s = -L / 2 + (L * (k + 0.5)) / count;
    const p = { x: mid.x + u.x * s + n.x * (room.wallThickness + 3.2 + (k % 2) * 1.4), z: mid.z + u.z * s + n.z * (room.wallThickness + 3.2 + (k % 2) * 1.4) };
    trees.push(p);
    const tree = new THREE.Mesh(oak, oakMat);
    tree.position.set(p.x, 0, p.z);
    tree.rotation.y = k * 1.7;
    tree.scale.setScalar(0.85 + (k % 3) * 0.12);
    tree.castShadow = true;
    group.add(tree);
  }
  const bulbMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd38a, emissiveIntensity: 2 }));
  const wire = track(new THREE.LineBasicMaterial({ color: 0x222222 }));
  const bulbGeo = track(new THREE.SphereGeometry(0.05, 8, 6));
  const glow = track(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd38a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  for (let k = 0; k < trees.length - 1; k++) {
    const a = trees[k], bb = trees[k + 1];
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(a.x, 4.2, a.z), new THREE.Vector3((a.x + bb.x) / 2, 3.3, (a.z + bb.z) / 2), new THREE.Vector3(bb.x, 4.2, bb.z));
    const pts = curve.getPoints(24);
    group.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints(pts)), wire));
    for (let j = 1; j < 10; j++) {
      const p = curve.getPoint(j / 10);
      const bulb = new THREE.Mesh(bulbGeo, bulbMat);
      bulb.position.copy(p).add(new THREE.Vector3(0, -0.08, 0));
      group.add(bulb);
      const sp = new THREE.Sprite(glow);
      sp.position.copy(bulb.position);
      sp.scale.set(0.5, 0.5, 1);
      group.add(sp);
    }
  }
  void b;
  return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
}
