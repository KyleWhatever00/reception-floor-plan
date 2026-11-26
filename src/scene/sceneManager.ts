import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Furniture, Layout, Settings, Vec2 } from '../model/types';
import type { Store } from '../model/store';
import { buildRoom, type RoomObjects } from '../room/roomMesh';
import { buildFurnitureObject, chairGeometries, disposeFurnitureObject, placeSettingGeometry, vertexColorMat } from './furnitureMeshes';
import { chairColors, COLORS, skyTexture } from './materials';
import { buildExterior } from './exterior';
import { seatPoses } from '../model/seats';
import { offsetConvex, polygonBounds, polygonCentroid } from '../model/geometry';
import { analyzeLayout, doorZones, occupiedFootprint, serviceZone, type Analysis } from '../model/warnings';
import { ft } from '../model/units';

export type BuildView = 'top' | 'orbit';

const CUT_HEIGHT = 1.15;

interface FurnitureEntry {
  obj: THREE.Group;
  key: string;
}

export interface TopViewState {
  cx: number;
  cz: number;
  /** Pixels per meter. */
  ppm: number;
}

/**
 * Owns the WebGL renderer, scene graph and cameras. Rebuilds only what changed in the canonical
 * layout (diffed per furniture item) and renders on demand while editing.
 */
