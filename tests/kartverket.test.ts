import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clipLine, clipRing, pointInRing, ringArea } from '../scripts/kartverket/clip';
import { HeightField, readFloatTiff } from '../scripts/kartverket/geotiff';
import { field, lineStrings, members, parsePosList, surfaceRings } from '../scripts/kartverket/gml';

const R = { x0: 0, z0: 0, x1: 10, z1: 10 };

describe('clipping', () => {
  it('cuts a line where it leaves the rectangle', () => {
    expect(clipLine([[-5, 5], [15, 5]], R)).toEqual([[[0, 5], [10, 5]]]);
  });
  it('splits a line that leaves and comes back', () => {
    const pieces = clipLine([[2, 2], [2, 20], [8, 20], [8, 2]], R);
    expect(pieces).toEqual([[[2, 2], [2, 10]], [[8, 10], [8, 2]]]);
  });
  it('drops lines that are outside', () => {
    expect(clipLine([[20, 20], [30, 30]], R)).toEqual([]);
    expect(clipLine([[1, 1]], R)).toEqual([]);
  });
  it('clips a ring to the rectangle', () => {
    const clipped = clipRing([[-5, -5], [5, -5], [5, 5], [-5, 5]], R);
    expect(Math.abs(ringArea(clipped))).toBeCloseTo(25);
    expect(clipRing([[20, 20], [30, 20], [30, 30]], R)).toEqual([]);
    expect(clipRing([[1, 1], [2, 1], [2, 2]], R)).toHaveLength(3);
  });
  it('tests points against rings', () => {
    const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(pointInRing(5, 5, ring)).toBe(true);
    expect(pointInRing(15, 5, ring)).toBe(false);
  });
});

describe('GML reading', () => {
  const surface = `<app:Skog gml:id="a"><app:område><gml:Surface><gml:patches><gml:PolygonPatch>
    <gml:exterior><gml:LinearRing><gml:posList>0 0 10 0 10 10 0 10 0 0</gml:posList></gml:LinearRing></gml:exterior>
    <gml:interior><gml:LinearRing><gml:posList>2 2 4 2 4 4 2 2</gml:posList></gml:LinearRing></gml:interior>
    </gml:PolygonPatch></gml:patches></gml:Surface></app:område></app:Skog>`;
  it('reads rings and tells holes from outer rings', () => {
    const rings = surfaceRings(surface);
    expect(rings.map((r) => r.outer)).toEqual([true, false]);
    expect(rings[0].ring).toHaveLength(5);
  });
  it('reads fields and position lists, dropping the height of 3D points', () => {
    expect(field('<typeVeg>bilveg</typeVeg>', 'typeVeg')).toBe('bilveg');
    expect(field('<x>1</x>', 'y')).toBeUndefined();
    expect(parsePosList('1 2 30 4 5 60', 3)).toEqual([[1, 2], [4, 5]]);
    expect(lineStrings('<gml:LineString><gml:posList srsDimension="3">1 2 3 4 5 6</gml:posList></gml:LineString>', 3)).toEqual([[[1, 2], [4, 5]]]);
  });
  it('splits a file into its members across chunk borders', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gml-'));
    const file = join(dir, 'a.gml');
    const items = Array.from({ length: 2000 }, (_, i) => `<gml:featureMember><app:Bygning>${i} æøå ${'x'.repeat(50)}</app:Bygning></gml:featureMember>`);
    writeFileSync(file, `<?xml version="1.0"?><gml:FeatureCollection>${items.join('\n')}</gml:FeatureCollection>`);
    const out: string[] = [];
    for await (const m of members(file, 'gml:featureMember')) out.push(m);
    expect(out).toHaveLength(2000);
    expect(out[1999]).toContain('1999 æøå');
  });
});

/** A small tiled float32 TIFF like the ones the WCS returns: 2x2 pixels in 2x2-pixel tiles, the second tile empty. */
function makeTiff(width: number, height: number, tile: number, values: number[]): Uint8Array {
  const tilesAcross = Math.ceil(width / tile), tilesDown = Math.ceil(height / tile), n = tilesAcross * tilesDown;
  const entries = 9;
  const ifdSize = 2 + entries * 12 + 4;
  const offsetsAt = 8 + ifdSize, countsAt = offsetsAt + 4 * n, dataAt = countsAt + 4 * n;
  const buf = new ArrayBuffer(dataAt + n * tile * tile * 4);
  const v = new DataView(buf);
  v.setUint16(0, 0x4949, true); v.setUint16(2, 42, true); v.setUint32(4, 8, true);
  v.setUint16(8, entries, true);
  const tags: [number, number, number, number][] = [
    [256, 3, 1, width], [257, 3, 1, height], [258, 3, 1, 32], [259, 3, 1, 1], [322, 3, 1, tile], [323, 3, 1, tile],
    [324, 4, n, offsetsAt], [325, 4, n, countsAt], [339, 3, 1, 3],
  ];
  tags.forEach(([tag, type, count, value], i) => {
    const at = 10 + i * 12;
    v.setUint16(at, tag, true); v.setUint16(at + 2, type, true); v.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) v.setUint16(at + 8, value, true); else v.setUint32(at + 8, value, true);
  });
  for (let t = 0; t < n; t++) {
    const empty = t === n - 1 && n > 1;
    v.setUint32(offsetsAt + 4 * t, empty ? 0 : dataAt + t * tile * tile * 4, true);
    v.setUint32(countsAt + 4 * t, empty ? 0 : tile * tile * 4, true);
    if (!empty) for (let k = 0; k < tile * tile; k++) v.setFloat32(dataAt + (t * tile * tile + k) * 4, values[t * tile * tile + k] ?? 0, true);
  }
  return new Uint8Array(buf);
}

describe('GeoTIFF reading', () => {
  it('reads tiles into one grid and leaves empty tiles as zero', () => {
    const g = readFloatTiff(makeTiff(4, 2, 2, [1, 2, 3, 4, 5, 6, 7, 8]));
    expect([g.width, g.height]).toEqual([4, 2]);
    expect([...g.data.slice(0, 4)]).toEqual([1, 2, 0, 0]);
    expect([...g.data.slice(4)]).toEqual([3, 4, 0, 0]);
  });
  it('refuses what it cannot read', () => {
    expect(() => readFloatTiff(new Uint8Array(16))).toThrow(/TIFF/);
  });
  it('looks up heights by coordinate, with blocks anchored at an offset', () => {
    // One 20 m block with 10 m cells at easting 105, northing 207: rows go from north to south.
    const f = new HeightField(20, 10, (h) => h > -50, 5, 7);
    f.add(105, 207, { width: 2, height: 2, data: Float32Array.from([10, 20, 30, 40]) });
    expect(f.at(110, 225)).toBe(10); // north-west cell
    expect(f.at(120, 210)).toBe(40); // south-east cell
    expect(f.at(500, 500)).toBeNaN();
    expect(f.bilinear(115, 217)).toBeCloseTo(25, 5); // the middle of the four cell centres
  });
});
