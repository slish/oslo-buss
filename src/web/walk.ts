// Walking on the ground, seen through the eyes of a person. The movement is pure (no DOM, no three.js camera) so it can be tested;
// `WalkInput` at the bottom turns the keyboard, the mouse (pointer lock or dragging) and touch into the numbers it needs.

import { MathUtils } from 'three';

export const EYE_HEIGHT = 1.7; // meters over the ground
export const WALK_SPEED = 2; // m/s: a brisk walk
export const RUN_SPEED = 8; // m/s
export const BODY_RADIUS = 0.4; // meters: how close to a wall we get
const MAX_PITCH = 1.45; // a little short of straight up or down
const SPEED_EASE = 10; // 1/s: how quickly we get up to speed and stop
const EYE_EASE = 9; // 1/s: how quickly the eyes follow the ground, so that a bump is not a jolt
const MAX_STEP = 0.8; // meters per step in the collision search; longer moves (a slow frame) are split

export interface WalkState {
  x: number; z: number;
  /** Radians clockwise from north (north is -z), like the bearing of a bus. */
  yaw: number;
  /** Radians over the horizon. */
  pitch: number;
  /** Where the eyes are, in meters. */
  eyeY: number;
  /** Velocity over the ground in m/s (eased, so that a stop is not abrupt). */
  vx: number; vz: number;
}
/** forward and strafe go from -1 to 1 (forward is ahead, strafe is to the right). */
export interface WalkInputAxes { forward: number; strafe: number; run: boolean }
export type Ground = (x: number, z: number) => number;
/** True where a person cannot stand (inside a building). */
export type Blocked = (x: number, z: number) => boolean;

export function startWalk(x: number, z: number, yaw: number, ground: Ground): WalkState {
  return { x, z, yaw, pitch: 0, eyeY: ground(x, z) + EYE_HEIGHT, vx: 0, vz: 0 };
}

/** Turns the view by a pointer movement (pixels) and keeps the pitch short of straight up and down. */
export function lookBy(s: WalkState, dx: number, dy: number, sensitivity = 0.0025): WalkState {
  const yaw = s.yaw + dx * sensitivity;
  return { ...s, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pitch: MathUtils.clamp(s.pitch - dy * sensitivity, -MAX_PITCH, MAX_PITCH) };
}

/**
 * Moves from (x, z) to (nx, nz) without ending inside a blocked place: if the whole move is blocked we try to slide along one axis.
 * Someone who already is inside a blocked place (they started there) may walk out of it.
 */
export function slide(x: number, z: number, nx: number, nz: number, blocked: Blocked | undefined, radius = BODY_RADIUS): [number, number] {
  if (!blocked) return [nx, nz];
  const hit = (px: number, pz: number) => blocked(px, pz) || blocked(px + radius, pz) || blocked(px - radius, pz) || blocked(px, pz + radius) || blocked(px, pz - radius);
  if (hit(x, z)) return [nx, nz]; // stuck inside: let go, or we could never get out
  if (!hit(nx, nz)) return [nx, nz];
  if (!hit(nx, z)) return [nx, z];
  if (!hit(x, nz)) return [x, nz];
  return [x, z];
}

/** One frame of walking. `ground` is the height of the terrain; `blocked` (optional) keeps us out of buildings. */
export function stepWalk(s: WalkState, input: WalkInputAxes, dt: number, ground: Ground, blocked?: Blocked): WalkState {
  dt = Math.min(dt, 0.25);
  const len = Math.hypot(input.forward, input.strafe);
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  const f = len > 1 ? input.forward / len : input.forward, r = len > 1 ? input.strafe / len : input.strafe; // no faster diagonally
  const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
  // On the map forward is (sin, -cos) and right is (cos, sin).
  const wantX = (sin * f + cos * r) * speed, wantZ = (-cos * f + sin * r) * speed;
  const k = 1 - Math.exp(-dt * SPEED_EASE);
  let vx = s.vx + (wantX - s.vx) * k, vz = s.vz + (wantZ - s.vz) * k;
  let x = s.x, z = s.z;
  const dist = Math.hypot(vx, vz) * dt, parts = Math.max(1, Math.ceil(dist / MAX_STEP));
  for (let i = 0; i < parts; i++) [x, z] = slide(x, z, x + (vx * dt) / parts, z + (vz * dt) / parts, blocked);
  if (x === s.x && z === s.z) { vx = 0; vz = 0; }
  // The eyes ease toward the ground height, but never sink far under it.
  const eyeWant = ground(x, z) + EYE_HEIGHT;
  const e = s.eyeY + (eyeWant - s.eyeY) * (1 - Math.exp(-dt * EYE_EASE));
  return { ...s, x, z, vx, vz, eyeY: Math.max(e, eyeWant - 0.3) };
}

