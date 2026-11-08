import { describe, expect, it } from 'vitest';
import { decodeTile, encodeTile, type Tile } from '../src/shared/tiles';
import { roofCodeOf, roofHeight, roofOf, roofParts } from '../src/shared/roof';
import { extrudeBlocks } from '../src/web/buildings';

/** A rectangle w meters east-west and d meters north-south, with its corner at (10, 20). */
const rect = (w: number, d: number): [number, number][] => [[10, 20], [10 + w, 20], [10 + w, 20 + d], [10, 20 + d]];

describe('roofOf', () => {
  it('gives a house a gabled roof with the ridge along the long side', () => {
    const r = roofOf(2, rect(12, 8), 7, 111)!;
    expect(r.kind).toBe('gabled');
    expect(Math.abs(r.ax)).toBeCloseTo(1, 5);
    expect(r.hw).toBeCloseTo(4, 5);
    expect(r.rise).toBeGreaterThan(1.5);
    expect(r.rise).toBeLessThan(3);
    expect(roofHeight(r, 16, 24)).toBeCloseTo(r.rise, 5); // on the ridge
    expect(roofHeight(r, 16, 20)).toBeCloseTo(0, 5); // at the eaves
  });
  it('leaves blocks of flats, big buildings and tall ones flat', () => {
    expect(roofOf(0, rect(40, 12), 30, 141)).toBeNull();
    expect(roofOf(0, rect(40, 20), 8, 0)).toBeNull();
    expect(roofOf(0, rect(12, 8), 20, 0)).toBeNull();
  });
  it('leaves a footprint that is not a rectangle flat', () => {
    const l: [number, number][] = [[0, 0], [12, 0], [12, 4], [4, 4], [4, 12], [0, 12]];
    expect(roofOf(0, l, 7, 111)).toBeNull();
  });
  it('follows what the tile says', () => {
    expect(roofOf(1, rect(12, 8), 7, 111)).toBeNull();
    expect(roofOf(4, rect(12, 8), 7, 111)!.kind).toBe('skillion');
    expect(roofOf(2, rect(40, 20), 12, 0)!.kind).toBe('gabled');
    expect(roofCodeOf('gabled')).toBe(2);
    expect(roofCodeOf('dome')).toBe(0);
  });
  it('cuts a ring into the pieces of the roof', () => {
    const ring = rect(12, 8);
    expect(roofParts(ring, roofOf(2, ring, 7, 0)!).map((p) => p.ring.length)).toEqual([4, 4]);
    const hip = roofOf(3, ring, 7, 0)!;
    expect(hip.kind).toBe('hipped');
    expect(roofParts(ring, hip).map((p) => p.ring.length)).toEqual([4, 4, 3, 3]);
    expect(roofHeight(hip, 16, 24)).toBeCloseTo(hip.rise, 5); // the middle of the ridge
    expect(roofHeight(hip, 11, 24)).toBeLessThan(hip.rise); // the end of the building slopes down
  });
});

describe('extrudeBlocks with roofs', () => {
  it('keeps the top of a gabled roof at the height of the block', () => {
    const ring = rect(12, 8);
    const roof = roofOf(2, ring, 7, 0)!;
    const mesh = extrudeBlocks([{ ring, height: 7, base: 0, roof }]);
    const y = mesh.geometry.getAttribute('position');
    let top = 0;
    for (let i = 0; i < y.count; i++) top = Math.max(top, y.getY(i));
    expect(top).toBeCloseTo(7, 5);
  });
});

describe('roof codes in tiles', () => {
  it('survive encoding, also next to buildings without one', () => {
    const ring = rect(12, 8);
    const tile: Tile = {
      ix: 1, iz: 1, points: [], roads: [], areas: [],
      buildings: [
        { height: 70, heightSource: 0, type: 111, ring },
        { height: 70, heightSource: 1, type: 0, osm: true, ring: ring.map(([x, z]) => [x + 50, z] as [number, number]) },
        { height: 70, heightSource: 1, type: 0, osm: true, roof: 4, ring: ring.map(([x, z]) => [x + 100, z] as [number, number]) },
      ],
    };
    tile.buildings.forEach((b) => b.ring = b.ring.map(([x, z]) => [x + 2000, z + 2000] as [number, number]));
    const back = decodeTile(encodeTile(tile));
    expect(back.buildings.map((b) => b.roof ?? 0)).toEqual([0, 0, 4]);
  });
});
