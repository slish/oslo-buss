// Plane geometry in meters, for the map data: simplifying lines, asking how far a point is from a set of lines, and what lies inside a ring.

export type XY = [number, number];

/** Douglas-Peucker: the points kept so the line never strays more than `tolerance` from the original. */
export function simplifyXY(points: XY[], tolerance: number): XY[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const dx = points[b][0] - ax, dy = points[b][1] - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = points[i][0] - ax, py = points[i][1] - ay;
      const d = len === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Line segments in a grid, so "how far is this point from the nearest line" looks only at what is close. */
export class SegmentIndex {
  private readonly cells = new Map<string, number[]>();
  private readonly segs: number[] = []; // ax, ay, bx, by per segment

  constructor(lines: XY[][], private readonly cell = 500) {
    for (const line of lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const n = this.segs.length / 4;
        this.segs.push(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
        // Registered in every cell its bounding box touches (segments are short next to the cells).
        const x0 = Math.floor(Math.min(line[i][0], line[i + 1][0]) / cell), x1 = Math.floor(Math.max(line[i][0], line[i + 1][0]) / cell);
        const y0 = Math.floor(Math.min(line[i][1], line[i + 1][1]) / cell), y1 = Math.floor(Math.max(line[i][1], line[i + 1][1]) / cell);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const list = this.cells.get(key);
          if (list) list.push(n); else this.cells.set(key, [n]);
        }
      }
    }
  }

  /** The distance to the nearest line, or Infinity if none is within `max`. */
  distance(x: number, y: number, max: number): number {
    const reach = Math.ceil(max / this.cell);
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best = Infinity;
    for (let i = cx - reach; i <= cx + reach; i++) for (let j = cy - reach; j <= cy + reach; j++) {
      const list = this.cells.get(`${i},${j}`);
      if (!list) continue;
      for (const n of list) {
        const d = pointToSegment(x, y, this.segs[n * 4], this.segs[n * 4 + 1], this.segs[n * 4 + 2], this.segs[n * 4 + 3]);
        if (d < best) best = d;
      }
    }
    return best <= max ? best : Infinity;
  }
}

export function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Even-odd test of a point against a ring (open or closed). */
export function pointInRing(x: number, z: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** A ring with its bounding box, so that most points are ruled out by four comparisons. */
export interface Footprint { minX: number; maxX: number; minZ: number; maxZ: number; ring: readonly (readonly [number, number])[] }

export function footprintOf(ring: Footprint['ring']): Footprint {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  return { minX, maxX, minZ, maxZ, ring };
}

export function insideAny(x: number, z: number, list: readonly Footprint[]): boolean {
  for (const f of list) if (x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ && pointInRing(x, z, f.ring)) return true;
  return false;
}
