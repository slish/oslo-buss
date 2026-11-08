import { describe, expect, it } from 'vitest';
import { pointToSegment, SegmentIndex, simplifyXY, type XY } from '../src/shared/geom';
import { buildingHeight } from '../src/shared/map';

describe('geom', () => {
  it('simplifies a straight run to its ends and keeps a corner', () => {
    const straight: XY[] = Array.from({ length: 30 }, (_, i) => [i * 10, 0.5 * Math.sin(i)]);
    expect(simplifyXY(straight, 2)).toHaveLength(2);
    const corner: XY[] = [...Array.from({ length: 10 }, (_, i): XY => [i * 10, 0]), ...Array.from({ length: 10 }, (_, i): XY => [90, (i + 1) * 10])];
    const kept = simplifyXY(corner, 2);
    expect(kept).toHaveLength(3);
    expect(kept[1]).toEqual([90, 0]);
  });
  it('measures a point against a segment, also past its ends', () => {
    expect(pointToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(pointToSegment(13, 4, 0, 0, 10, 0)).toBe(5);
    expect(pointToSegment(1, 1, 0, 0, 0, 0)).toBeCloseTo(Math.SQRT2);
  });
  it('finds the nearest line through the grid, and gives up beyond the limit', () => {
    const index = new SegmentIndex([[[0, 0], [2000, 0]], [[0, 800], [0, 3000]]], 500);
    expect(index.distance(1200, 40, 100)).toBe(40);
    expect(index.distance(30, 1500, 100)).toBe(30); // near the second line, across several cells
    expect(index.distance(1200, 400, 100)).toBe(Infinity);
    expect(index.distance(1200, 400, 500)).toBe(400);
  });
});

describe('buildingHeight', () => {
  it('reads building heights from tags, or guesses from the kind', () => {
    expect(buildingHeight({ building: 'yes', height: '12.5 m'.replace(' m', '') })).toBe(12.5);
    expect(buildingHeight({ building: 'yes', 'building:levels': '5' })).toBeCloseTo(16.5);
    expect(buildingHeight({ building: 'house' })).toBe(7);
    expect(buildingHeight({ building: 'yes' })).toBe(9);
    expect(buildingHeight({ building: 'yes', height: '9000' })).toBe(250); // a typo does not make a skyscraper
  });
});
