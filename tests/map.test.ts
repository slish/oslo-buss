import { describe, expect, it } from 'vitest';
import { pointToSegment, SegmentIndex, simplifyXY, type XY } from '../src/shared/geom';
import { buildingHeight, decodePoints, encodePoints, roadClass } from '../src/shared/map';

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

describe('map encoding', () => {
  it('round-trips points to the decimeter, with negative coordinates', () => {
    const pts: XY[] = [[-1203.4, 5521.9], [-1200.1, 5530.0], [15.5, -3.25]];
    const flat = [7, ...encodePoints(pts)]; // a leading class or height, as in the file
    const back = decodePoints(flat, 1);
    back.forEach((p, i) => { expect(p[0]).toBeCloseTo(pts[i][0], 0); expect(p[1]).toBeCloseTo(pts[i][1], 0); });
    expect(Math.abs(back[0][0] - pts[0][0])).toBeLessThanOrEqual(0.05);
  });
  it('classes roads and leaves out paths', () => {
    expect(roadClass('motorway_link')).toBe(0);
    expect(roadClass('primary')).toBe(1);
    expect(roadClass('residential')).toBe(4);
    expect(roadClass('footway')).toBe(-1);
    expect(roadClass(undefined)).toBe(-1);
  });
  it('reads building heights from tags, or guesses from the kind', () => {
    expect(buildingHeight({ building: 'yes', height: '12.5 m'.replace(' m', '') })).toBe(12.5);
    expect(buildingHeight({ building: 'yes', 'building:levels': '5' })).toBeCloseTo(16.5);
    expect(buildingHeight({ building: 'house' })).toBe(7);
    expect(buildingHeight({ building: 'yes' })).toBe(9);
    expect(buildingHeight({ building: 'yes', height: '9000' })).toBe(250); // a typo does not make a skyscraper
  });
});
