// A minimal reader for the uncompressed float32 GeoTIFFs that Kartverket's WCS returns (tiled or in strips, little endian).
// The position of the grid is not read from the file: the caller knows the bounding box it asked for.

export interface Grid { width: number; height: number; data: Float32Array }

export function readFloatTiff(buf: Uint8Array): Grid {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (v.getUint16(0, true) !== 0x4949 || v.getUint16(2, true) !== 42) throw new Error('geotiff: expected little-endian TIFF');
  const ifd = v.getUint32(4, true);
  const count = v.getUint16(ifd, true);
  const tags = new Map<number, number[]>();
  const SIZES: Record<number, number> = { 1: 1, 3: 2, 4: 4 };
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    const tag = v.getUint16(at, true), type = v.getUint16(at + 2, true), n = v.getUint32(at + 4, true);
    const size = SIZES[type];
    if (!size) continue;
    const base = size * n <= 4 ? at + 8 : v.getUint32(at + 8, true);
    const vals: number[] = [];
    for (let k = 0; k < n; k++) vals.push(size === 1 ? v.getUint8(base + k) : size === 2 ? v.getUint16(base + 2 * k, true) : v.getUint32(base + 4 * k, true));
    tags.set(tag, vals);
  }
  const one = (t: number) => tags.get(t)?.[0];
  const width = one(256)!, height = one(257)!;
  if (one(259) !== 1 || one(258) !== 32 || one(339) !== 3) throw new Error('geotiff: only uncompressed float32 is supported');
  const data = new Float32Array(width * height);
  const offsets = tags.get(324) ?? tags.get(273)!;
  const read = (off: number, n: number) => { const o = new Float32Array(n); for (let k = 0; k < n; k++) o[k] = v.getFloat32(off + 4 * k, true); return o; };
  if (tags.has(322)) {
    const tw = one(322)!, th = one(323)!, across = Math.ceil(width / tw);
    offsets.forEach((off, t) => {
      if (!off) return; // an empty tile: no data
      const px = read(off, tw * th);
      const x0 = (t % across) * tw, y0 = Math.floor(t / across) * th;
      for (let y = 0; y < th && y0 + y < height; y++) for (let x = 0; x < tw && x0 + x < width; x++) data[(y0 + y) * width + x0 + x] = px[y * tw + x];
    });
  } else {
    const rows = one(278) ?? height;
    offsets.forEach((off, s) => { const y0 = s * rows, n = Math.min(rows, height - y0) * width; data.set(read(off, n), y0 * width); });
  }
  return { width, height, data };
}

/** Grids of equal cell size laid side by side, to be asked for the height at a point (coordinates in the grid's CRS). */
export class HeightField {
  private readonly blocks = new Map<string, { grid: Grid; e0: number; n1: number }>();
  /** `oe`, `on`: easting and northing of the corner of the first block, which the other blocks are a whole number of blocks from. */
  constructor(private readonly block: number, private readonly cell: number, private readonly valid: (h: number) => boolean, private readonly oe = 0, private readonly on = 0) {}
  add(e0: number, n0: number, grid: Grid) { this.blocks.set(`${e0},${n0}`, { grid, e0, n1: n0 + this.block }); }
  /** Height at (e, n), nearest cell; NaN where there is no data. */
  at(e: number, n: number): number {
    const be = Math.floor((e - this.oe) / this.block) * this.block + this.oe, bn = Math.floor((n - this.on) / this.block) * this.block + this.on;
    const b = this.blocks.get(`${be},${bn}`);
    if (!b) return NaN;
    const x = Math.min(b.grid.width - 1, Math.floor((e - b.e0) / this.cell)), y = Math.min(b.grid.height - 1, Math.floor((b.n1 - n) / this.cell));
    const h = b.grid.data[y * b.grid.width + x];
    return this.valid(h) ? h : NaN;
  }
  /** Bilinear between cell centres; the nearest cell where a neighbour is missing. */
  bilinear(e: number, n: number): number {
    const c = this.cell;
    const fx = (e - this.oe - c / 2) / c, fy = (n - this.on - c / 2) / c;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const g = (xi: number, yi: number) => this.at(this.oe + xi * c + c / 2, this.on + yi * c + c / 2);
    const a = g(x0, y0), b = g(x0 + 1, y0), d = g(x0, y0 + 1), f = g(x0 + 1, y0 + 1);
    if ([a, b, d, f].some(Number.isNaN)) return this.at(e, n);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + f * tx) * ty;
  }
}
