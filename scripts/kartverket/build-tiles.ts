// Turns the downloaded Kartverket data (scripts/kartverket/download.ts) into map tiles (src/shared/tiles.ts).
// Reads data-cache/kartverket/, writes data-cache/tiles/ (both gitignored). Usage: npx tsx scripts/kartverket/build-tiles.ts [--src <dir>] [--out <dir>]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import proj4 from 'proj4';
import { simplifyXY } from '../../src/shared/geom';
import { buildingHeight } from '../../src/shared/map';
import { AREA_CLASSES, ROAD_CLASSES, TILE_SIZE, encodeTile, tileName, type Tile, type TileIndex, type XY } from '../../src/shared/tiles';
import { toX, toZ, ORIGIN } from '../../src/web/world';
import { clipLine, clipRing, ringArea, type Rect } from './clip';
import { pointInRing } from '../../src/shared/geom';
import { HeightField, readFloatTiff } from './geotiff';
import { field, lineStrings, members, surfaceRings } from './gml';
import { cell, cellsOfTiles } from './osm';
import { DOM_RES, DTM_BBOX, DTM_BLOCK, DTM_RES, MUNICIPALITIES } from './download';
import { neededTiles } from './coverage';

export const CREDIT = 'Kartdata © Kartverket (CC BY 4.0), bygg òg © OpenStreetMap-bidragsytarar (ODbL)';

const args = process.argv.slice(2);
const argOf = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const SRC = argOf('--src') ?? join(process.cwd(), 'data-cache', 'kartverket');
const OUT = argOf('--out') ?? join(process.cwd(), 'data-cache', 'tiles');
const TERRAIN_STEP = 20;

// --- Projection: Kartverket's UTM to the scene's meters via longitude/latitude, using the formulas in src/web/world.ts ---
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs');
proj4.defs('EPSG:25833', '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs');
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
const to25832 = proj4('EPSG:25832', 'WGS84');
const to25833 = proj4('EPSG:25833', 'WGS84');
const sceneOf = (conv: { forward(c: number[]): number[] }, e: number, n: number): XY => { const [lon, lat] = conv.forward([e, n]); return [toX(lon), toZ(lat)]; };
/** The inverse of the above for UTM 32: scene meters to easting/northing. */
export const utm32Of = (x: number, z: number): XY => proj4('WGS84', 'EPSG:25832', [ORIGIN.lon + x / M_PER_DEG_LON, ORIGIN.lat - z / M_PER_DEG_LAT]) as XY;

// --- Tile store ---
const tiles = new Map<string, Tile>();
/** Tiles to keep: those of the previous build (Oslo and Bærum) and those the timetable needs (scripts/kartverket/coverage.ts). Data elsewhere in the neighbouring municipalities is dropped. */
let keep: Set<string> | undefined;
const scrap: Tile = { ix: 0, iz: 0, buildings: [], points: [], roads: [], areas: [] };
const tileAt = (ix: number, iz: number) => {
  const k = `${ix},${iz}`;
  let t = tiles.get(k);
  if (!t) {
    if (keep && !keep.has(`${ix}_${iz}`)) { scrap.buildings = []; scrap.points = []; scrap.roads = []; scrap.areas = []; return scrap; }
    tiles.set(k, (t = { ix, iz, buildings: [], points: [], roads: [], areas: [] }));
  }
  return t;
};
const rectOf = (ix: number, iz: number): Rect => ({ x0: ix * TILE_SIZE, z0: iz * TILE_SIZE, x1: (ix + 1) * TILE_SIZE, z1: (iz + 1) * TILE_SIZE });
function tilesOver(pts: XY[]): [number, number][] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const out: [number, number][] = [];
  for (let ix = Math.floor(x0 / TILE_SIZE); ix <= Math.floor(x1 / TILE_SIZE); ix++) for (let iz = Math.floor(z0 / TILE_SIZE); iz <= Math.floor(z1 / TILE_SIZE); iz++) out.push([ix, iz]);
  return out;
}

