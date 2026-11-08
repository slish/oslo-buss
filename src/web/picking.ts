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

  /** Where a scene point lands on the screen, in pixels; null behind the camera. */
  private project(x: number, y: number, z: number): [number, number] | null {
    this.v.set(x, y, z).project(this.w.camera);
    if (this.v.z > 1) return null;
    return [(this.v.x * 0.5 + 0.5) * window.innerWidth, (-this.v.y * 0.5 + 0.5) * window.innerHeight];
  }

  bus(cx: number, cy: number): Track | null {
    let best: Track | null = null, bestD = 18;
    for (const t of this.w.store.tracks.values()) {
      if (t.leaving || this.w.hidden(t.bus.line)) continue;
      const p = this.project(t.x, this.w.ground(t.x, t.z) + Picker.LIFT, t.z);
      if (!p) continue;
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      if (d < bestD) { best = t; bestD = d; }
    }
    return best;
  }

  stop(cx: number, cy: number): string | null {
    let best: string | null = null, bestD = 16;
    for (const s of this.w.stops) {
      const p = this.project(s.x, this.w.ground(s.x, s.z) + Picker.LIFT, s.z);
      if (!p) continue;
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      if (d < bestD) { best = s.id; bestD = d; }
    }
    return best;
  }

  /** The line whose road passes nearest the point. Only for a click: it projects every point of every road. */
  line(cx: number, cy: number): string | null {
    let best: string | null = null, bestD = 10;
    for (const { position, line } of this.w.roads) {
      let prev: [number, number] | null = null;
      for (let i = 0; i < position.count; i++) {
        const p = this.project(position.getX(i), position.getY(i), position.getZ(i));
        if (p && prev) {
          const dx = p[0] - prev[0], dy = p[1] - prev[1], len2 = dx * dx + dy * dy;
          const f = len2 > 0 ? Math.max(0, Math.min(1, ((cx - prev[0]) * dx + (cy - prev[1]) * dy) / len2)) : 0;
          const d = Math.hypot(cx - (prev[0] + f * dx), cy - (prev[1] + f * dy));
          if (d < bestD) { bestD = d; best = line; }
        }
        prev = p;
      }
    }
    return best;
  }
}
