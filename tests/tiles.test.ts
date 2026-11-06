import { describe, expect, it } from 'vitest';
import { TILE_SIZE, decodeTile, encodeTile, tileName, tileOf, type Tile } from '../src/shared/tiles';

const sample = (): Tile => {
  const ox = 3 * TILE_SIZE, oz = -2 * TILE_SIZE;
  const n = 5;
  const heights = new Int16Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = 100 + i * 7 - j * 3 + (i * j) % 4;
  heights[0] = -30; // below sea level
  return {
    ix: 3, iz: -2,
    buildings: [{ height: 123, heightSource: 1, type: 111, ring: [[ox + 10.1, oz + 20.2], [ox + 30.3, oz + 20.2], [ox + 30.3, oz + 40.4], [ox + 10.1, oz + 40.4]] }],
    points: [{ x: ox + 500.5, z: oz + 1999.9, type: 161, height: 35, heightSource: 0 }, { x: ox + 12, z: oz + 8, type: 0, height: 70, heightSource: 1 }],
    roads: [{ cls: 2, points: [[ox, oz + 100], [ox + 1000, oz + 130.5], [ox + TILE_SIZE, oz + 90]] }],
    areas: [{ cls: 1, rings: [[[ox, oz], [ox + 800, oz], [ox + 800, oz + 800], [ox, oz + 800]], [[ox + 200, oz + 200], [ox + 300, oz + 200], [ox + 300, oz + 300]]] }],
    terrain: { n, step: 500, heights },
  };
};

describe('tile format', () => {
  it('round-trips a tile to the decimeter', () => {
    const t = sample();
    const back = decodeTile(encodeTile(t));
    expect(back.ix).toBe(3);
    expect(back.iz).toBe(-2);
    expect(back.buildings).toHaveLength(1);
    expect(back.buildings[0].height).toBe(123);
    expect(back.buildings[0].heightSource).toBe(1);
    expect(back.buildings[0].type).toBe(111);
    back.buildings[0].ring.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(t.buildings[0].ring[i][0], 1);
      expect(p[1]).toBeCloseTo(t.buildings[0].ring[i][1], 1);
    });
    expect(back.points).toHaveLength(2);
    expect(back.points[0].x).toBeCloseTo(t.points[0].x, 1);
    expect(back.points[0].z).toBeCloseTo(t.points[0].z, 1);
    expect(back.points[1]).toMatchObject({ type: 0, height: 70, heightSource: 1 });
    expect(back.roads[0].cls).toBe(2);
    expect(back.roads[0].points).toHaveLength(3);
    expect(back.roads[0].points[1][1]).toBeCloseTo(t.roads[0].points[1][1], 1);
    expect(back.areas[0].rings.map((r) => r.length)).toEqual([4, 3]);
  });

  it('round-trips terrain exactly, including negative heights', () => {
    const t = sample();
    const back = decodeTile(encodeTile(t));
    expect(back.terrain!.n).toBe(5);
    expect(back.terrain!.step).toBe(500);
    expect([...back.terrain!.heights]).toEqual([...t.terrain!.heights]);
  });

  it('handles an empty tile and skips unknown sections', () => {
    const empty = decodeTile(encodeTile({ ix: -1, iz: 0, buildings: [], points: [], roads: [], areas: [] }));
    expect(empty).toMatchObject({ ix: -1, iz: 0, buildings: [] });
    expect(empty.terrain).toBeUndefined();
    const bytes = encodeTile(sample());
    const withUnknown = new Uint8Array(bytes.length + 5);
    withUnknown.set(bytes);
    withUnknown.set([99, 3, 1, 2, 3], bytes.length); // section 99, 3 bytes
    expect(decodeTile(withUnknown).buildings).toHaveLength(1);
  });

  it('rejects data that is not a tile', () => {
    expect(() => decodeTile(new Uint8Array([1, 2, 3, 4, 5]))).toThrow(/magic/);
    const bytes = encodeTile(sample());
    bytes[4] = 9;
    expect(() => decodeTile(bytes)).toThrow(/version/);
  });

  it('is much smaller than the same geometry as JSON', () => {
    const t = sample();
    expect(encodeTile(t).length).toBeLessThan(JSON.stringify(t).length / 3);
  });

  it('finds the tile of a point and names its file', () => {
    expect(tileOf(0, 0)).toEqual([0, 0]);
    expect(tileOf(-0.1, 1999.9)).toEqual([-1, 0]);
    expect(tileOf(4000, -2001)).toEqual([2, -2]);
    expect(tileName(-3, 4)).toBe('-3_4.bin');
  });
});