function addRoad(cls: number, pts: XY[]) {
  const line = simplifyXY(pts, 0.8);
  if (line.length < 2) return;
  for (const [ix, iz] of tilesOver(line)) for (const piece of clipLine(line, rectOf(ix, iz))) tileAt(ix, iz).roads.push({ cls, points: piece });
}
function addArea(cls: number, rings: XY[][]) {
  const simple = rings.map((r) => simplifyXY([...r, r[0]], 2).slice(0, -1)).filter((r) => r.length >= 3);
  if (!simple.length) return;
  for (const [ix, iz] of tilesOver(simple.flat())) {
    const rect = rectOf(ix, iz);
    const clipped = simple.map((r) => clipRing(r, rect)).filter((r) => r.length >= 3);
    // Holes only matter together with an outer ring in the same tile.
    if (clipped.length && ringArea(clipped[0]) !== 0) tileAt(ix, iz).areas.push({ cls, rings: clipped });
  }
}

// --- Heights: DTM and DOM blocks from the WCS downloads ---
export function loadField(sub: string, res: number, block: number): HeightField {
  const f = new HeightField(block, res, (h) => Number.isFinite(h) && h > -50 && h < 2500, DTM_BBOX.minE, DTM_BBOX.minN);
  const dir = join(SRC, sub);
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    const m = /_(\d+)_(\d+)\.tif$/.exec(name);
    if (m) f.add(Number(m[1]), Number(m[2]), readFloatTiff(readFileSync(join(dir, name))));
  }
  return f;
}

/** Guess of a building's height in meters from its NS 3457 type code (first digits), used where the surface model gives nothing. */
export function guessHeight(type: number): number {
  const d = Math.floor(type / 10);
  if (type === 0) return 8;
  if (d === 11 || d === 12) return 7; // detached and small houses
  if (d === 13 || d === 14) return 12; // blocks of flats and apartment buildings
  if (d === 16 || d === 17 || type === 18 || d === 18) return 3.5; // garages, outbuildings
  if (d === 15 || d === 19) return 10;
  if (d >= 20 && d <= 23) return 10; // industry
  if (d >= 30 && d <= 33) return 12; // offices, shops
  if (d >= 40 && d <= 49) return 10; // transport, hotels, restaurants
  if (d >= 50 && d <= 59) return 10; // schools, health, culture
  if (d >= 60 && d <= 69) return 8;
  if (d >= 70 && d <= 79) return 12;
  if (d >= 80 && d <= 89) return 10;
  return 8;
}

let dtm: HeightField, dom: HeightField;
/** DOM minus DTM at a point (UTM 32), NaN if either is missing. */
const nDsm = (e: number, n: number) => dom.at(e, n) - dtm.bilinear(e, n);

/** Height of a building outline (UTM 32 ring) in meters from the surface model; undefined if the model says nothing sensible. */
export function heightFromModel(ring: XY[]): number | undefined {
  let e0 = Infinity, n0 = Infinity, e1 = -Infinity, n1 = -Infinity;
  for (const [e, n] of ring) { if (e < e0) e0 = e; if (e > e1) e1 = e; if (n < n0) n0 = n; if (n > n1) n1 = n; }
  const vals: number[] = [];
  const step = 2;
  for (let e = e0 + step / 2; e < e1; e += step) for (let n = n0 + step / 2; n < n1; n += step) {
    if (!pointInRing(e, n, ring)) continue;
    const h = nDsm(e, n);
    if (Number.isFinite(h)) vals.push(h);
  }
  if (vals.length < 3) return undefined;
  vals.sort((a, b) => a - b);
  const h = vals[Math.floor(vals.length * 0.8)];
  return h >= 2.5 && h <= 150 ? h : undefined;
}

// --- N50 Kartdata ---
const N50_AREAS: Record<string, number> = {
  Havflate: 0, Innsj: 1, Elv: 1, DyrketMark: 2, Myr: 3, Skog: 4, Tettbebyggelse: 5, BymessigBebyggelse: 5, Industriomr: 5,
  Park: 6, SportIdrettPlass: 6, Gravplass: 6, Golfbane: 6, Alpinbakke: 6,
};

