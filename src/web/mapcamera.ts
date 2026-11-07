// A map-style camera. The camera looks at a point on the ground (`focus`) from `distance` meters, at `yaw` and `elevation`.
// - Wheel/pinch zooms about the point under the pointer (that ground point stays where it is on the screen), with no
//   distance to a fixed target that can run out: moving the focus toward the pointer is what lets you get close.
// - Dragging pans by grabbing the ground (the grabbed point stays under the pointer at every zoom level).
// - Right/middle/shift-drag, or two fingers, turn and tilt around the focus.
// The state we ask for eases toward `want`; what we render is `now`.

import { MathUtils, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { WalkInput, lookBy, lookDirection, startWalk, stepWalk, type Blocked, type WalkState } from './walk';

export interface View { x: number; z: number; distance: number; yaw: number; elevation: number }

export const MIN_DISTANCE = 4;
export const MAX_DISTANCE = 120_000;
const MIN_ELEVATION = 0.04; // about 2 degrees over the horizon
const MAX_ELEVATION = 1.5;  // about 86 degrees: almost straight down
const CAMERA_CLEARANCE = 2.5; // meters above the ground

/** Scales the whole camera rig about the ground point `px, pz` by `f`: the point keeps its place on the screen. */
export function zoomAbout(v: View, px: number, pz: number, f: number): View {
  const clamped = MathUtils.clamp(v.distance * f, MIN_DISTANCE, MAX_DISTANCE) / v.distance;
  return { ...v, x: px + (v.x - px) * clamped, z: pz + (v.z - pz) * clamped, distance: v.distance * clamped };
}

export function cameraPosition(v: View, focusY: number, out = new Vector3()): Vector3 {
  const c = Math.cos(v.elevation);
  return out.set(v.x + v.distance * Math.sin(v.yaw) * c, focusY + v.distance * Math.sin(v.elevation), v.z + v.distance * Math.cos(v.yaw) * c);
}

type Ground = (x: number, z: number) => number;

export class MapCamera {
  /** The point on the ground we look at (rendered state). */
  readonly target = new Vector3();
  private want: View;
  private now: View;
  private ground: Ground = () => 0;
  private readonly scratch = new PerspectiveCamera();
  private readonly ray = new Raycaster();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private mode: 'pan' | 'turn' | 'pinch' | null = null;
  private grab: Vector3 | null = null;
  private pinch = { distance: 0, angle: 0, x: 0, y: 0 };
  /** While riding: where the bus is, and which way it heads (degrees clockwise from north). */
  private ridden: { x: number; y: number; z: number; bearing: number } | null = null;
  private heading = 0; // smoothed, radians
  private look = { yaw: 0, pitch: -0.04 }; // where the passenger looks, relative to the bus
  private seat = new Vector3();
  /** While walking on the ground: where we stand and look. The orbit view (`want`/`now`) is left alone, to go back to. */
  private walker: WalkState | null = null;
  private readonly walkInput: WalkInput;
  private blocked: Blocked | undefined;

  constructor(readonly camera: PerspectiveCamera, private readonly canvas: HTMLElement, start: View) {
    this.want = { ...start };
    this.now = { ...start };
    canvas.style.touchAction = 'none';
    this.walkInput = new WalkInput(canvas);
    this.walkInput.onLockLost = () => this.stopWalking();
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('dblclick', this.onDouble);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKey);
  }

  get riding(): boolean { return this.ridden !== null; }
  get walking(): boolean { return this.walker !== null; }
  /** Seen from a seat or from the ground: no distance to a target, so near/far and the like are set for a person. */
  get firstPerson(): boolean { return this.ridden !== null || this.walker !== null; }
  get walkPosition(): { x: number; z: number } | null { return this.walker ? { x: this.walker.x, z: this.walker.z } : null; }

  /** Step down on the ground at `x, z` (looking `yaw` radians clockwise from north; the way the orbit camera looked by default). */
  startWalking(x: number, z: number, yaw = this.now.yaw + Math.PI): void {
    if (this.ridden) return;
    this.walker = startWalk(x, z, yaw, this.ground);
    this.walkInput.enable(true);
    this.mode = null; this.pointers.clear();
  }

  /** Back to the orbit view we left: it floats up from where we stood. */
  stopWalking(): void {
    const w = this.walker;
    if (!w) return;
    this.walker = null;
    this.walkInput.enable(false);
    this.now = { x: w.x, z: w.z, distance: 8, yaw: w.yaw + Math.PI, elevation: 0.2 };
  }

  /** Whether walls stop the walker: pass a test for a place that cannot be stood on, or undefined to walk through everything. */
  setBlocked(blocked: Blocked | undefined): void { this.blocked = blocked; }

  /** The ground under a point of the screen, as the orbit camera sees it (null above the horizon). */
  pickGround(clientX: number, clientY: number): { x: number; z: number } | null {
    const p = this.groundAt(clientX, clientY);
    return p ? { x: p.x, z: p.z } : null;
  }

  /** Sit on a bus: call every frame with its place while riding, and with null to get off. */
  follow(bus: { x: number; y: number; z: number; bearing: number } | null): void {
    if (bus && !this.ridden) {
      this.heading = (bus.bearing * Math.PI) / 180;
      this.look = { yaw: 0, pitch: -0.04 };
      this.seat.set(bus.x, bus.y, bus.z);
    } else if (!bus && this.ridden) {
      // Getting off: float up behind the bus, looking down on it from a few dozen meters.
      const r = this.ridden;
      this.want = { x: r.x, z: r.z, distance: 60, yaw: this.heading + this.look.yaw + Math.PI, elevation: 0.5 };
      this.now = { ...this.want, distance: 8, elevation: 0.2 };
    }
    this.ridden = bus;
  }

  get distance(): number { return this.now.distance; }
  get view(): View { return { ...this.now }; }
  setGround(ground: Ground): void { this.ground = ground; }
  /** Jumps to a view without easing (dev tools and tests). */
  jump(v: Partial<View>): void { Object.assign(this.want, v); Object.assign(this.now, this.want); this.place(); }

  /** Call every frame: eases toward what was asked, keeps the camera above the ground, and moves the real camera. */
  update(dt: number): void {
    if (this.ridden) return this.updateRide(dt);
    if (this.walker) return this.updateWalk(dt);
    const k = 1 - Math.exp(-dt * 16);
    const n = this.now, w = this.want;
    n.x += (w.x - n.x) * k;
    n.z += (w.z - n.z) * k;
    n.distance *= Math.pow(w.distance / n.distance, k); // zoom is multiplicative, so it eases in the logarithm
    n.yaw += (w.yaw - n.yaw) * k;
    n.elevation += (w.elevation - n.elevation) * k;
    this.place();
  }

  private updateWalk(dt: number): void {
    const [lx, ly] = this.walkInput.takeLook();
    let w = lx || ly ? lookBy(this.walker!, lx, ly) : this.walker!;
    w = stepWalk(w, this.walkInput.axes(), dt, this.ground, this.blocked);
    this.walker = w;
    const [dx, dy, dz] = lookDirection(w);
    this.camera.position.set(w.x, w.eyeY, w.z);
    this.camera.lookAt(w.x + dx * 10, w.eyeY + dy * 10, w.z + dz * 10);
    this.target.set(w.x, this.ground(w.x, w.z), w.z); // the map loads the terrain around this
    this.now.x = w.x; this.now.z = w.z;
  }

  private updateRide(dt: number): void {
    const r = this.ridden!, k = 1 - Math.exp(-dt * 6);
    // The road bends in corners: ease toward the bearing along the short way round, so the view turns instead of snapping.
    let target = (r.bearing * Math.PI) / 180, d = target - this.heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * k;
    if (this.mode !== 'turn') { // let go: the view eases back to the road ahead
      this.look.yaw *= Math.exp(-dt * 1.5);
      this.look.pitch += (-0.04 - this.look.pitch) * (1 - Math.exp(-dt * 1.5));
    }
    const yaw = this.heading + this.look.yaw, pitch = this.look.pitch;
    const dx = Math.sin(yaw) * Math.cos(pitch), dz = -Math.cos(yaw) * Math.cos(pitch), dy = Math.sin(pitch);
    // The eyes sit above the highest ground under the bus and a few meters the way we look: a hill must not swallow the view.
    // Up is immediate, down eases, so the view does not bob.
    const hx = Math.sin(yaw), hz = -Math.cos(yaw);
    const ground = Math.max(r.y, this.ground(r.x, r.z), this.ground(r.x + hx * 8, r.z + hz * 8), this.ground(r.x + hx * 20, r.z + hz * 20));
    this.seat.set(r.x, ground > this.seat.y ? ground : this.seat.y + (ground - this.seat.y) * Math.min(1, k * 2), r.z);
    this.camera.position.set(this.seat.x, this.seat.y + 3.2, this.seat.z); // the eyes of a passenger, a little above the road
    this.camera.lookAt(this.camera.position.x + dx * 40, this.camera.position.y + dy * 40, this.camera.position.z + dz * 40);
    this.target.set(r.x, r.y, r.z);
    this.now.x = r.x; this.now.z = r.z;
  }

  private place(): void {
    const n = this.now;
    const focusY = this.ground(n.x, n.z);
    this.target.set(n.x, focusY, n.z);
    const pos = cameraPosition(n, focusY, this.camera.position);
    // Do not sink into a hill: if the ground under the camera is higher, tilt up (more elevation) until it is clear.
    const low = this.ground(pos.x, pos.z) + CAMERA_CLEARANCE - pos.y;
    if (low > 0) pos.y += low;
    this.camera.position.copy(pos);
    this.camera.lookAt(this.target);
  }

  // ---- finding the ground under the pointer ----

  /** Ray from the camera that the *wanted* state would have, through the pointer. */
  private rayAt(clientX: number, clientY: number): Raycaster {
    const s = this.scratch;
    s.fov = this.camera.fov; s.aspect = this.camera.aspect; s.near = 1; s.far = 1e6;
    s.updateProjectionMatrix();
    const w = this.want, focusY = this.ground(w.x, w.z);
    cameraPosition(w, focusY, s.position);
    s.lookAt(w.x, focusY, w.z);
    s.updateMatrixWorld();
    const r = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -(((clientY - r.top) / r.height) * 2 - 1));
    this.ray.setFromCamera(ndc, s);
    return this.ray;
  }

  /** The ground point under the pointer, or null when the pointer is above the horizon. */
  private groundAt(clientX: number, clientY: number): Vector3 | null {
    const { origin, direction } = this.rayAt(clientX, clientY).ray;
    if (direction.y > -0.02) return null;
    let y = this.ground(this.want.x, this.want.z);
    const p = new Vector3();
    for (let i = 0; i < 4; i++) {
      p.copy(origin).addScaledVector(direction, (y - origin.y) / direction.y);
      y = this.ground(p.x, p.z);
    }
    p.y = y;
    return p;
  }

  /** Like `groundAt`, but never far beyond the focus: close to the horizon one pixel is kilometers. */
  private anchorAt(clientX: number, clientY: number): Vector3 {
    const w = this.want;
    const p = this.groundAt(clientX, clientY) ?? new Vector3(w.x, 0, w.z);
    const dx = p.x - w.x, dz = p.z - w.z, reach = Math.hypot(dx, dz), max = w.distance * 3;
    if (reach > max) { p.x = w.x + (dx * max) / reach; p.z = w.z + (dz * max) / reach; }
    return p;
  }

  private zoom(clientX: number, clientY: number, f: number): void {
    const p = this.anchorAt(clientX, clientY);
    this.want = zoomAbout(this.want, p.x, p.z, f);
  }

  // ---- input ----

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.firstPerson) return;
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const delta = MathUtils.clamp(e.deltaY * lines, -240, 240);
    this.zoom(e.clientX, e.clientY, Math.exp(delta * (e.ctrlKey ? 0.01 : 0.0018))); // ctrl is the pinch of a trackpad
  };

  private readonly onDouble = (e: MouseEvent): void => {
    if (this.firstPerson || e.altKey) return; // alt + double click is for standing on the ground (see main.ts)
    this.zoom(e.clientX, e.clientY, e.shiftKey ? 2.5 : 0.4);
  };

  private readonly onDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    if (this.walker) return; // the walker has its own input
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ridden) { this.mode = 'turn'; return; }
    if (this.pointers.size === 2) { this.startPinch(); return; }
    if (this.pointers.size > 2) return;
    this.mode = e.button === 2 || e.button === 1 || e.shiftKey || e.ctrlKey || e.metaKey ? 'turn' : 'pan';
    this.grab = this.mode === 'pan' ? this.groundAt(e.clientX, e.clientY) : null;
    if (this.mode === 'pan' && !this.grab) this.mode = null;
  };

  private readonly onMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    prev.x = e.clientX; prev.y = e.clientY;
    if (this.ridden) { // look around from the seat; the view eases back to the road ahead when you let go
      if (this.mode === 'turn') {
        this.look.yaw = MathUtils.clamp(this.look.yaw + dx * 0.006, -Math.PI, Math.PI);
        this.look.pitch = MathUtils.clamp(this.look.pitch - dy * 0.005, -0.9, 0.7);
      }
      return;
    }
    if (this.mode === 'pinch' && this.pointers.size === 2) { this.movePinch(); return; }
    if (this.mode === 'turn') {
      this.want.yaw -= dx * 0.006;
      this.want.elevation = MathUtils.clamp(this.want.elevation + dy * 0.006, MIN_ELEVATION, MAX_ELEVATION);
    } else if (this.mode === 'pan' && this.grab) {
      // The grabbed ground point must be under the pointer again: slide the focus by the difference.
      const { origin, direction } = this.rayAt(e.clientX, e.clientY).ray;
      if (direction.y > -0.02) return;
      const t = (this.grab.y - origin.y) / direction.y;
      this.want.x += this.grab.x - (origin.x + direction.x * t);
      this.want.z += this.grab.z - (origin.z + direction.z * t);
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.pointers.size === 1) { // one finger left after a pinch: carry on panning from where it is
      const [rest] = this.pointers.values();
      this.mode = 'pan';
      this.grab = this.groundAt(rest.x, rest.y);
      if (!this.grab) this.mode = null;
    } else if (this.pointers.size === 0) { this.mode = null; this.grab = null; }
  };

  private pinchState(): { distance: number; angle: number; x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private startPinch(): void { this.mode = 'pinch'; this.grab = null; this.pinch = this.pinchState(); }

  private movePinch(): void {
    const p = this.pinchState(), last = this.pinch;
    if (last.distance > 1 && p.distance > 1) this.zoom(p.x, p.y, last.distance / p.distance);
    let da = p.angle - last.angle;
    if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
    this.want.yaw += da;
    this.want.elevation = MathUtils.clamp(this.want.elevation - (p.y - last.y) * 0.004, MIN_ELEVATION, MAX_ELEVATION);
    this.pinch = p;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (this.firstPerson) return;
    const w = this.want, step = w.distance * 0.12;
    const forward = [-Math.sin(w.yaw), -Math.cos(w.yaw)], right = [Math.cos(w.yaw), -Math.sin(w.yaw)];
    const move = (f: number, r: number) => { w.x += forward[0] * step * f + right[0] * step * r; w.z += forward[1] * step * f + right[1] * step * r; };
    if (e.shiftKey && e.key === 'ArrowLeft') w.yaw += 0.15;
    else if (e.shiftKey && e.key === 'ArrowRight') w.yaw -= 0.15;
    else if (e.shiftKey && e.key === 'ArrowUp') w.elevation = Math.min(MAX_ELEVATION, w.elevation + 0.1);
    else if (e.shiftKey && e.key === 'ArrowDown') w.elevation = Math.max(MIN_ELEVATION, w.elevation - 0.1);
    else if (e.key === 'ArrowUp') move(1, 0);
    else if (e.key === 'ArrowDown') move(-1, 0);
    else if (e.key === 'ArrowLeft') move(0, -1);
    else if (e.key === 'ArrowRight') move(0, 1);
    else if (e.key === '+' || e.key === '=') w.distance = Math.max(MIN_DISTANCE, w.distance * 0.8);
    else if (e.key === '-') w.distance = Math.min(MAX_DISTANCE, w.distance * 1.25);
    else return;
    e.preventDefault();
  };
}