/** The direction the eyes look in, as a unit vector (x east, y up, z south). */
export function lookDirection(s: WalkState): [number, number, number] {
  const c = Math.cos(s.pitch);
  return [Math.sin(s.yaw) * c, Math.sin(s.pitch), -Math.cos(s.yaw) * c];
}

// ---- input ----

/** The keys, the mouse and the fingers, as the numbers `stepWalk` and `lookBy` want. `enable(true)` starts listening. */
export class WalkInput {
  private on = false;
  private readonly keys = new Set<string>();
  private lookX = 0;
  private lookY = 0;
  private stick: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private looker: { id: number; x: number; y: number } | null = null;
  private readonly ring: HTMLElement;
  private locked = false;
  /** Called when the browser takes the pointer lock back (Esc) while we were walking. */
  onLockLost: () => void = () => {};

  constructor(private readonly canvas: HTMLElement) {
    this.ring = document.createElement('div');
    this.ring.id = 'walk-stick';
    this.ring.hidden = true;
    this.ring.innerHTML = '<div class="knob"></div>';
    document.body.append(this.ring);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (this.on && document.pointerLockElement === canvas) { this.lookX += e.movementX; this.lookY += e.movementY; }
    });
    document.addEventListener('pointerlockchange', () => {
      const now = document.pointerLockElement === canvas;
      if (this.locked && !now && this.on && document.hasFocus()) this.onLockLost(); // Esc, not a switch to another window
      this.locked = now;
    });
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
  }

  enable(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.keys.clear(); this.lookX = this.lookY = 0; this.stick = this.looker = null;
    this.ring.hidden = true;
    if (on) this.lock(); else if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  /** Mouse look wants the pointer captured; browsers allow it only after a gesture, so this can fail quietly. */
  lock(): void {
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch { /* no lock: dragging still looks around */ }
  }

  axes(): WalkInputAxes {
    const k = this.keys;
    let forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let run = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.stick) {
      const dx = this.stick.x - this.stick.x0, dy = this.stick.y - this.stick.y0;
      const m = Math.min(1, Math.hypot(dx, dy) / 50);
      if (m > 0.15) { const a = Math.atan2(dx, -dy); forward += Math.cos(a) * m; strafe += Math.sin(a) * m; run = run || m > 0.95; }
    }
    return { forward: MathUtils.clamp(forward, -1, 1), strafe: MathUtils.clamp(strafe, -1, 1), run };
  }

  /** The pointer movement since the last call, in pixels. */
  takeLook(): [number, number] {
    const r: [number, number] = [this.lookX, this.lookY];
    this.lookX = this.lookY = 0;
    return r;
  }

  private key(e: KeyboardEvent, down: boolean): void {
    if (!this.on) return;
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (down && /^(Arrow|Space)/.test(e.code)) e.preventDefault();
  }

  // Touch: a finger on the left half of the screen is a stick, on the right half it looks around.
  // A mouse looks by dragging when there is no pointer lock.
  private readonly down = (e: PointerEvent): void => {
    if (!this.on) return;
    if (e.pointerType !== 'touch') {
      if (document.pointerLockElement !== this.canvas) this.lock();
      this.looker = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.clientX < window.innerWidth / 2 && !this.stick) {
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      this.ring.hidden = false;
      this.ring.style.left = e.clientX + 'px';
      this.ring.style.top = e.clientY + 'px';
      this.knob(0, 0);
    } else if (!this.looker) this.looker = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };

  private readonly move = (e: PointerEvent): void => {
    if (!this.on) return;
    if (this.stick?.id === e.pointerId) {
      this.stick.x = e.clientX; this.stick.y = e.clientY;
      const dx = e.clientX - this.stick.x0, dy = e.clientY - this.stick.y0, m = Math.hypot(dx, dy), k = m > 50 ? 50 / m : 1;
      this.knob(dx * k, dy * k);
    } else if (this.looker?.id === e.pointerId && document.pointerLockElement !== this.canvas) {
      const gain = e.pointerType === 'touch' ? 1.4 : 1;
      this.lookX += (e.clientX - this.looker.x) * gain;
      this.lookY += (e.clientY - this.looker.y) * gain;
      this.looker.x = e.clientX; this.looker.y = e.clientY;
    }
  };

  private readonly up = (e: PointerEvent): void => {
    if (this.stick?.id === e.pointerId) { this.stick = null; this.ring.hidden = true; }
    if (this.looker?.id === e.pointerId) this.looker = null;
  };

  private knob(x: number, y: number): void {
    (this.ring.firstElementChild as HTMLElement).style.transform = `translate(${x}px, ${y}px)`;
  }
}
