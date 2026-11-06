// Builds public/data/map.json: the roads and buildings of OpenStreetMap along the lines, as the browser draws them.
// Map data © OpenStreetMap contributors, ODbL.
//
//   npm run map                 (asks Overpass for each tile once and keeps the answers in data-cache/osm/)
//   npm run map -- --cached     (builds from what is kept, without asking)
//
// Needs public/data/timetable.json (npm run timetable) to know where the lines run. Only tiles near the lines are asked
// for, one at a time with a pause, and the answers are kept, so the public Overpass servers see a few dozen requests once.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { CLIENT_NAME } from '../src/shared/client';
import { SegmentIndex, simplifyXY, type XY } from '../src/shared/geom';
import { buildingHeight, encodePoints, ROAD_CLASSES, roadClass, type MapFile } from '../src/shared/map';
import { Timetable, type TimetableFile } from '../src/shared/timetable';
import { toX, toZ } from '../src/web/world';

const OUT = 'public/data/map.json';
const CACHE = 'data-cache/osm';
const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const AGENT = `${CLIENT_NAME}/1.0 (https://github.com/slish/oslo-buss)`;
/** Tile size in degrees: about 2.2 km by 2.2 km at Oslo's latitude. */
const TILE_LAT = 0.02, TILE_LON = 0.04;
/** Buildings are kept this close to a line (meters), and the smaller roads this close. */
const BUILDING_CORRIDOR = 300;
const ROAD_CORRIDOR = 900;
const MIN_BUILDING_AREA = 15;
const PAUSE_MS = 3000;

interface Raw { id: number; tags: Record<string, string>; geometry: { lat: number; lon: number }[] }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpass(query: string): Promise<Raw[]> {
  let wait = 5000;
  for (let attempt = 0; attempt < 9; attempt++) {
    const server = SERVERS[attempt % SERVERS.length];
    try {
      const response = await fetch(server, {
        method: 'POST', headers: { 'user-agent': AGENT, 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { elements?: Raw[]; remark?: string };
        if (body.remark && /error|timed out|out of memory/i.test(body.remark)) throw new Error(body.remark);
        if (Array.isArray(body.elements)) return body.elements;
        throw new Error('no elements');
      }
      console.log(`  ${new URL(server).host} ${response.status}, tries again in ${wait / 1000} s`);
    } catch (e) {
      console.log(`  ${new URL(server).host}: ${e instanceof Error ? e.message : e}, tries again in ${wait / 1000} s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 60_000);
  }
  throw new Error('Overpass did not answer');
}

const HIGHWAYS = 'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street';

async function tile(i: number, j: number, s: number, w: number, cachedOnly: boolean): Promise<Raw[]> {
  const path = `${CACHE}/${i}_${j}.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Raw[];
  if (cachedOnly) return [];
  const n = s + TILE_LAT, e = w + TILE_LON;
  const box = `${s},${w},${n},${e}`;
  const elements = await overpass(`[out:json][timeout:90];(way["building"](${box});way["highway"~"^(${HIGHWAYS})$"](${box}););out geom;`);
  const slim: Raw[] = elements.filter((x) => x.geometry?.length).map((x) => {
    const t = x.tags ?? {};
    const tags: Record<string, string> = {};
    for (const k of ['building', 'height', 'building:levels', 'highway']) if (t[k] !== undefined) tags[k] = t[k];
    return { id: x.id, tags, geometry: x.geometry.map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 })) };
  });
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, JSON.stringify(slim));
  await sleep(PAUSE_MS);
  return slim;
}

const area = (ring: XY[]) => Math.abs(ring.reduce((a, p, k) => { const q = ring[(k + 1) % ring.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

async function main() {
  const cachedOnly = process.argv.includes('--cached');
  const tt = new Timetable(JSON.parse(readFileSync('public/data/timetable.json', 'utf8')) as TimetableFile);
  const lines: XY[][] = [];
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const shape of tt.shapes.values()) {
    const pts: XY[] = [];
    for (let k = 0; k < shape.lat.length; k++) {
      pts.push([toX(shape.lon[k]), toZ(shape.lat[k])]);
      south = Math.min(south, shape.lat[k]); north = Math.max(north, shape.lat[k]);
      west = Math.min(west, shape.lon[k]); east = Math.max(east, shape.lon[k]);
    }
    lines.push(pts);
  }
  const index = new SegmentIndex(lines);

  // Tiles of the grid that come near a line.
  const tiles: { i: number; j: number; s: number; w: number }[] = [];
  for (let i = Math.floor(south / TILE_LAT); i <= Math.floor(north / TILE_LAT); i++) {
    for (let j = Math.floor(west / TILE_LON); j <= Math.floor(east / TILE_LON); j++) {
      const s = i * TILE_LAT, w = j * TILE_LON;
      const cx = toX(w + TILE_LON / 2), cz = toZ(s + TILE_LAT / 2);
      // The tile's half diagonal is about 1.6 km.
      if (index.distance(cx, cz, 1600 + ROAD_CORRIDOR) < Infinity) tiles.push({ i, j, s, w });
    }
  }
  console.log(`${tiles.length} tiles near the lines`);

  const seen = new Set<number>();
  const roads: { cls: number; pts: XY[] }[] = [];
  const buildings: { h: number; ring: XY[] }[] = [];
  let n = 0;
  for (const t of tiles) {
    const cached = existsSync(`${CACHE}/${t.i}_${t.j}.json`);
    process.stdout.write(`tile ${++n}/${tiles.length}${cached ? ' (kept)' : ''}\n`);
    for (const el of await tile(t.i, t.j, t.s, t.w, cachedOnly)) {
      if (seen.has(el.id)) continue;
      seen.add(el.id);
      const pts: XY[] = el.geometry.map((p) => [toX(p.lon), toZ(p.lat)]);
      if (el.tags.building !== undefined) {
        const ring = pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts;
        if (ring.length < 3 || area(ring) < MIN_BUILDING_AREA) continue;
        const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
        if (index.distance(cx, cz, BUILDING_CORRIDOR) === Infinity) continue;
        const simple = simplifyXY(ring, 0.6);
        if (simple.length >= 3) buildings.push({ h: buildingHeight(el.tags), ring: simple });
      } else {
        const cls = roadClass(el.tags.highway);
        if (cls < 0 || pts.length < 2) continue;
        if (cls >= 3 && !pts.some((p) => index.distance(p[0], p[1], ROAD_CORRIDOR) < Infinity)) continue;
        roads.push({ cls, pts: simplifyXY(pts, 2) });
      }
    }
  }
  roads.sort((a, b) => a.cls - b.cls);
  const file: MapFile = {
    version: 1,
    generated: new Date().toISOString(),
    license: 'Map data © OpenStreetMap contributors, available under the Open Database License (ODbL): https://www.openstreetmap.org/copyright',
    classes: [...ROAD_CLASSES],
    roads: roads.map((r) => { const e = encodePoints(r.pts); return [r.cls, ...e]; }),
    buildings: buildings.map((b) => { const e = encodePoints(b.ring); return [Math.round(b.h * 10), ...e]; }),
  };
  const json = JSON.stringify(file);
  writeFileSync(OUT, json);
  console.log(`${roads.length} roads, ${buildings.length} buildings -> ${OUT}: ${(json.length / 1024).toFixed(0)} kB (${(gzipSync(json).length / 1024).toFixed(0)} kB gzipped)`);
}

await main();