async function readN50(dir: string, stem: string, st: Stats, buildingRings: XY[][]) {
  const base = (theme: string) => join(dir, `${stem}_${theme}_GML.gml`);
  for await (const f of members(base('N50Arealdekke'), 'gml:featureMember')) {
    const name = /^\s*<app:(\w+)/.exec(f)?.[1] ?? '';
    const cls = N50_AREAS[name];
    if (cls === undefined) continue;
    const polys = surfaceRings(f);
    if (!polys.length) continue;
    // One feature can hold several polygon patches; each exterior ring starts a new polygon with the holes that follow it.
    let cur: XY[][] = [];
    const flush = () => { if (cur.length) { addArea(cls, cur.map((r) => r.map(([e, n]) => sceneOf(to25832, e, n)))); st.areas++; } cur = []; };
    for (const { ring, outer } of polys) { if (outer) flush(); cur.push(ring); }
    flush();
  }
  for await (const f of members(base('N50Samferdsel'), 'gml:featureMember')) {
    const name = /^\s*<app:(\w+)/.exec(f)?.[1];
    if (name === 'Bane') for (const l of lineStrings(f, 2)) { addRoad(6, l.map(([e, n]) => sceneOf(to25832, e, n))); st.rail++; }
    else if (name === 'Veglenke') {
      // NVDB has the roads; N50 adds the footpaths and tracks in the forests that NVDB does not carry.
      const type = field(f, 'typeVeg');
      if (type === 'sti' || type === 'traktorveg') for (const l of lineStrings(f, 2)) { addRoad(5, l.map(([e, n]) => sceneOf(to25832, e, n))); st.paths++; }
    }
  }
  for await (const f of members(base('N50BygningerOgAnlegg'), 'gml:featureMember')) {
    if (!/^\s*<app:Bygning /.test(f)) continue;
    const rings = surfaceRings(f).filter((r) => r.outer);
    if (!rings.length) continue;
    const utm = rings[0].ring.slice(0, -1);
    if (utm.length < 3) continue;
    const type = Number(field(f, 'bygningstype') ?? 0);
    const model = heightFromModel(utm);
    const scene = simplifyXY(utm.map(([e, n]) => sceneOf(to25832, e, n)), 0.3);
    if (scene.length < 3) continue;
    const cx = scene.reduce((a, p) => a + p[0], 0) / scene.length, cz = scene.reduce((a, p) => a + p[1], 0) / scene.length;
    const [ix, iz] = [Math.floor(cx / TILE_SIZE), Math.floor(cz / TILE_SIZE)];
    tileAt(ix, iz).buildings.push({ height: Math.round((model ?? guessHeight(type)) * 10), heightSource: model === undefined ? 0 : 1, type, ring: scene });
    buildingRings.push(utm);
    st.buildings++;
    if (model !== undefined) st.buildingsWithModelHeight++;
  }
}

