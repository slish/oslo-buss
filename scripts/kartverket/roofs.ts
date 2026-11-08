// Puts OpenStreetMap's roof:shape into tiles that are already built (data-cache/tiles), for the tiles named, without
// building them again from the raw data. A full build (build-tiles.ts) does the same for every tile. Map data © OpenStreetMap contributors, ODbL.
//
//   npx tsx scripts/kartverket/roofs.ts 3_-3 4_-3     (the tiles named)
//   npx tsx scripts/kartverket/roofs.ts all           (every tile of data-cache/tiles/index.json; safe to stop and run again)

import { readFileSync, writeFileSync } from 'node:fs';
import { pointInRing } from '../../src/shared/geom';
import { roofCodeOf } from '../../src/shared/roof';
import { decodeTile, encodeTile, TILE_SIZE, type XY } from '../../src/shared/tiles';
import { ORIGIN, toX, toZ } from '../../src/web/world';
import { overpass, PAUSE_MS, sleep } from '../overpass';

const DIR = 'data-cache/tiles';

async function patch(name: string): Promise<void> {
  const file = `${DIR}/${name}.bin`;
  const tile = decodeTile(new Uint8Array(readFileSync(file)));
  const mPerLon = toX(ORIGIN.lon + 1), mPerLat = -toZ(ORIGIN.lat + 1);
  const x0 = tile.ix * TILE_SIZE, z0 = tile.iz * TILE_SIZE;
  const west = ORIGIN.lon + x0 / mPerLon, east = ORIGIN.lon + (x0 + TILE_SIZE) / mPerLon;
  const north = ORIGIN.lat - z0 / mPerLat, south = ORIGIN.lat - (z0 + TILE_SIZE) / mPerLat;
  const ways = await overpass(`[out:json][timeout:90];way["building"]["roof:shape"](${south},${west},${north},${east});out geom tags;`, 12);
  let set = 0;
  const shapes = new Map<string, number>();
  for (const w of ways) {
    const code = roofCodeOf(w.tags['roof:shape']);
    shapes.set(w.tags['roof:shape'], (shapes.get(w.tags['roof:shape']) ?? 0) + 1);
    if (!code || !w.geometry?.length) continue;
    const pts: XY[] = w.geometry.map((p) => [toX(p.lon), toZ(p.lat)]);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const b = tile.buildings.find((x) => x.osm && pointInRing(cx, cz, x.ring));
    if (b) { b.roof = code; set++; }
  }
  writeFileSync(file, encodeTile(tile));
  console.log(`${name}: ${ways.length} ways with roof:shape (${[...shapes].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), ${set} put on buildings of the tile`);
}

const args = process.argv.slice(2);
const names = args[0] === 'all' ? Object.keys((JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8')) as { tiles: Record<string, number> }).tiles) : args;
if (!names.length) { console.log('usage: tsx scripts/kartverket/roofs.ts 3_-3 4_-3'); process.exit(1); }
for (const [i, name] of names.entries()) {
  if (i) await sleep(PAUSE_MS);
  console.log(`[${i + 1}/${names.length}]`);
  await patch(name.replace('.bin', ''));
}
