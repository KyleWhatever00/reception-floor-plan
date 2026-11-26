import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import type { Store } from '../model/store';
import type { SceneManager } from '../scene/sceneManager';
import type { Vec2 } from '../model/types';
import { buildColliders, findFreeSpot, moveWithCollisions, type Collider } from './collision';
import { seatPoses, type SeatPose } from '../model/seats';
import { findSeat, guestById } from '../model/commands';
import { dist, polygonBounds, v2 } from '../model/geometry';
import { h, isTypingTarget, svgIcon } from '../ui/dom';
import { ICONS } from '../ui/icons';

const PLAYER_RADIUS = 0.25;
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

interface Joystick {
  pointerId: number;
  ox: number;
  oy: number;
  dx: number;
  dy: number;
}

/**
 * First-person walkthrough. Desktop: WASD + mouse (pointer lock). Touch: a floating joystick on
 * the left half and swipe-to-look on the right half, tracked by independent pointer IDs.
 */
export class Walkthrough {
  private controls: PointerLockControls;
  private colliders: Collider[] = [];
  private pos: Vec2 = v2(0, 0);
  private keys = new Set<string>();
  private joystick: Joystick | null = null;
  private lookPointers = new Map<number, { x: number; y: number }>();
  private mouseDrag: { id: number; x: number; y: number } | null = null;
  private seated: SeatPose | null = null;
  private seatedTableId: string | null = null;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private hud: HTMLElement;
  private stick: HTMLElement;
  private stickKnob: HTMLElement;
  private hint: HTMLElement;
  private seatInfo: HTMLElement;
  private sitBtn: HTMLButtonElement;
  private touchZone: HTMLElement;
  private usingTouch = false;
  private bobT = 0;
  onExit: () => void = () => {};

  constructor(private store: Store, private sm: SceneManager, root: HTMLElement) {
    this.controls = new PointerLockControls(sm.walkCam, sm.renderer.domElement);
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = Math.PI - 0.15;
    this.controls.pointerSpeed = 0.9;
    this.controls.addEventListener('lock', () => this.updateHint());
    this.controls.addEventListener('unlock', () => {
      this.keys.clear();
      this.updateHint();
    });
    this.controls.addEventListener('change', () => sm.invalidate());

    this.touchZone = h('div', { class: 'walk-touch-zone' });
    this.stickKnob = h('div', { class: 'joystick-knob' });
    this.stick = h('div', { class: 'joystick', 'aria-hidden': 'true' }, this.stickKnob);
    this.hint = h('div', { class: 'walk-hint' });
    this.seatInfo = h('div', { class: 'walk-seat-info', role: 'status', 'aria-live': 'polite' });
    this.sitBtn = h('button', { class: 'walk-btn', onclick: () => this.toggleSit() }, svgIcon(ICONS.chair), h('span', { class: 'sit-label' }, 'Sit'));
    this.hud = h(
      'div',
      { class: 'walk-hud' },
      this.touchZone,
      this.stick,
      h(
        'div',
        { class: 'walk-top' },
        h('button', { class: 'walk-btn walk-exit', onclick: () => this.exit(), title: 'Return to the floor plan editor' }, svgIcon(ICONS.exit), h('span', null, 'Back to editor')),
        h('div', { class: 'walk-top-right' },
          this.sitBtn,
          h('button', { class: 'walk-btn', onclick: () => this.recenter(), title: 'Level the view' }, svgIcon(ICONS.recenter), h('span', null, 'Level view')),
        ),
      ),
      this.seatInfo,
      this.hint,
    );
    this.hud.hidden = true;
    root.appendChild(this.hud);

    // touch / pen input on the overlay zone
    this.touchZone.addEventListener('pointerdown', (e) => this.onTouchDown(e));
    this.touchZone.addEventListener('pointermove', (e) => this.onTouchMove(e));
    this.touchZone.addEventListener('pointerup', (e) => this.onTouchUp(e));
    this.touchZone.addEventListener('pointercancel', (e) => this.onTouchUp(e));
    this.touchZone.addEventListener('lostpointercapture', (e) => this.onTouchUp(e));

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());
    window.addEventListener('orientationchange', () => this.releaseAll());

