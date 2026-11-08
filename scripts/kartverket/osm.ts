// Building outlines from OpenStreetMap for all the tiles of data-cache/tiles, kept in data-cache/osm-buildings/ (git-ignored).
// Map data © OpenStreetMap contributors, ODbL. Small cells, one request at a time with a pause, retries with
// growing waits and three mirrors (scripts/overpass.ts), and every answer is kept so that each cell is asked for once.
//
//   npx tsx scripts/kartverket/osm.ts      (asks for the missing cells; safe to stop and run again)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { TILE_SIZE } from '../../src/shared/tiles';
import { ORIGIN, toX, toZ } from '../../src/web/world';
import { overpass, PAUSE_MS, sleep, type OsmWay } from '../overpass';

export type { OsmWay };

export const OSM_DIR = 'data-cache/osm-buildings';
export const CELL_LAT = 0.02, CELL_LON = 0.04;

/** The cells (i, j) of the grid that the tiles in data-cache/tiles/index.json touch. */
export function cellsOfTiles(tiles: string[]): { i: number; j: number }[] {
  const mPerLon = toX(ORIGIN.lon + 1), mPerLat = -toZ(ORIGIN.lat + 1); // meters per degree; toZ is negative northwards
  const out = new Map<string, { i: number; j: number }>();
  for (const name of tiles) {
    const [ix, iz] = name.replace('.bin', '').split('_').map(Number);
    const x0 = ix * TILE_SIZE, z0 = iz * TILE_SIZE;
    const lon0 = ORIGIN.lon + x0 / mPerLon, lon1 = ORIGIN.lon + (x0 + TILE_SIZE) / mPerLon;
    const lat1 = ORIGIN.lat - z0 / mPerLat, lat0 = ORIGIN.lat - (z0 + TILE_SIZE) / mPerLat;
    for (let i = Math.floor(lat0 / CELL_LAT); i <= Math.floor(lat1 / CELL_LAT); i++) for (let j = Math.floor(lon0 / CELL_LON); j <= Math.floor(lon1 / CELL_LON); j++) out.set(`${i}_${j}`, { i, j });
  }
  return [...out.values()];
}

/** Ways with a `building` tag in a cell: from the answers kept, or asked for. */
export async function cell(i: number, j: number, ask = true): Promise<OsmWay[]> {
  const path = `${OSM_DIR}/${i}_${j}.json`;
  if (existsSync(path)) return (JSON.parse(readFileSync(path, 'utf8')) as OsmWay[]).filter((w) => w.tags.building !== undefined);
  if (!ask) return [];
  const s = i * CELL_LAT, w = j * CELL_LON, box = `${s},${w},${s + CELL_LAT},${w + CELL_LON}`;
  const elements = await overpass(`[out:json][timeout:90];way["building"](${box});out geom tags;`, 12);
  const slim: OsmWay[] = elements.filter((x) => x.geometry?.length).map((x) => {
    const t = x.tags ?? {}, tags: Record<string, string> = {};
    for (const k of ['building', 'height', 'building:levels', 'building:part', 'min_height', 'roof:shape']) if (t[k] !== undefined) tags[k] = t[k];
    return { id: x.id, tags, geometry: x.geometry.map((p) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 })) };
  });
  mkdirSync(OSM_DIR, { recursive: true });
  writeFileSync(`${OSM_DIR}/${i}_${j}.json`, JSON.stringify(slim));
  await sleep(PAUSE_MS);
  return slim;
}

if (/kartverket[/\\]osm\.ts$/.test(process.argv[1] ?? '')) {
  const index = JSON.parse(readFileSync('data-cache/tiles/index.json', 'utf8')) as { tiles: Record<string, number> };
  const cells = cellsOfTiles(Object.keys(index.tiles));
  console.log(`${cells.length} cells`);
  let n = 0, total = 0;
  for (const c of cells) {
    const had = existsSync(`${OSM_DIR}/${c.i}_${c.j}.json`);
    const ways = await cell(c.i, c.j);
    total += ways.length;
    console.log(`cell ${++n}/${cells.length}${had ? ' (kept)' : ''}: ${ways.length} buildings`);
  }
  console.log(`done: ${total} building outlines`);
}
