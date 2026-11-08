// Clipping lines and rings to the axis-aligned rectangle of a tile.
import type { XY } from '../../src/shared/tiles';

export interface Rect { x0: number; z0: number; x1: number; z1: number }

/** The parts of a polyline inside the rectangle, with interpolated points on its edge. */
export function clipLine(pts: XY[], r: Rect): XY[][] {
  const out: XY[][] = [];
  let cur: XY[] = [];
  const flush = () => { if (cur.length > 1) out.push(cur); cur = []; };
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dz, dz], q = [ax - r.x0, r.x1 - ax, az - r.z0, r.z1 - az];
    let inside = true;
    for (let k = 0; k < 4; k++) {
      if (p[k] === 0) { if (q[k] < 0) { inside = false; break; } continue; }
      const t = q[k] / p[k];
      if (p[k] < 0) { if (t > t1) { inside = false; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { inside = false; break; } if (t < t1) t1 = t; }
    }
    if (!inside) { flush(); continue; }
    const s: XY = [ax + t0 * dx, az + t0 * dz], e: XY = [ax + t1 * dx, az + t1 * dz];
    const last = cur[cur.length - 1];
    if (!last || last[0] !== s[0] || last[1] !== s[1]) { flush(); cur.push(s); }
    cur.push(e);
    if (t1 < 1) flush();
  }
  flush();
  return out;
}

/** Sutherland-Hodgman. For a concave ring the result can have zero-width bridges along the edge, which fill the same. */
export function clipRing(ring: XY[], r: Rect): XY[] {
  const edges: ((p: XY) => boolean)[] = [(p) => p[0] >= r.x0, (p) => p[0] <= r.x1, (p) => p[1] >= r.z0, (p) => p[1] <= r.z1];
  const cut = (a: XY, b: XY, k: number): XY => {
    const edge = [r.x0, r.x1, r.z0, r.z1][k];
    if (k < 2) { const t = (edge - a[0]) / (b[0] - a[0]); return [edge, a[1] + t * (b[1] - a[1])]; }
    const t = (edge - a[1]) / (b[1] - a[1]);
    return [a[0] + t * (b[0] - a[0]), edge];
  };
  let pts = ring;
  for (let k = 0; k < 4 && pts.length; k++) {
    const next: XY[] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i], prev = pts[(i + pts.length - 1) % pts.length];
      const ci = edges[k](cur), pi = edges[k](prev);
      if (ci) { if (!pi) next.push(cut(prev, cur, k)); next.push(cur); }
      else if (pi) next.push(cut(prev, cur, k));
    }
    pts = next;
  }
  return pts.length >= 3 ? pts : [];
}

export function ringArea(ring: XY[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const [x0, z0] = ring[i], [x1, z1] = ring[(i + 1) % ring.length]; a += x0 * z1 - x1 * z0; }
  return a / 2;
}
