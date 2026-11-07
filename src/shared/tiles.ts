// Map tiles built from Kartverket open data (scripts/kartverket/build-tiles.ts). One binary file per tile, 2 km square,
// in the scene's meters (src/web/world.ts). All coordinates are whole decimeters relative to the tile corner, as
// zigzag varints of differences, so a tile is small before it is gzipped and needs no projecting in the browser.
//
// File: "OBT1", u8 version, svar ix, svar iz, then sections: u8 id, uvar byte length, payload. Unknown ids are skipped.

export const TILE_SIZE = 2000;
export const TILE_VERSION = 1;

export type XY = [number, number];

/** Land cover classes in draw order: later ones are drawn on top of earlier ones. */
export const AREA_CLASSES = ['sea', 'water', 'farmland', 'marsh', 'forest', 'built', 'park'] as const;
/** Road classes, most important first. 'rail' is railway, tram and metro track. */
export const ROAD_CLASSES = ['motorway', 'primary', 'secondary', 'tertiary', 'residential', 'path', 'rail'] as const;

export interface TileBuilding {
  /** Height in decimeters. */
  height: number;
  /** 0 = a guess from the building type, 1 = estimated from the surface model minus the terrain model, 2 = from OpenStreetMap's height or building:levels tag. */
  heightSource: 0 | 1 | 2;
  /** True for an outline from OpenStreetMap (ODbL), absent for N50 (Kartverket). */
  osm?: boolean;
  /** Building type code (NS 3457) from the national building register, 0 if unknown. */
  type: number;
  /** The outline in meters; the ring is open: the last point is not the first. */
  ring: XY[];
}
/** A building known only as a point in the register (no outline). */
export interface TilePoint { x: number; z: number; type: number; height: number; heightSource: 0 | 1 | 2 }
export interface TileRoad { cls: number; points: XY[] }
/** Rings are outer rings and holes together; fill with the even-odd rule. */
export interface TileArea { cls: number; rings: XY[][] }
export interface TileTerrain {
  /** Samples per side; the samples at the edges are shared with the neighbouring tiles. */
  n: number;
  /** Meters between samples. */
  step: number;
  /** Heights in decimeters above sea level, row by row from the north edge (smallest z) to the south, west to east. */
  heights: Int16Array;
}
export interface Tile {
  ix: number;
  iz: number;
  buildings: TileBuilding[];
  points: TilePoint[];
  roads: TileRoad[];
  areas: TileArea[];
  terrain?: TileTerrain;
}

const MAGIC = [0x4f, 0x42, 0x54, 0x31]; // "OBT1"
const SEC_BUILDINGS = 1, SEC_POINTS = 2, SEC_ROADS = 3, SEC_AREAS = 4, SEC_TERRAIN = 5, SEC_OSM_BUILDINGS = 6; // 6: like 1, for the outlines from OpenStreetMap, so that the two licences stay apart

export const tileOf = (x: number, z: number): [number, number] => [Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)];
export const tileName = (ix: number, iz: number) => `${ix}_${iz}.bin`;

class Writer {
  private buf = new Uint8Array(1024);
  length = 0;
  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(this.buf.length * 2, this.length + n));
    next.set(this.buf);
    this.buf = next;
  }
  u8(v: number) { this.ensure(1); this.buf[this.length++] = v; }
  uvar(v: number) {
    this.ensure(10);
    while (v >= 0x80) { this.buf[this.length++] = (v % 0x80) | 0x80; v = Math.floor(v / 0x80); }
    this.buf[this.length++] = v;
  }
  svar(v: number) { this.uvar(v < 0 ? -v * 2 - 1 : v * 2); }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.length); this.length += b.length; }
  done() { return this.buf.subarray(0, this.length); }
}

class Reader {
  pos = 0;
  constructor(private readonly b: Uint8Array) {}
  get end() { return this.pos >= this.b.length; }
  u8() { return this.b[this.pos++]; }
  uvar() {
    let v = 0, mul = 1;
    for (;;) {
      const c = this.b[this.pos++];
      if (c === undefined) throw new Error('tile: unexpected end of data');
      v += (c & 0x7f) * mul;
      if (c < 0x80) return v;
      mul *= 0x80;
    }
  }
  svar() { const u = this.uvar(); return u % 2 ? -(u + 1) / 2 : u / 2; }
  slice(n: number) { const s = this.b.subarray(this.pos, this.pos + n); this.pos += n; return s; }
}

const dm = (m: number) => Math.round(m * 10);

function writePoints(w: Writer, pts: XY[], ox: number, oz: number) {
  w.uvar(pts.length);
  let px = 0, pz = 0;
  for (const [x, z] of pts) {
    const ix = dm(x - ox), iz = dm(z - oz);
    w.svar(ix - px); w.svar(iz - pz);
    px = ix; pz = iz;
  }
}
function readPoints(r: Reader, ox: number, oz: number): XY[] {
  const n = r.uvar();
  const out: XY[] = [];
  let x = 0, z = 0;
  for (let i = 0; i < n; i++) { x += r.svar(); z += r.svar(); out.push([ox + x / 10, oz + z / 10]); }
  return out;
}

