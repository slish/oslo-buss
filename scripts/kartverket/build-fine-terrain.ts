// Finer terrain for the tiles that exist in data-cache/tiles: the 10 m terrain model, one terrain-only tile per 2 km tile.
// Reads data-cache/kartverket/dtm10 and data-cache/tiles/index.json, writes data-cache/tiles-fine/ (gitignored).
//   npx tsx scripts/kartverket/build-fine-terrain.ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { TILE_SIZE, encodeTile, type Tile, type TileIndex } from '../../src/shared/tiles';
import { DTM_BLOCK, DTM_RES } from './download';
import { loadField, utm32Of } from './build-tiles';

const STEP = 10;
const OUT = join(process.cwd(), 'data-cache', 'tiles-fine');
const index = JSON.parse(readFileSync(join(process.cwd(), 'data-cache', 'tiles', 'index.json'), 'utf8')) as TileIndex;
const dtm = loadField('dtm10', DTM_RES, DTM_BLOCK);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const n = TILE_SIZE / STEP + 1;
const out: TileIndex = { ...index, tiles: {} };
let raw = 0, gz = 0, count = 0;
for (const name of Object.keys(index.tiles)) {
  const [ix, iz] = name.replace('.bin', '').split('_').map(Number);
  const heights = new Int16Array(n * n);
  let any = false;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [e, nn] = utm32Of(ix * TILE_SIZE + i * STEP, iz * TILE_SIZE + j * STEP);
    const h = dtm.bilinear(e, nn);
    if (Number.isFinite(h)) { heights[j * n + i] = Math.round(h * 10); any = true; }
  }
  if (!any) continue;
  const tile: Tile = { ix, iz, buildings: [], points: [], roads: [], areas: [], terrain: { n, step: STEP, heights } };
  const bytes = encodeTile(tile);
  writeFileSync(join(OUT, name), bytes);
  out.tiles[name] = bytes.length;
  raw += bytes.length; gz += gzipSync(bytes, { level: 9 }).length; count++;
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(out));
console.log({ tiles: count, rawMB: +(raw / 1e6).toFixed(1), gzipMB: +(gz / 1e6).toFixed(1), perTileKB: Math.round(raw / count / 1000) });