export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly topCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  readonly orbitCam = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  readonly walkCam = new THREE.PerspectiveCamera(70, 1, 0.08, 6000);
  readonly orbit: OrbitControls;
  readonly container: HTMLElement;
  view: BuildView = 'top';
  top: TopViewState = { cx: 0, cz: 0, ppm: 20 };
  analysis: Analysis = { warnings: [], byFurniture: new Map() };

  private store: Store;
  private room: RoomObjects | null = null;
  private roomKey = '';
  private furniture = new Map<string, FurnitureEntry>();
  private furnitureRoot = new THREE.Group();
  private chairFrames: THREE.InstancedMesh | null = null;
  private chairCushions: THREE.InstancedMesh | null = null;
  private settings: THREE.InstancedMesh | null = null;
  private chairKey = '';
  private overlay = new THREE.Group();
  private gridGroup = new THREE.Group();
  private selectionGroup = new THREE.Group();
  private clearanceGroup = new THREE.Group();
  private warnGroup = new THREE.Group();
  private spawnMarker: THREE.Object3D;
  private refImage: THREE.Mesh | null = null;
  private refImageUrl: string | null = null;
  private exterior: { group: THREE.Group; dispose: () => void } | null = null;
  private exteriorKey = '';
  private hemi = new THREE.HemisphereLight(0xfff6ec, 0xc9b49a, 1.1);
  private sun = new THREE.DirectionalLight(0xfff1df, 1.6);
  private ambient = new THREE.AmbientLight(0xffffff, 0.25);
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), CUT_HEIGHT);
  private dirty = true;
  private running = false;
  private continuous = false;
  private lastSize = { w: 0, h: 0 };
  private afterRender: (() => void)[] = [];
  private frameCallbacks: ((dt: number) => void)[] = [];
  private lastTime = performance.now();
  private resizeObserver: ResizeObserver;
  private contextLost = false;
  onContextLost: () => void = () => {};
  onContextRestored: () => void = () => {};

  constructor(container: HTMLElement, store: Store) {
    this.container = container;
    this.store = store;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = 'viewport-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Floor plan view');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0xefe9e2);
    this.topCam.up.set(0, 0, -1);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.ambient);
    this.sun.position.set(-12, 22, 10);
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;


    this.scene.add(this.furnitureRoot);
    this.overlay.add(this.gridGroup, this.clearanceGroup, this.warnGroup, this.selectionGroup);
    this.scene.add(this.overlay);
    this.spawnMarker = this.makeSpawnMarker();
    this.overlay.add(this.spawnMarker);

    this.orbit = new OrbitControls(this.orbitCam, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.minDistance = 2;
    this.orbit.maxDistance = 120;
    this.orbit.enabled = false;
    this.orbit.addEventListener('change', () => this.invalidate());

    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.onContextLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.applyQuality(this.store.settings);
      this.syncAll(true);
      this.onContextRestored();
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.lastTime = performance.now();
        this.invalidate();
      }
    });

    store.subscribe((e) => {
      if (e.kind === 'layout' || e.kind === 'project') this.syncAll(e.kind === 'project' || !!e.room);
      else if (e.kind === 'selection') this.updateSelection();
      else if (e.kind === 'settings') {
        this.applyQuality(this.store.settings);
        this.applyLighting(this.store.settings);
        this.updateOverlays();
      } else if (e.kind === 'mode') this.applyMode();
      this.invalidate();
    });

    this.applyQuality(store.settings);
    this.applyLighting(store.settings);
    this.resize();
    this.syncAll(true);
    this.fitTopView();
    this.applyMode();
  }

  static isWebGLAvailable(): boolean {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch {
      return false;
    }
  }

  get layout(): Layout {
    return this.store.layout;
  }

  get activeCamera(): THREE.Camera {
    if (this.store.mode === 'walk') return this.walkCam;
    return this.view === 'top' ? this.topCam : this.orbitCam;
  }

  invalidate(): void {
    this.dirty = true;
  }

  setContinuous(on: boolean): void {
    this.continuous = on;
    this.lastTime = performance.now();
  }

  onAfterRender(fn: () => void): void {
    this.afterRender.push(fn);
  }

  onFrame(fn: (dt: number) => void): void {
    this.frameCallbacks.push(fn);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (document.hidden || this.contextLost) return;
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      for (const fn of this.frameCallbacks) fn(dt);
      if (this.view === 'orbit' && this.store.mode === 'build' && this.orbit.enabled) this.orbit.update();
      if (!this.dirty && !this.continuous) return;
      this.dirty = false;
      this.renderer.render(this.scene, this.activeCamera);
      for (const fn of this.afterRender) fn();
    };
    requestAnimationFrame(loop);
  }

  // ----------------------------------------------------------------- sizing & cameras

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    if (w === this.lastSize.w && h === this.lastSize.h) return;
    this.lastSize = { w, h };
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    for (const c of [this.orbitCam, this.walkCam]) {
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
    this.updateTopCamera();
    this.invalidate();
  }

  get viewportSize(): { w: number; h: number } {
    return this.lastSize;
  }

  updateTopCamera(): void {
    const { w, h } = this.lastSize;
    const { cx, cz, ppm } = this.top;
    const hw = w / 2 / ppm;
    const hh = h / 2 / ppm;
    this.topCam.left = -hw;
    this.topCam.right = hw;
    this.topCam.top = hh;
    this.topCam.bottom = -hh;
    this.topCam.position.set(cx, 60, cz);
    this.topCam.lookAt(cx, 0, cz);
    this.topCam.updateProjectionMatrix();
    this.updateGrid();
    if (this.store.selection.furnitureId && this.store.mode === 'build') this.scheduleSelectionRefresh();
    this.invalidate();
  }

  private selRefresh = 0;
  private scheduleSelectionRefresh(): void {
    if (this.selRefresh) return;
    this.selRefresh = requestAnimationFrame(() => {
      this.selRefresh = 0;
      this.updateSelection();
    });
  }

  fitTopView(margin = 1.08): void {
    const b = polygonBounds(this.layout.room.vertices);
    const { w, h } = this.lastSize;
    const spanX = (b.maxX - b.minX) * margin + 2;
    const spanZ = (b.maxZ - b.minZ) * margin + 2;
    this.top.ppm = Math.max(2, Math.min(w / spanX, h / spanZ));
    this.top.cx = (b.minX + b.maxX) / 2;
    this.top.cz = (b.minZ + b.maxZ) / 2;
    this.updateTopCamera();
  }

  panTopPixels(dx: number, dy: number): void {
    this.top.cx -= dx / this.top.ppm;
    this.top.cz -= dy / this.top.ppm;
    this.clampTop();
    this.updateTopCamera();
  }

  /** Zoom about a screen point (keeps that point fixed). */
  zoomTopAt(factor: number, sx: number, sy: number): void {
    const before = this.screenToFloor(sx, sy);
    this.top.ppm = Math.min(400, Math.max(2, this.top.ppm * factor));
    this.updateTopCamera();
    const after = this.screenToFloor(sx, sy);
    if (before && after) {
      this.top.cx += before.x - after.x;
      this.top.cz += before.z - after.z;
    }
    this.clampTop();
    this.updateTopCamera();
  }

  private clampTop(): void {
    const b = polygonBounds(this.layout.room.vertices);
    const m = 30;
    this.top.cx = Math.min(b.maxX + m, Math.max(b.minX - m, this.top.cx));
    this.top.cz = Math.min(b.maxZ + m, Math.max(b.minZ - m, this.top.cz));
  }

  setView(view: BuildView): void {
    if (this.view === view) return;
    this.view = view;
    if (view === 'orbit') {
      const c = polygonCentroid(this.layout.room.vertices);
      const b = polygonBounds(this.layout.room.vertices);
      const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
      this.orbit.target.set(this.top.cx ?? c.x, 0, this.top.cz ?? c.z);
      this.orbitCam.position.set(this.orbit.target.x - span * 0.15, span * 0.55, this.orbit.target.z + span * 0.7);
      this.orbit.update();
    }
    this.applyMode();
  }

  /** Raycast a screen point (CSS px relative to the canvas) onto the floor plane. */
  screenToFloor(sx: number, sy: number, camera: THREE.Camera = this.store.mode === 'walk' ? this.walkCam : this.view === 'top' ? this.topCam : this.orbitCam): Vec2 | null {
    const { w, h } = this.lastSize;
    const ndc = new THREE.Vector2((sx / w) * 2 - 1, -(sy / h) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p);
    return hit ? { x: p.x, z: p.z } : null;
  }

  worldToScreen(x: number, y: number, z: number, camera: THREE.Camera = this.activeCamera): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const { w, h } = this.lastSize;
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, visible: v.z > -1 && v.z < 1 };
  }

  // ----------------------------------------------------------------- quality & lighting

  applyQuality(s: Settings): void {
    const dpr = window.devicePixelRatio || 1;
    const ratio = s.quality === 'low' ? Math.min(dpr, 1) : s.quality === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(ratio);
    const shadows = s.quality === 'high';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    this.sun.castShadow = shadows;
    this.lastSize = { w: 0, h: 0 };
    this.resize();
    this.invalidate();
  }

  applyLighting(s: Settings): void {
    if (s.lighting === 'evening') {
      this.hemi.color.set(0xffe9d2);
      this.hemi.groundColor.set(0x8f7660);
      this.hemi.intensity = 1.05;
      this.sun.color.set(0xffd6a8);
      this.sun.intensity = 1.1;
      this.ambient.intensity = 0.32;
      this.renderer.toneMappingExposure = 0.95;
    } else {
      this.hemi.color.set(0xfdf8f2);
      this.hemi.groundColor.set(0xb8a58f);
      this.hemi.intensity = 1.2;
      this.sun.color.set(0xfff6ea);
      this.sun.intensity = 1.8;
      this.ambient.intensity = 0.3;
      this.renderer.toneMappingExposure = 1.05;
    }
    this.invalidate();
  }

  private fitShadowCamera(): void {
    const b = polygonBounds(this.layout.room.vertices);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const r = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 2;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx - r * 0.5, r * 1.6, cz + r * 0.4);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = r * 4;
    cam.updateProjectionMatrix();
  }

  // ----------------------------------------------------------------- mode

  applyMode(): void {
    const walk = this.store.mode === 'walk';
    const top = !walk && this.view === 'top';
    this.orbit.enabled = !walk && this.view === 'orbit';
    this.overlay.visible = !walk;
    if (this.exterior) this.exterior.group.visible = walk || this.view === 'orbit';
    this.scene.background = walk ? skyTexture() : new THREE.Color(0xefe9e2);
    this.scene.fog = walk ? new THREE.Fog(0xdfe9ef, 400, 3200) : null;
    if (this.room) {
      this.room.ceiling.visible = walk;
      this.room.planWalls.visible = !walk;
      this.room.planWalls.position.y = CUT_HEIGHT + 0.01;
      for (const m of this.room.clippable) {
        m.clippingPlanes = walk ? [] : [this.clipPlane];
        m.needsUpdate = true;
      }
    }
    if (this.refImage) this.refImage.visible = !walk && !!this.layout.room.overlay?.visible;
    this.gridGroup.visible = !walk && this.store.settings.showGrid;
    this.spawnMarker.visible = !walk;
    void top;
    this.invalidate();
  }

  // ----------------------------------------------------------------- sync

  syncAll(roomChanged: boolean): void {
    const layout = this.layout;
    const rk = JSON.stringify([layout.room.vertices, layout.room.openings, layout.room.columns, layout.room.wallHeight, layout.room.wallThickness, layout.room.features]);
    if (roomChanged || rk !== this.roomKey || !this.room) {
      if (this.room) {
        this.scene.remove(this.room.group);
        this.scene.remove(this.room.planWalls);
        this.room.dispose();
      }
      this.room = buildRoom(layout.room);
      this.roomKey = rk;
      const ek = JSON.stringify([layout.room.vertices, layout.room.openings, layout.room.wallThickness, layout.room.features?.finish?.exterior]);
      if (ek !== this.exteriorKey || !this.exterior) {
        if (this.exterior) {
          this.scene.remove(this.exterior.group);
          this.exterior.dispose();
        }
        this.exterior = buildExterior(layout.room);
        this.exteriorKey = ek;
        this.scene.add(this.exterior.group);
      }
      this.scene.add(this.room.group);
      this.scene.add(this.room.planWalls);
      this.fitShadowCamera();
      this.applyMode();
    }
    this.syncFurniture();
    this.syncChairs();
    this.syncReferenceImage();
    this.analysis = analyzeLayout(layout, this.store.settings);
    this.updateOverlays();
    this.updateSelection();
    this.invalidate();
  }

  private furnitureKey(f: Furniture): string {
    return JSON.stringify([f.type, f.width, f.depth, f.height, f.variant, f.appearance, f.type === 'decoration' ? f.label : '']);
  }

  private syncFurniture(): void {
    const seen = new Set<string>();
    for (const f of this.layout.furniture) {
      seen.add(f.id);
      const key = this.furnitureKey(f);
      let entry = this.furniture.get(f.id);
      if (!entry || entry.key !== key) {
        if (entry) {
          this.furnitureRoot.remove(entry.obj);
          disposeFurnitureObject(entry.obj);
        }
        entry = { obj: buildFurnitureObject(f), key };
        this.furniture.set(f.id, entry);
        this.furnitureRoot.add(entry.obj);
      }
      entry.obj.position.set(f.position.x, 0, f.position.z);
      entry.obj.rotation.y = f.rotation;
    }
    for (const [id, entry] of this.furniture) {
      if (!seen.has(id)) {
        this.furnitureRoot.remove(entry.obj);
        disposeFurnitureObject(entry.obj);
        this.furniture.delete(id);
      }
    }
  }

  private syncChairs(): void {
    const cfg = this.layout.seating;
    const poses: { x: number; z: number; yaw: number; table: Furniture; fx: number; fz: number }[] = [];
    for (const f of this.layout.furniture) {
      if (!f.seats?.length) continue;
      for (const p of seatPoses(f, cfg)) poses.push({ x: p.position.x, z: p.position.z, yaw: p.yaw, table: f, fx: p.facing.x, fz: p.facing.z });
    }
    const key = JSON.stringify([cfg.chairWidth, cfg.chairDepth, cfg.chairHeight, cfg.chairFinish]);
    const capacity = this.chairFrames ? (this.chairFrames.instanceMatrix.count as number) : 0;
    if (!this.chairFrames || key !== this.chairKey || poses.length > capacity) {
      for (const m of [this.chairFrames, this.chairCushions, this.settings]) {
        if (m) {
          this.scene.remove(m);
          m.dispose();
        }
      }
      const cap = Math.max(64, Math.ceil(poses.length * 1.5));
      const { frame, cushion } = chairGeometries(cfg);
      const col = chairColors(cfg.chairFinish);
      const frameMat = new THREE.MeshStandardMaterial({ color: col.frame, roughness: col.rough, metalness: col.metal, transparent: cfg.chairFinish === 'clear', opacity: cfg.chairFinish === 'clear' ? 0.55 : 1 });
      const cushionMat = new THREE.MeshStandardMaterial({ color: col.cushion, roughness: 0.85 });
      this.chairFrames = new THREE.InstancedMesh(frame, frameMat, cap);
      this.chairCushions = new THREE.InstancedMesh(cushion, cushionMat, cap);
      this.settings = new THREE.InstancedMesh(placeSettingGeometry(), vertexColorMat(0.45, 0.1), cap);
      for (const m of [this.chairFrames, this.chairCushions, this.settings]) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        this.scene.add(m);
      }
      this.chairKey = key;
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    let nSettings = 0;
    poses.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      m4.compose(new THREE.Vector3(p.x, 0, p.z), q, one);
      this.chairFrames!.setMatrixAt(i, m4);
      this.chairCushions!.setMatrixAt(i, m4);
      const t = p.table;
      if (t.appearance?.placeSettings !== false && t.height > 0.5) {
        const inset = cfg.chairOffset + 0.21;
        m4.compose(new THREE.Vector3(p.x + p.fx * inset, t.height + 0.001, p.z + p.fz * inset), q, one);
        this.settings!.setMatrixAt(nSettings++, m4);
      }
    });
    this.chairFrames!.count = poses.length;
    this.chairCushions!.count = poses.length;
    this.settings!.count = nSettings;
    for (const m of [this.chairFrames!, this.chairCushions!, this.settings!]) m.instanceMatrix.needsUpdate = true;
  }

  // ----------------------------------------------------------------- reference image

  private refAssetId = '';
  /** Provided by the app: resolves an overlay asset ID to an object URL. */
  resolveAsset: (id: string) => Promise<string | null> = async () => null;

  syncReferenceImage(): void {
    const o = this.layout.room.overlay;
    if (!o) {
      if (this.refImage) {
        this.overlay.remove(this.refImage);
        (this.refImage.material as THREE.MeshBasicMaterial).map?.dispose();
        (this.refImage.material as THREE.Material).dispose();
        this.refImage.geometry.dispose();
        this.refImage = null;
        this.refAssetId = '';
      }
      return;
    }
    if (!this.refImage) {
      this.refImage = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, color: 0xffffff }));
      this.refImage.rotation.order = 'YXZ';
      this.refImage.renderOrder = 1;
      this.overlay.add(this.refImage);
    }
    const mesh = this.refImage;
    const m = mesh.material as THREE.MeshBasicMaterial;
    mesh.scale.set(o.width, o.width * o.aspect, 1);
    mesh.position.set(o.center.x, 0.006, o.center.z);
    mesh.rotation.set(-Math.PI / 2, o.rotation, 0);
    m.opacity = o.opacity;
    mesh.visible = o.visible && this.store.mode === 'build';
    if (this.refAssetId !== o.assetId) {
      this.refAssetId = o.assetId;
      const id = o.assetId;
      this.resolveAsset(id).then((url) => {
        if (!url || this.refAssetId !== id || !this.refImage) return;
        new THREE.TextureLoader().load(url, (tex) => {
          if (this.refAssetId !== id || !this.refImage) return tex.dispose();
          tex.colorSpace = THREE.SRGBColorSpace;
          const mm = this.refImage.material as THREE.MeshBasicMaterial;
          mm.map?.dispose();
          mm.map = tex;
          mm.needsUpdate = true;
          if (this.refImageUrl) URL.revokeObjectURL(this.refImageUrl);
          this.refImageUrl = url;
          this.invalidate();
        });
      });
    }
  }

  // ----------------------------------------------------------------- overlays

  private lineLoop(points: Vec2[], color: number, y: number, opacity = 1): THREE.LineLoop {
    const g = new THREE.BufferGeometry().setFromPoints(points.map((p) => new THREE.Vector3(p.x, y, p.z)));
    const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false });
    const l = new THREE.LineLoop(g, m);
    l.renderOrder = 10;
    return l;
  }

  private fill(points: Vec2[], color: number, y: number, opacity: number): THREE.Mesh {
    const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, -p.z)));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = y;
    mesh.renderOrder = 5;
    return mesh;
  }

  /** A solid outline band of the given width around a convex footprint (thicker than GL lines). */
  private band(inner: Vec2[], width: number, color: number, y: number): THREE.Mesh {
    const outer = offsetConvex(inner, width);
    const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p.x, -p.z)));
    shape.holes.push(new THREE.Path(inner.map((p) => new THREE.Vector2(p.x, -p.z))));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
    mesh.position.y = y;
    mesh.renderOrder = 11;
    return mesh;
  }

  private clearGroup(g: THREE.Group): void {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      });
    }
  }

  private gridKey = '';
  private updateGrid(): void {
    const s = this.store.settings;
    this.gridGroup.visible = s.showGrid && this.store.mode === 'build';
    const b = polygonBounds(this.layout.room.vertices);
    const fine = this.top.ppm * ft(1) >= 7; // only draw 1 ft lines when they are at least ~7 px apart
    const key = JSON.stringify([b, fine]);
    if (key === this.gridKey) return;
    this.gridKey = key;
    this.clearGroup(this.gridGroup);
    const step = ft(1);
    const pad = ft(4);
    const x0 = Math.floor((b.minX - pad) / step) * step;
    const x1 = Math.ceil((b.maxX + pad) / step) * step;
    const z0 = Math.floor((b.minZ - pad) / step) * step;
    const z1 = Math.ceil((b.maxZ + pad) / step) * step;
    const minor: number[] = [];
    const major: number[] = [];
    // anchor the grid on the room's first corner so wall lines sit on grid lines
    const ox = this.layout.room.vertices[0].x, oz = this.layout.room.vertices[0].z;
    const idx = (v: number, o: number) => Math.round((v - o) / step);
    for (let x = x0; x <= x1 + 1e-6; x += step) {
      const xx = ox + idx(x, ox) * step;
      const arr = idx(x, ox) % 5 === 0 ? major : minor;
      arr.push(xx, 0.004, z0, xx, 0.004, z1);
    }
    for (let z = z0; z <= z1 + 1e-6; z += step) {
      const zz = oz + idx(z, oz) * step;
      const arr = idx(z, oz) % 5 === 0 ? major : minor;
      arr.push(x0, 0.004, zz, x1, 0.004, zz);
    }
    const mk = (arr: number[], color: number, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      l.renderOrder = 2;
      return l;
    };
    if (fine) this.gridGroup.add(mk(minor, 0x5a4636, 0.12));
    this.gridGroup.add(mk(major, 0x5a4636, 0.3));
  }

  updateOverlays(): void {
    const s = this.store.settings;
    this.updateGrid();
    this.gridGroup.visible = s.showGrid && this.store.mode === 'build';
    this.clearGroup(this.clearanceGroup);
    this.clearGroup(this.warnGroup);
    const cfg = this.layout.seating;
    if (s.showClearance) {
      for (const f of this.layout.furniture) {
        if (f.type === 'danceFloor') continue;
        this.clearanceGroup.add(this.fill(occupiedFootprint(f, cfg), 0x8fa3b8, 0.011, 0.2));
        this.clearanceGroup.add(this.lineLoop(occupiedFootprint(f, cfg), 0x6d8299, 0.012, 0.6));
        const svc = serviceZone(f);
        if (svc) this.clearanceGroup.add(this.fill(svc, 0xc9a36a, 0.011, 0.25));
      }
      for (const z of doorZones(this.layout.room, Math.max(s.aisleWidth, 1))) {
        this.clearanceGroup.add(this.fill(z.poly, 0x6aa38a, 0.01, 0.28));
        this.clearanceGroup.add(this.lineLoop(z.poly, 0x4f8a70, 0.012, 0.8));
      }
    }
    for (const [id, ws] of this.analysis.byFurniture) {
      if (!ws.some((w) => w.severity === 'warning')) continue;
      const f = this.layout.furniture.find((x) => x.id === id);
      if (!f) continue;
      this.warnGroup.add(this.lineLoop(occupiedFootprint(f, cfg), COLORS.warning, 0.03));
      this.warnGroup.add(this.fill(occupiedFootprint(f, cfg), COLORS.warning, 0.013, 0.12));
    }
    const sp = this.layout.room.spawn;
    this.spawnMarker.position.set(sp.x, 0.02, sp.z);
    this.spawnMarker.rotation.y = this.layout.room.spawnYaw;
    this.invalidate();
  }

  private makeSpawnMarker(): THREE.Object3D {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 32), new THREE.MeshBasicMaterial({ color: COLORS.deepRose, depthTest: false, transparent: true }));
    ring.rotation.x = -Math.PI / 2;
    const arrowShape = new THREE.Shape([new THREE.Vector2(0, 0.62), new THREE.Vector2(-0.18, 0.36), new THREE.Vector2(0.18, 0.36)]);
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), new THREE.MeshBasicMaterial({ color: COLORS.deepRose, depthTest: false, transparent: true }));
    // camera yaw 0 looks toward −Z; the arrow points that way
    arrow.rotation.x = -Math.PI / 2;
    ring.renderOrder = arrow.renderOrder = 11;
    g.add(ring, arrow);
    return g;
  }

  updateSelection(): void {
    this.clearGroup(this.selectionGroup);
    const sel = this.store.selection;
    const f = this.layout.furniture.find((x) => x.id === sel.furnitureId);
    if (f) {
      const occ = occupiedFootprint(f, this.layout.seating);
      this.selectionGroup.add(this.fill(occ, COLORS.selection, 0.014, 0.14));
      this.selectionGroup.add(this.band(occ, this.view === 'top' ? 3 / this.top.ppm : 0.06, COLORS.selection, 0.036));
      if (sel.seatId) {
        const pose = seatPoses(f, this.layout.seating).find((p) => p.seatId === sel.seatId);
        if (pose) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.27, 0.33, 32),
            new THREE.MeshBasicMaterial({ color: COLORS.black, depthTest: false, transparent: true, opacity: 0.85 }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(pose.position.x, 0.04, pose.position.z);
          ring.renderOrder = 12;
          this.selectionGroup.add(ring);
        }
      }
    }
    this.invalidate();
  }

  /** Render a clean overhead image of the whole room (used for PNG export / print). */
  renderPlanImage(pxPerMeter: number, maxSize = 4096): { canvas: HTMLCanvasElement; toPixel: (p: Vec2) => { x: number; y: number }; ppm: number } {
    const b = polygonBounds(this.layout.room.vertices);
    const pad = 1.2;
    const gl = this.renderer.getContext();
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    const limit = Math.min(maxSize, dims?.[0] ?? maxSize, dims?.[1] ?? maxSize);
    let w = (b.maxX - b.minX + pad * 2) * pxPerMeter;
    let h = (b.maxZ - b.minZ + pad * 2) * pxPerMeter;
    const scale = Math.min(1, limit / Math.max(w, h));
    const ppm = pxPerMeter * scale;
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const cam = new THREE.OrthographicCamera(-w / 2 / ppm, w / 2 / ppm, h / 2 / ppm, -h / 2 / ppm, 0.1, 200);
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    cam.up.set(0, 0, -1);
    cam.position.set(cx, 60, cz);
    cam.lookAt(cx, 0, cz);
    cam.updateProjectionMatrix();
    const prev = {
      sel: this.selectionGroup.visible,
      grid: this.gridGroup.visible,
      spawn: this.spawnMarker.visible,
      bg: this.scene.background,
      ratio: this.renderer.getPixelRatio(),
      size: { ...this.lastSize },
    };
    this.selectionGroup.visible = false;
    this.gridGroup.visible = false;
    this.spawnMarker.visible = false;
    this.scene.background = new THREE.Color(0xffffff);
    // Render through the normal output path (same tone mapping/colour as on screen), copy the
    // pixels synchronously, then restore — all within one task, so nothing flashes on screen.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, cam);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, w, h);
    this.selectionGroup.visible = prev.sel;
    this.gridGroup.visible = prev.grid;
    this.spawnMarker.visible = prev.spawn;
    this.scene.background = prev.bg;
    this.renderer.setPixelRatio(prev.ratio);
    this.renderer.setSize(prev.size.w, prev.size.h, false);
    this.renderer.render(this.scene, this.activeCamera);
    this.invalidate();
    return {
      canvas,
      ppm,
      toPixel: (p) => ({ x: (p.x - cx) * ppm + w / 2, y: (p.z - cz) * ppm + h / 2 }),
    };
  }

  dispose(): void {
    this.running = false;
    this.resizeObserver.disconnect();
    this.renderer.dispose();
  }
}
