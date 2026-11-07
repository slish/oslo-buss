// Which 2 km tiles the map needs: every tile within MARGIN of a line shape in the timetable (public/data/timetable.json),
// plus the 10 km height blocks that hold them. Used by download.ts (what to fetch) and build-tiles.ts (what to keep).
//   npx tsx scripts/kartverket/coverage.ts       (prints the tiles and blocks)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import proj4 from 'proj4';
import { decodeShape } from '../../src/shared/timetable';
import { TILE_SIZE } from '../../src/shared/tiles';
import { ORIGIN, toX, toZ } from '../../src/web/world';

/** Meters of map around every shape. */
export const MARGIN = 1500;
/** Origin of the grid of 10 km height blocks (download.ts DTM_BBOX). */
export const BLOCK = 10_000, BLOCK_E0 = 566_000, BLOCK_N0 = 6_612_000;

const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs');
const toUtm32 = (x: number, z: number): [number, number] => proj4('WGS84', 'EPSG:25832', [ORIGIN.lon + x / M_PER_DEG_LON, ORIGIN.lat - z / M_PER_DEG_LAT]) as [number, number];

/** Tile names ("ix_iz") within MARGIN of any shape in the timetable; empty if the timetable file is missing. */
export function neededTiles(file = join(process.cwd(), 'public', 'data', 'timetable.json'), margin = MARGIN): Set<string> {
  const out = new Set<string>();
  if (!existsSync(file)) return out;
  const flat = (JSON.parse(readFileSync(file, 'utf8')) as { shapes: Record<string, number[]> }).shapes;
  for (const id of Object.keys(flat)) {
    const s = decodeShape(flat[id]);
    for (let i = 0; i < s.lat.length - 1; i++) {
      const ax = toX(s.lon[i]), az = toZ(s.lat[i]), bx = toX(s.lon[i + 1]), bz = toZ(s.lat[i + 1]);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 200));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        for (let ix = Math.floor((x - margin) / TILE_SIZE); ix <= Math.floor((x + margin) / TILE_SIZE); ix++)
          for (let iz = Math.floor((z - margin) / TILE_SIZE); iz <= Math.floor((z + margin) / TILE_SIZE); iz++) out.add(`${ix}_${iz}`);
      }
    }
  }
  return out;
}

/** Height blocks ([easting, northing] of the south-west corner, UTM 32) that cover the given tiles, with a little extra for the tile edges. */
export function blocksOf(tiles: Iterable<string>): [number, number][] {
  const out = new Map<string, [number, number]>();
  for (const name of tiles) {
    const [ix, iz] = name.split('_').map(Number);
    for (const [fx, fz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const [e, n] = toUtm32((ix + fx) * TILE_SIZE, (iz + fz) * TILE_SIZE);
      for (const de of [-1, 1]) for (const dn of [-1, 1]) {
        const be = Math.floor((e + de * 30 - BLOCK_E0) / BLOCK) * BLOCK + BLOCK_E0, bn = Math.floor((n + dn * 30 - BLOCK_N0) / BLOCK) * BLOCK + BLOCK_N0;
        out.set(`${be},${bn}`, [be, bn]);
      }
    }
  }
  return [...out.values()];
}

if (/kartverket[\\/]coverage\.ts$/.test(process.argv[1] ?? '')) {
  const tiles = neededTiles();
  console.log(`${tiles.size} tiles, ${blocksOf(tiles).length} height blocks`);
}