    sm.onFrame((dt) => this.update(dt));
    store.subscribe((e) => {
      if (this.store.mode === 'walk' && (e.kind === 'layout' || e.kind === 'project')) this.rebuildColliders();
    });
  }

  /** ID of the table the walker is seated at, if any. */
  get seatedTable(): string | null {
    return this.seated ? this.seatedTableId : null;
  }

  get active(): boolean {
    return this.store.mode === 'walk';
  }

  private rebuildColliders(): void {
    this.colliders = buildColliders(this.store.layout);
    if (!this.seated) {
      const free = findFreeSpot(this.pos, PLAYER_RADIUS, this.colliders, this.store.layout.room.vertices);
      this.pos = free;
    }
  }

  /** Enter the walkthrough at the entrance, or seated at a specific chair. */
  enter(opts: { seatId?: string } = {}): void {
    const layout = this.store.layout;
    this.store.setMode('walk');
    this.colliders = buildColliders(layout);
    this.seated = null;
    const spawn = findFreeSpot(layout.room.spawn, PLAYER_RADIUS, this.colliders, layout.room.vertices);
    this.pos = spawn;
    this.euler.set(-0.05, layout.room.spawnYaw, 0, 'YXZ');
    this.sm.walkCam.quaternion.setFromEuler(this.euler);
    this.hud.hidden = false;
    this.usingTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    this.hud.classList.toggle('touch', this.usingTouch);
    this.sm.setContinuous(true);
    if (opts.seatId) this.sitAt(opts.seatId);
    this.applyCamera(0);
    this.updateHint();
    this.updateSeatInfo();
  }

  exit(): void {
    if (!this.active) return;
    this.releaseAll();
    if (this.controls.isLocked) this.controls.unlock();
    this.seated = null;
    this.hud.hidden = true;
    this.sm.setContinuous(false);
    this.store.setMode('build');
    this.onExit();
  }

  // ------------------------------------------------------------------ seating

  private nearestSeat(maxDist = 1.6): { pose: SeatPose; tableId: string } | null {
    let best: { pose: SeatPose; tableId: string; d: number } | null = null;
    for (const f of this.store.layout.furniture) {
      if (!f.seats?.length) continue;
      for (const p of seatPoses(f, this.store.layout.seating)) {
        const d = dist(p.position, this.pos);
        if (d <= maxDist && (!best || d < best.d)) best = { pose: p, tableId: f.id, d };
      }
    }
    return best;
  }

  sitAt(seatId: string): void {
    const found = findSeat(this.store.layout, seatId);
    if (!found) return;
    const pose = seatPoses(found.table, this.store.layout.seating).find((p) => p.seatId === seatId);
    if (!pose) return;
    this.seated = pose;
    this.seatedTableId = found.table.id;
    this.keys.clear();
    this.joystick = null;
    this.stick.classList.remove('active');
    // face the table: camera looks along −Z locally, so yaw = atan2(−fx, −fz)
    this.euler.set(-0.22, Math.atan2(-pose.facing.x, -pose.facing.z), 0, 'YXZ');
    this.sm.walkCam.quaternion.setFromEuler(this.euler);
    this.updateSeatInfo();
    this.updateHint();
  }

  standUp(): void {
    if (!this.seated) return;
    const s = this.seated;
    this.seated = null;
    const behind = v2(s.position.x - s.facing.x * 0.6, s.position.z - s.facing.z * 0.6);
    this.pos = findFreeSpot(behind, PLAYER_RADIUS, this.colliders, this.store.layout.room.vertices);
    this.updateSeatInfo();
    this.updateHint();
  }

  private toggleSit(): void {
    if (this.seated) return this.standUp();
    const n = this.nearestSeat(2.2);
    if (n) this.sitAt(n.pose.seatId);
  }

  private updateSeatInfo(): void {
    if (!this.seated) {
      this.seatInfo.hidden = true;
      this.sitBtn.querySelector('.sit-label')!.textContent = 'Sit';
      return;
    }
    const found = findSeat(this.store.layout, this.seated.seatId);
    const guest = found ? guestById(this.store.layout, found.seat.guestId) : undefined;
    this.seatInfo.hidden = false;
    this.seatInfo.textContent = found ? `${found.table.label} · seat ${found.index + 1}${guest ? ` · ${guest.name}` : ' · open seat'}` : '';
    this.sitBtn.querySelector('.sit-label')!.textContent = 'Stand up';
  }

  recenter(): void {
    this.euler.setFromQuaternion(this.sm.walkCam.quaternion, 'YXZ');
    this.euler.x = this.seated ? -0.22 : 0;
    this.sm.walkCam.quaternion.setFromEuler(this.euler);
    this.sm.invalidate();
  }

  // ------------------------------------------------------------------ input

  private updateHint(): void {
    if (!this.active) return;
    let text: string;
    if (this.usingTouch) {
      text = this.seated ? 'Drag on the right to look around · tap Stand up to walk again' : 'Left thumb: move · right side: look around';
    } else if (this.controls.isLocked) {
      text = this.seated ? 'Mouse to look · Space or Stand up to walk · Esc to release the mouse' : 'W A S D to walk · Shift to hurry · Esc to release the mouse';
    } else {
      text = 'Click the view to look around with the mouse (or drag) · W A S D to walk';
    }
    this.hint.textContent = text;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.active || isTypingTarget(e.target)) return;
    if (down && e.code === 'Escape' && !this.controls.isLocked) {
      this.exit();
      return;
    }
    if (down && e.code === 'Space') {
      e.preventDefault();
      this.toggleSit();
      return;
    }
    if (MOVE_KEYS[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      e.preventDefault();
      if (down) this.keys.add(e.code);
      else this.keys.delete(e.code);
    }
  }

  releaseAll(): void {
    this.keys.clear();
    this.joystick = null;
    this.lookPointers.clear();
    this.mouseDrag = null;
    this.stick.classList.remove('active');
  }

  private onTouchDown(e: PointerEvent): void {
    if (!this.active) return;
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      // desktop: click to lock the pointer; fall back to drag-to-look if pointer lock is unavailable
      if (!this.controls.isLocked && 'requestPointerLock' in this.sm.renderer.domElement) {
        try {
          this.controls.lock();
        } catch {
          /* fall through to drag look */
        }
      }
      this.mouseDrag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      this.touchZone.setPointerCapture(e.pointerId);
      return;
    }
    this.usingTouch = true;
    this.hud.classList.add('touch');
    this.updateHint();
    this.touchZone.setPointerCapture(e.pointerId);
    const r = this.touchZone.getBoundingClientRect();
    const leftSide = e.clientX - r.left < r.width * 0.45;
    if (leftSide && !this.joystick && !this.seated) {
      this.joystick = { pointerId: e.pointerId, ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
      this.stick.classList.add('active');
      this.stick.style.left = `${e.clientX - r.left}px`;
      this.stick.style.top = `${e.clientY - r.top}px`;
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
    } else {
      this.lookPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  private onTouchMove(e: PointerEvent): void {
    if (!this.active) return;
    if (this.mouseDrag && this.mouseDrag.id === e.pointerId) {
      if (!this.controls.isLocked) this.look(e.clientX - this.mouseDrag.x, e.clientY - this.mouseDrag.y, 0.004);
      this.mouseDrag.x = e.clientX;
      this.mouseDrag.y = e.clientY;
      return;
    }
    if (this.joystick && this.joystick.pointerId === e.pointerId) {
      const max = 55;
      let dx = e.clientX - this.joystick.ox;
      let dy = e.clientY - this.joystick.oy;
      const l = Math.hypot(dx, dy);
      if (l > max) {
        dx = (dx / l) * max;
        dy = (dy / l) * max;
      }
      this.joystick.dx = dx / max;
      this.joystick.dy = dy / max;
      this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      return;
    }
    const lp = this.lookPointers.get(e.pointerId);
    if (lp) {
      this.look(e.clientX - lp.x, e.clientY - lp.y, 0.0055);
      lp.x = e.clientX;
      lp.y = e.clientY;
    }
  }

  private onTouchUp(e: PointerEvent): void {
    if (this.mouseDrag?.id === e.pointerId) this.mouseDrag = null;
    if (this.joystick?.pointerId === e.pointerId) {
      this.joystick = null;
      this.stick.classList.remove('active');
    }
    this.lookPointers.delete(e.pointerId);
  }

  private look(dx: number, dy: number, speed: number): void {
    this.euler.setFromQuaternion(this.sm.walkCam.quaternion, 'YXZ');
    this.euler.y -= dx * speed;
    this.euler.x = Math.max(-1.35, Math.min(1.35, this.euler.x - dy * speed));
    this.sm.walkCam.quaternion.setFromEuler(this.euler);
    this.sm.invalidate();
  }

  // ------------------------------------------------------------------ frame update

  private update(dt: number): void {
    if (!this.active) return;
    if (!this.seated) {
      let fx = 0, fz = 0;
      for (const k of this.keys) {
        const m = MOVE_KEYS[k];
        if (m) {
          fx += m[0];
          fz += m[1];
        }
      }
      if (this.joystick) {
        fx += this.joystick.dx;
        fz += -this.joystick.dy;
      }
      const mag = Math.hypot(fx, fz);
      if (mag > 0.08) {
        if (mag > 1) {
          fx /= mag;
          fz /= mag;
        }
        const hurry = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 1.8 : 1;
        const speed = this.store.settings.walkSpeed * hurry;
        this.euler.setFromQuaternion(this.sm.walkCam.quaternion, 'YXZ');
        const yaw = this.euler.y;
        const forward = v2(-Math.sin(yaw), -Math.cos(yaw));
        const right = v2(Math.cos(yaw), -Math.sin(yaw));
        const delta = v2((forward.x * fz + right.x * fx) * speed * dt, (forward.z * fz + right.z * fx) * speed * dt);
        this.pos = moveWithCollisions(this.pos, delta, PLAYER_RADIUS, this.colliders);
        this.clampToWorld();
        this.bobT += dt * Math.min(1, Math.hypot(fx, fz)) * 9;
      }
    }
    this.applyCamera(dt);
  }

  private clampToWorld(): void {
    const b = polygonBounds(this.store.layout.room.vertices);
    const m = 25;
    this.pos.x = Math.min(b.maxX + m, Math.max(b.minX - m, this.pos.x));
    this.pos.z = Math.min(b.maxZ + m, Math.max(b.minZ - m, this.pos.z));
  }

  private applyCamera(_dt: number): void {
    const cam = this.sm.walkCam;
    if (this.seated) {
      const s = this.seated;
      cam.position.set(s.position.x - s.facing.x * 0.06, this.store.settings.seatedEyeHeight, s.position.z - s.facing.z * 0.06);
    } else {
      const bob = Math.sin(this.bobT) * 0.012;
      cam.position.set(this.pos.x, this.store.settings.eyeHeight + bob, this.pos.z);
    }
    if (this.seated && this.seatedTableId && !this.store.layout.furniture.some((f) => f.id === this.seatedTableId)) this.standUp();
  }
}