/** The value the terrain sample at (i, j) is predicted to have, from its decoded neighbours. */
function predict(h: Int16Array, n: number, i: number, j: number): number {
  if (i === 0 && j === 0) return 0;
  if (j === 0) return h[i - 1];
  if (i === 0) return h[(j - 1) * n];
  return h[j * n + i - 1] + h[(j - 1) * n + i] - h[(j - 1) * n + i - 1];
}

export function encodeTile(tile: Tile): Uint8Array {
  const ox = tile.ix * TILE_SIZE, oz = tile.iz * TILE_SIZE;
  const w = new Writer();
  for (const c of MAGIC) w.u8(c);
  w.u8(TILE_VERSION);
  w.svar(tile.ix); w.svar(tile.iz);
  const section = (id: number, fill: (s: Writer) => void) => {
    const s = new Writer();
    fill(s);
    w.u8(id); w.uvar(s.length); w.bytes(s.done());
  };
  for (const [id, osm] of [[SEC_BUILDINGS, false], [SEC_OSM_BUILDINGS, true]] as const) {
    const list = tile.buildings.filter((b) => Boolean(b.osm) === osm);
    if (list.length) section(id, (s) => {
      s.uvar(list.length);
      for (const b of list) { s.uvar(b.height); s.u8(b.heightSource); s.uvar(b.type); writePoints(s, b.ring, ox, oz); }
    });
  }
  if (tile.points.length) section(SEC_POINTS, (s) => {
    s.uvar(tile.points.length);
    let px = 0, pz = 0;
    for (const p of tile.points) {
      const ix = dm(p.x - ox), iz = dm(p.z - oz);
      s.svar(ix - px); s.svar(iz - pz); px = ix; pz = iz;
      s.uvar(p.type); s.uvar(p.height); s.u8(p.heightSource);
    }
  });
  if (tile.roads.length) section(SEC_ROADS, (s) => {
    s.uvar(tile.roads.length);
    for (const r of tile.roads) { s.u8(r.cls); writePoints(s, r.points, ox, oz); }
  });
  if (tile.areas.length) section(SEC_AREAS, (s) => {
    s.uvar(tile.areas.length);
    for (const a of tile.areas) { s.u8(a.cls); s.uvar(a.rings.length); for (const ring of a.rings) writePoints(s, ring, ox, oz); }
  });
  if (tile.terrain) section(SEC_TERRAIN, (s) => {
    const { n, step, heights } = tile.terrain!;
    s.uvar(n); s.uvar(step);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) s.svar(heights[j * n + i] - predict(heights, n, i, j));
  });
  return w.done();
}

export function decodeTile(data: Uint8Array): Tile {
  const r = new Reader(data);
  for (const c of MAGIC) if (r.u8() !== c) throw new Error('tile: wrong magic');
  const version = r.u8();
  if (version !== TILE_VERSION) throw new Error(`tile: unknown version ${version}`);
  const tile: Tile = { ix: r.svar(), iz: r.svar(), buildings: [], points: [], roads: [], areas: [] };
  const ox = tile.ix * TILE_SIZE, oz = tile.iz * TILE_SIZE;
  while (!r.end) {
    const id = r.u8();
    const s = new Reader(r.slice(r.uvar()));
    switch (id) {
      case SEC_BUILDINGS: case SEC_OSM_BUILDINGS: {
        const n = s.uvar();
        for (let i = 0; i < n; i++) {
          const height = s.uvar(), heightSource = s.u8() as 0 | 1 | 2, type = s.uvar();
          const b: TileBuilding = { height, heightSource, type, ring: readPoints(s, ox, oz) };
          if (id === SEC_OSM_BUILDINGS) b.osm = true;
          tile.buildings.push(b);
        }
        break;
      }
      case SEC_POINTS: {
        const n = s.uvar();
        let x = 0, z = 0;
        for (let i = 0; i < n; i++) {
          x += s.svar(); z += s.svar();
          tile.points.push({ x: ox + x / 10, z: oz + z / 10, type: s.uvar(), height: s.uvar(), heightSource: s.u8() as 0 | 1 | 2 });
        }
        break;
      }
      case SEC_ROADS: {
        const n = s.uvar();
        for (let i = 0; i < n; i++) tile.roads.push({ cls: s.u8(), points: readPoints(s, ox, oz) });
        break;
      }
      case SEC_AREAS: {
        const n = s.uvar();
        for (let i = 0; i < n; i++) {
          const cls = s.u8(), count = s.uvar();
          const rings: XY[][] = [];
          for (let k = 0; k < count; k++) rings.push(readPoints(s, ox, oz));
          tile.areas.push({ cls, rings });
        }
        break;
      }
      case SEC_TERRAIN: {
        const n = s.uvar(), step = s.uvar();
        const heights = new Int16Array(n * n);
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = s.svar() + predict(heights, n, i, j);
        tile.terrain = { n, step, heights };
        break;
      }
    }
  }
  return tile;
}

/** The tile index file (index.json) next to the tiles. */
export interface TileIndex {
  version: 1;
  generated: string;
  tileSize: number;
  /** Credit text that must be shown with the map. */
  credit: string;
  areaClasses: readonly string[];
  roadClasses: readonly string[];
  /** Tile file name -> size in bytes. */
  tiles: Record<string, number>;
}
