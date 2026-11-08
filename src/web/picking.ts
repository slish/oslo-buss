// Finding what the pointer is over: the bus, the stop or the road nearest to a point of the screen, within a few pixels.

import { Vector3, type Camera } from 'three';
import type { BusStore, Track } from './store';

export interface PickWorld {
  camera: Camera;
  store: BusStore;
  /** Height of the ground at a scene point (0 without terrain). */
  ground: (x: number, z: number) => number;
  hidden: (line: string) => boolean;
  stops: { id: string; x: number; z: number }[];
  /** The road of each shape, as the points drawn, and the line it belongs to. */
  roads: { position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number }; line: string | null }[];
}

export class Picker {
  private readonly v = new Vector3();

  constructor(private readonly w: PickWorld) {}

  /** Meters over the ground where buses and stops are picked: their lights hover a little over the street. */
  static readonly LIFT = 3;

  private sx = 0;
  private sy = 0;

  /** Puts where a scene point lands on the screen (pixels) in sx, sy; false behind the camera. Allocates nothing: it runs for thousands of points. */
  private project(x: number, y: number, z: number): boolean {
    this.v.set(x, y, z).project(this.w.camera);
    if (this.v.z > 1) return false;
    this.sx = (this.v.x * 0.5 + 0.5) * window.innerWidth;
    this.sy = (-this.v.y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }

  bus(cx: number, cy: number): Track | null {
    let best: Track | null = null, bestD = 18;
    for (const t of this.w.store.tracks.values()) {
      if (t.leaving || this.w.hidden(t.bus.line)) continue;
      if (!this.project(t.x, this.w.ground(t.x, t.z) + Picker.LIFT, t.z)) continue;
      const d = Math.hypot(this.sx - cx, this.sy - cy);
      if (d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  stop(cx: number, cy: number): string | null {
    let best: string | null = null, bestD = 16;
    for (const s of this.w.stops) {
      if (!this.project(s.x, this.w.ground(s.x, s.z) + Picker.LIFT, s.z)) continue;
      const d = Math.hypot(this.sx - cx, this.sy - cy);
      if (d < bestD) { best = s.id; bestD = d; }
    }
    return best;
  }

  /** The line whose road passes nearest the point. Only for a click: it projects every point of every road. */
  line(cx: number, cy: number): string | null {
    let best: string | null = null, bestD = 10;
    for (const { position, line } of this.w.roads) {
      let px = 0, py = 0, have = false;
      for (let i = 0; i < position.count; i++) {
        const on = this.project(position.getX(i), position.getY(i), position.getZ(i));
        if (on && have) {
          const dx = this.sx - px, dy = this.sy - py, len2 = dx * dx + dy * dy;
          const f = len2 > 0 ? Math.max(0, Math.min(1, ((cx - px) * dx + (cy - py) * dy) / len2)) : 0;
          const d = Math.hypot(cx - (px + f * dx), cy - (py + f * dy));
          if (d < bestD) { bestD = d; best = line; }
        }
        have = on; px = this.sx; py = this.sy;
      }
    }
    return best;
  }
}
