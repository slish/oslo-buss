// Roofs: what a tile says about a roof (OpenStreetMap's roof:shape), or else a guess from the footprint and the kind of building.
// A roof is planned on the smallest rectangle around the footprint; a footprint that is not close to a rectangle gets a flat roof.

import type { XY } from './geom';

/** The roof codes of a tile building: 0 = not known (guess), then the shapes. */
export const ROOF_SHAPES = ['auto', 'flat', 'gabled', 'hipped', 'skillion'] as const;
export type RoofCode = 0 | 1 | 2 | 3 | 4;

/** OSM `roof:shape` values to roof codes. Shapes that are not drawn are the nearest one that is. */
export function roofCodeOf(shape: string | undefined): RoofCode {
  switch (shape) {
    case 'flat': return 1;
    case 'gabled': case 'gambrel': case 'saltbox': case 'mansard': return 2;
    case 'hipped': case 'half-hipped': case 'pyramidal': return 3;
    case 'skillion': case 'lean_to': return 4;
    default: return 0;
  }
}

/** A roof to draw. The ridge (or, for a skillion roof, the high edge) runs along (ax, az) through (cx, cz). */
export interface RoofPlan {
  kind: 'gabled' | 'hipped' | 'skillion';
  cx: number; cz: number;
  /** Unit vector along the long side of the building. */
  ax: number; az: number;
  /** Half of the short side. */
  hw: number;
  /** Half of the long side. */
  hl: number;
  /** How far the top of the roof is over the eaves, meters. */
  rise: number;
}

interface Box { cx: number; cz: number; ax: number; az: number; len: number; wid: number }

function area(ring: readonly XY[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return Math.abs(a) / 2;
}

/** The smallest rectangle around a ring that has one side along a side of the ring. */
function box(ring: readonly XY[]): Box {
  let best: Box | null = null, bestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 0.5) continue;
    const dx = (q[0] - p[0]) / L, dz = (q[1] - p[1]) / L;
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const [x, z] of ring) {
      const s = x * dx + z * dz, t = -x * dz + z * dx;
      if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t;
    }
    const a = (s1 - s0) * (t1 - t0);
    if (a >= bestArea) continue;
    bestArea = a;
    const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2, cx = sc * dx - tc * dz, cz = sc * dz + tc * dx;
    best = s1 - s0 >= t1 - t0 ? { cx, cz, ax: dx, az: dz, len: s1 - s0, wid: t1 - t0 } : { cx, cz, ax: -dz, az: dx, len: t1 - t0, wid: s1 - s0 };
  }
  return best ?? { cx: ring[0][0], cz: ring[0][1], ax: 1, az: 0, len: 0, wid: 0 };
}

/** A number from 0 to 1 that is the same for the same place, so that a guess does not change from one visit to the next. */
function place(x: number, z: number): number {
  const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/** Kinds of building (NS 3457, first two digits) that have a pitched roof: houses, holiday homes, garages and outbuildings. */
const PITCHED_KINDS = new Set([11, 12, 16, 17, 18]);

/**
 * The roof for a building, or null for a flat one. `code` is what the tile says (0 = nothing), `height` the height of the top in meters,
 * `type` the building type (0 when not known, as for every outline from OpenStreetMap).
 */
export function roofOf(code: RoofCode, ring: readonly XY[], height: number, type: number): RoofPlan | null {
  if (code === 1 || ring.length < 3) return null;
  const a = area(ring), b = box(ring);
  if (b.wid < 3 || a < 15 || a / (b.len * b.wid) < (code ? 0.7 : 0.8)) return null;

  let kind: RoofPlan['kind'];
  if (code === 4) kind = 'skillion';
  else if (code) kind = code === 3 ? 'hipped' : 'gabled';
  else {
    const kindOfBuilding = Math.floor(type / 10);
    const house = type === 0 ? a <= 350 && height <= 10 : PITCHED_KINDS.has(kindOfBuilding) && a <= (kindOfBuilding === 12 ? 500 : 350);
    if (!house) return null;
    const dice = place(b.cx, b.cz);
    kind = a < 60 && dice < 0.35 ? 'skillion' : a >= 70 && dice > 0.8 ? 'hipped' : 'gabled';
  }

  const hw = b.wid / 2;
  const rise = kind !== 'skillion' ? Math.min(hw * 0.53, height * 0.4, 4.5) : Math.min(Math.max(0.8, b.wid * 0.12), 1.6, height * 0.3);
  if (rise < 0.5) return null;
  return { kind, cx: b.cx, cz: b.cz, ax: b.ax, az: b.az, hw, hl: b.len / 2, rise };
}

/** Across the building: meters from the middle line, positive toward (-az, ax). */
export const across = (r: RoofPlan, x: number, z: number) => (x - r.cx) * -r.az + (z - r.cz) * r.ax;
/** Along the building: meters from the middle, positive toward (ax, az). */
const along = (r: RoofPlan, x: number, z: number) => (x - r.cx) * r.ax + (z - r.cz) * r.az;

/** How high the roof is over the eaves at a point. */
export function roofHeight(r: RoofPlan, x: number, z: number): number {
  const u = across(r, x, z);
  if (r.kind === 'skillion') return r.rise * Math.min(1, Math.max(0, (r.hw - u) / (2 * r.hw)));
  const side = r.rise * Math.max(0, 1 - Math.abs(u) / r.hw);
  if (r.kind === 'gabled') return side;
  return Math.min(side, (r.rise / r.hw) * Math.max(0, r.hl - Math.abs(along(r, x, z)))); // hipped: the ends slope as the sides do
}

/** The part of a ring where f(u, v) >= 0, cut exactly where f is 0 (u across, v along). */
function clip(ring: readonly XY[], r: RoofPlan, f: (u: number, v: number) => number): XY[] {
  const out: XY[] = [];
  const at = (p: XY) => f(across(r, p[0], p[1]), along(r, p[0], p[1]));
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const fp = at(p), fq = at(q);
    if (fp >= 0) out.push(p);
    if ((fp > 0 && fq < 0) || (fp < 0 && fq > 0)) {
      const t = fp / (fp - fq);
      out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
    }
  }
  return out;
}

/** The flat pieces the roof is made of, each with the direction (scene x, z) its slope faces. A piece is cut exactly at the ridge and the hips. */
export function roofParts(ring: readonly XY[], r: RoofPlan): { ring: XY[]; nx: number; nz: number }[] {
  const ux = -r.az, uz = r.ax; // across
  if (r.kind === 'skillion') return [{ ring: [...ring], nx: ux, nz: uz }];
  if (r.kind === 'gabled') return [
    { ring: clip(ring, r, (u) => u), nx: ux, nz: uz },
    { ring: clip(ring, r, (u) => -u), nx: -ux, nz: -uz },
  ];
  const c = r.hl - r.hw; // half the length of the ridge
  // Each piece is where three straight cuts agree, so every cut is linear and exact.
  const piece = (nx: number, nz: number, f1: (u: number, v: number) => number, f2: (u: number, v: number) => number, f3: (u: number, v: number) => number) =>
    ({ ring: clip(clip(clip(ring, r, f1), r, f2), r, f3), nx, nz });
  return [
    piece(ux, uz, (u, v) => u - v + c, (u, v) => u + v + c, (u) => u),
    piece(-ux, -uz, (u, v) => -u - v + c, (u, v) => -u + v + c, (u) => -u),
    piece(r.ax, r.az, (u, v) => v - c - u, (u, v) => v - c + u, (u, v) => v),
    piece(-r.ax, -r.az, (u, v) => -v - c - u, (u, v) => -v - c + u, (u, v) => -v),
  ];
}
