// Turns the downloaded Kartverket data (scripts/kartverket/download.ts) into map tiles (src/shared/tiles.ts).
// Reads data-cache/kartverket/, writes data-cache/tiles/ (both gitignored). Usage: npx tsx scripts/kartverket/build-tiles.ts [--src <dir>] [--out <dir>]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import proj4 from 'proj4';
import { simplifyXY } from '../../src/shared/geom';
import { AREA_CLASSES, ROAD_CLASSES, TILE_SIZE, encodeTile, tileName, type Tile, type TileIndex, type XY } from '../../src/shared/tiles';
import { toX, toZ, ORIGIN } from '../../src/web/world';
import { clipLine, clipRing, pointInRing, ringArea, type Rect } from './clip';
import { HeightField, readFloatTiff } from './geotiff';
import { field, lineStrings, members, surfaceRings } from './gml';
import { DOM_RES, DTM_BBOX, DTM_BLOCK, DTM_RES } from './download';

export const CREDIT = 'Kartdata © Kartverket (CC BY 4.0)';

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
const utm32Of = (x: number, z: number): XY => proj4('WGS84', 'EPSG:25832', [ORIGIN.lon + x / M_PER_DEG_LON, ORIGIN.lat - z / M_PER_DEG_LAT]) as XY;

// --- Tile store ---
const tiles = new Map<string, Tile>();
const tileAt = (ix: number, iz: number) => {
  const k = `${ix},${iz}`;
  let t = tiles.get(k);
  if (!t) tiles.set(k, (t = { ix, iz, buildings: [], points: [], roads: [], areas: [] }));
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
function loadField(sub: string, res: number, block: number): HeightField {
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

interface Stats {
  areas: number; rail: number; paths: number; roads: number; buildings: number; buildingsWithModelHeight: number;
  pointsSeen: number; points: number; pointsWithModelHeight: number;
}

async function main() {
  const st: Stats = { areas: 0, rail: 0, paths: 0, roads: 0, buildings: 0, buildingsWithModelHeight: 0, pointsSeen: 0, points: 0, pointsWithModelHeight: 0 };
  console.log('reading height models');
  dtm = loadField('dtm10', DTM_RES, DTM_BLOCK);
  dom = loadField('dom4', DOM_RES, DTM_BLOCK);
  const outlines: XY[][] = [];
  const x = join(SRC, 'x');
  for (const [code, name, nvdb] of [['0301', 'Oslo', '0301NVDBVegnettPluss'], ['3201', 'Berum', '3201NVDBVegnettPluss']] as const) {
    console.log(`N50 ${name}`);
    await readN50(join(x, `Basisdata_${code}_${name}_25832_N50Kartdata_GML`), `Basisdata_${code}_${name}_25832`, st, outlines);
    console.log(`NVDB ${name}`);
    await readNvdb(join(x, `Samferdsel_${code}_${name}_5973_NVDB-VegnettPluss_GML`, `${nvdb}.gml`), st);
  }
  for (const [code, name] of [['0301', 'Oslo'], ['3201', 'Berum']]) {
    console.log(`Bygningspunkt ${name}`);
    await readPoints(join(x, `Basisdata_${code}_${name}_25832_MatrikkelenBygning_GML`, `Basisdata_${code}_${name}_25832_MatrikkelenBygning_GML.gml`), st, outlines);
  }
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