// --- Bygningspunkt (register points), only those that N50 has no outline for ---
async function readPoints(file: string, st: Stats, outlines: XY[][]) {
  // A coarse grid over the N50 outlines (UTM 32) to ask "is this point inside a known outline".
  const CELL = 200;
  const grid = new Map<string, XY[][]>();
  for (const r of outlines) {
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    for (let i = Math.floor(Math.min(...xs) / CELL); i <= Math.floor(Math.max(...xs) / CELL); i++) for (let j = Math.floor(Math.min(...ys) / CELL); j <= Math.floor(Math.max(...ys) / CELL); j++) {
      const k = `${i},${j}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(r);
    }
  }
  const LIVE = new Set(['TB', 'FA', 'MB']); // taken into use, completion certificate, temporary permit
  for await (const f of members(file, 'gml:featureMember')) {
    st.pointsSeen++;
    if (!LIVE.has(field(f, 'bygningsstatus') ?? '')) continue;
    const pos = /<gml:pos>([^<]*)<\/gml:pos>/.exec(f)?.[1]?.trim().split(/\s+/).map(Number);
    if (!pos) continue;
    const [e, n] = pos;
    if ((grid.get(`${Math.floor(e / CELL)},${Math.floor(n / CELL)}`) ?? []).some((r) => pointInRing(e, n, r))) continue;
    const type = Number(field(f, 'bygningstype') ?? 0);
    // Highest surface-minus-terrain value within 3 m: the point is not always exactly on the roof.
    let best = NaN;
    for (const [de, dn] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) { const h = nDsm(e + de, n + dn); if (Number.isFinite(h) && !(h <= best)) best = h; }
    const model = best >= 2.5 && best <= 150 ? best : undefined;
    const [x, z] = sceneOf(to25832, e, n);
    const [ix, iz] = [Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)];
    tileAt(ix, iz).points.push({ x, z, type, height: Math.round((model ?? guessHeight(type)) * 10), heightSource: model === undefined ? 0 : 1 });
    st.points++;
    if (model !== undefined) st.pointsWithModelHeight++;
  }
}

// --- NVDB Vegnett Pluss ---
function nvdbClass(type: string, category: string): number {
  switch (type) {
    case 'gangveg': case 'gsv': case 'sv': case 'trapp': return 5;
    case 'bilveg': case 'kanalveg': case 'rampe': case 'rkj': case 'gagate': case 'gatetun': case 'enkelBilveg':
      return category === 'E' ? 0 : category === 'R' ? 1 : category === 'F' ? 2 : category === 'K' ? 3 : 4;
    default: return -1; // fortau, gangfelt, svingefelt: left out
  }
}
async function readNvdb(file: string, st: Stats) {
  for await (const f of members(file, 'wfs:member')) {
    if (!/^\s*<Veglenke /.test(f)) continue;
    if (field(f, 'konnekteringslenke') === 'true') continue;
    const level = field(f, 'detaljnivå');
    if (level === 'KF') continue; // lane level duplicates the carriageway
    const cls = nvdbClass(field(f, 'typeVeg') ?? '', field(f, 'vegkategori') ?? '');
    if (cls < 0) continue;
    for (const l of lineStrings(f, 3)) { addRoad(cls, l.map(([e, n]) => sceneOf(to25833, e, n))); st.roads++; }
  }
}

// --- Terrain ---
function addTerrain() {
  const n = TILE_SIZE / TERRAIN_STEP + 1;
  for (const t of [...tiles.values()]) {
    const heights = new Int16Array(n * n);
    let any = false;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const [e, nn] = utm32Of(t.ix * TILE_SIZE + i * TERRAIN_STEP, t.iz * TILE_SIZE + j * TERRAIN_STEP);
      const h = dtm.bilinear(e, nn);
      if (Number.isFinite(h)) { heights[j * n + i] = Math.round(h * 10); any = true; }
    }
    if (any) t.terrain = { n, step: TERRAIN_STEP, heights };
  }
}

// --- OpenStreetMap outlines: the main source of buildings where they exist; N50 outlines and register points stay where OSM has none ---
const ptSegDist = (px: number, pz: number, a: XY, b: XY) => {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / l2)) : 0;
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
};
const centroidOf = (r: XY[]): XY => [r.reduce((a, p) => a + p[0], 0) / r.length, r.reduce((a, p) => a + p[1], 0) / r.length];

/** A grid over rings (scene meters) to ask whether a point is inside one, or within `near` meters of its edge. */
class RingGrid {
  private readonly cells = new Map<string, XY[][]>();
  constructor(rings: XY[][], private readonly cellSize = 100) {
    for (const r of rings) {
      const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
      for (let i = Math.floor((Math.min(...xs) - 5) / cellSize); i <= Math.floor((Math.max(...xs) + 5) / cellSize); i++)
        for (let j = Math.floor((Math.min(...zs) - 5) / cellSize); j <= Math.floor((Math.max(...zs) + 5) / cellSize); j++) {
          const k = `${i},${j}`;
          (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(r);
        }
    }
  }
  covers(x: number, z: number, near = 0): boolean {
    for (const r of this.cells.get(`${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`) ?? []) {
      if (pointInRing(x, z, r)) return true;
      if (near > 0) for (let i = 0; i < r.length; i++) if (ptSegDist(x, z, r[i], r[(i + 1) % r.length]) <= near) return true;
    }
    return false;
  }
}

/** Parses an OSM height tag ("12", "12.5 m"); undefined if there is none that makes sense. */
export function osmTagHeight(tags: Record<string, string>): number | undefined {
  const h = parseFloat((tags.height ?? '').replace(',', '.'));
  if (Number.isFinite(h) && h > 0) return Math.min(h, 250);
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return buildingHeight({ 'building:levels': String(levels) });
  return undefined;
}

async function mergeOsm(st: Stats) {
  const cells = cellsOfTiles([...tiles.values()].map((t) => tileName(t.ix, t.iz)));
  const seen = new Set<number>();
  const found: { ring: XY[]; height: number; heightSource: 0 | 1 | 2 }[] = [];
  for (const c of cells) {
    for (const w of await cell(c.i, c.j, false)) {
      if (seen.has(w.id)) continue;
      seen.add(w.id);
      let pts: XY[] = w.geometry.map((p) => [toX(p.lon), toZ(p.lat)]);
      if (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
      else if (pts.length < 3) continue;
      else if (w.geometry[0].lat !== w.geometry[w.geometry.length - 1].lat || w.geometry[0].lon !== w.geometry[w.geometry.length - 1].lon) continue; // an open way is no building
      if (Math.abs(ringArea(pts)) < 15) continue;
      const ring = simplifyXY(pts, 0.3);
      if (ring.length < 3) continue;
      const [cx, cz] = centroidOf(ring);
      const [ix, iz] = [Math.floor(cx / TILE_SIZE), Math.floor(cz / TILE_SIZE)];
      if (!tiles.has(`${ix},${iz}`)) continue; // outside the area of the tiles
      const tag = osmTagHeight(w.tags);
      let height = tag, heightSource: 0 | 1 | 2 = 2;
      if (height === undefined) {
        height = heightFromModel(ring.map(([x, z]) => utm32Of(x, z)));
        heightSource = 1;
        if (height === undefined) { height = buildingHeight(w.tags); heightSource = 0; }
      }
      found.push({ ring, height, heightSource });
      st.osmBuildings++;
      if (heightSource === 2) st.osmHeightFromTag++; else if (heightSource === 1) st.osmHeightFromModel++;
    }
  }
  // OSM wins: N50 outlines that are the same buildings, and register points inside or at the wall of an OSM outline, are dropped.
  const grid = new RingGrid(found.map((f) => f.ring));
  const centres = new Map<string, XY[]>();
  for (const f of found) { const c = centroidOf(f.ring), k = `${Math.floor(c[0] / 100)},${Math.floor(c[1] / 100)}`; (centres.get(k) ?? centres.set(k, []).get(k)!).push(c); }
  const hasCentre = (ring: XY[]) => {
    const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
    for (let i = Math.floor(Math.min(...xs) / 100); i <= Math.floor(Math.max(...xs) / 100); i++) for (let j = Math.floor(Math.min(...zs) / 100); j <= Math.floor(Math.max(...zs) / 100); j++)
      if ((centres.get(`${i},${j}`) ?? []).some((c) => pointInRing(c[0], c[1], ring))) return true;
    return false;
  };
  for (const t of tiles.values()) {
    const before = t.buildings.length, pointsBefore = t.points.length;
    t.buildings = t.buildings.filter((b) => { const [cx, cz] = centroidOf(b.ring); return !grid.covers(cx, cz) && !hasCentre(b.ring); });
    t.points = t.points.filter((p) => !grid.covers(p.x, p.z, 4));
    st.n50Dropped += before - t.buildings.length;
    st.pointsDropped += pointsBefore - t.points.length;
  }
  for (const f of found) {
    const [cx, cz] = centroidOf(f.ring);
    tileAt(Math.floor(cx / TILE_SIZE), Math.floor(cz / TILE_SIZE)).buildings.push({ height: Math.round(f.height * 10), heightSource: f.heightSource, type: 0, osm: true, ring: f.ring });
  }
}
interface Stats {
  osmBuildings: number; osmHeightFromTag: number; osmHeightFromModel: number; n50Dropped: number; pointsDropped: number;
  areas: number; rail: number; paths: number; roads: number; buildings: number; buildingsWithModelHeight: number;
  pointsSeen: number; points: number; pointsWithModelHeight: number;
}

async function main() {
  const st: Stats = { osmBuildings: 0, osmHeightFromTag: 0, osmHeightFromModel: 0, n50Dropped: 0, pointsDropped: 0, areas: 0, rail: 0, paths: 0, roads: 0, buildings: 0, buildingsWithModelHeight: 0, pointsSeen: 0, points: 0, pointsWithModelHeight: 0 };
  console.log('reading height models');
  dtm = loadField('dtm10', DTM_RES, DTM_BLOCK);
  dom = loadField('dom4', DOM_RES, DTM_BLOCK);
  const outlines: XY[][] = [];
  const x = join(SRC, 'x');
  // The folder of each municipality has the name of the zip file, which the download names after the municipality ("Berum", "Nordre_Follo").
  const folder = (prefix: string, code: string, suffix: string) => {
    const f = readdirSync(x).find((d) => d.startsWith(`${prefix}_${code}_`) && d.endsWith(suffix));
    if (!f) throw new Error(`${prefix}_${code}_*${suffix} is missing in ${x}: unzip the downloads into it`);
    return f;
  };
  const places = MUNICIPALITIES.filter((m) => existsSync(x) && readdirSync(x).some((d) => d.startsWith(`Basisdata_${m.code}_`)));
  const previous = existsSync(join(OUT, 'index.json')) ? Object.keys((JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) as TileIndex).tiles).map((n) => n.replace('.bin', '')) : [];
  const needed = neededTiles();
  keep = new Set([...previous, ...needed]);
  console.log(`${previous.length} tiles from before, ${needed.size} needed by the timetable, ${keep.size} kept`);
  for (const { code, name } of places) {
    const n50 = folder('Basisdata', code, '_N50Kartdata_GML'), nvdb = folder('Samferdsel', code, '_NVDB-VegnettPluss_GML');
    console.log(`N50 ${name}`);
    await readN50(join(x, n50), n50.replace('_N50Kartdata_GML', ''), st, outlines);
    console.log(`NVDB ${name}`);
    await readNvdb(join(x, nvdb, `${code}NVDBVegnettPluss.gml`), st);
  }
  for (const { code, name } of places) {
    const dir = folder('Basisdata', code, '_MatrikkelenBygning_GML');
    console.log(`Bygningspunkt ${name}`);
    await readPoints(join(x, dir, `${dir}.gml`), st, outlines);
  }
  for (const t of keep) { const [ix, iz] = t.split('_').map(Number); tileAt(ix, iz); } // every needed tile exists, with at least its terrain
  if (!args.includes('--no-osm')) { console.log('OpenStreetMap outlines'); await mergeOsm(st); }
  console.log('terrain');
  addTerrain();

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const index: TileIndex = { version: 1, generated: new Date().toISOString(), tileSize: TILE_SIZE, credit: CREDIT, areaClasses: AREA_CLASSES, roadClasses: ROAD_CLASSES, tiles: {} };
  const sizes: number[] = [];
  let raw = 0, gz = 0, br = 0;
  for (const t of tiles.values()) {
    const bytes = encodeTile(t);
    writeFileSync(join(OUT, tileName(t.ix, t.iz)), bytes);
    index.tiles[tileName(t.ix, t.iz)] = bytes.length;
    sizes.push(bytes.length);
    raw += bytes.length;
    gz += gzipSync(bytes, { level: 9 }).length;
    br += brotliCompressSync(bytes).length;
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
  sizes.sort((a, b) => a - b);
  const report = { ...st, tiles: sizes.length, rawBytes: raw, gzipBytes: gz, brotliBytes: br, medianTile: sizes[Math.floor(sizes.length / 2)], maxTile: sizes[sizes.length - 1] };
  writeFileSync(join(OUT, 'stats.json'), JSON.stringify(report, null, 2));
  console.log(report);
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('build-tiles.ts')) main().catch((e) => { console.error(e); process.exit(1); });
