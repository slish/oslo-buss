import { describe, expect, it } from 'vitest';
import { lightAt } from '../src/web/daylight';

const at = (h: number, m = 0, cloud = 0) => lightAt(Date.UTC(2026, 10, 7, h - 1, m), cloud); // Oslo is UTC+1 in November

describe('lightAt', () => {
  it('has stars and lit windows at night, and neither at noon', () => {
    const night = at(23), noon = at(12);
    expect(night.stars).toBeGreaterThan(0.8); expect(night.windows).toBe(1);
    expect(noon.stars).toBe(0); expect(noon.windows).toBe(0);
  });
  it('is brighter at noon than at night', () => {
    const night = at(23), noon = at(12);
    expect(noon.tint.r).toBeGreaterThan(night.tint.r * 2);
    expect(noon.sunPower).toBeGreaterThan(night.sunPower);
  });
  it('is duller and greyer with cloud', () => {
    expect(at(12, 0, 1).tint.r).toBeLessThan(at(12, 0, 0).tint.r);
    expect(at(12, 0, 1).sunPower).toBeLessThan(at(12, 0, 0).sunPower);
  });
  it('changes smoothly through the day', () => {
    let prev = at(0).tint.r;
    for (let m = 5; m < 24 * 60; m += 5) {
      const r = at(Math.floor(m / 60), m % 60).tint.r;
      expect(Math.abs(r - prev)).toBeLessThan(0.25);
      prev = r;
    }
  });
});

describe('snowCover', () => {
  it('is nothing at 0 degrees and above, a little just below, and all of it at -10', async () => {
    const { snowCover } = await import('../src/web/daylight');
    expect(snowCover(3)).toBe(0); expect(snowCover(0)).toBe(0);
    expect(snowCover(-1)).toBeCloseTo(0.1); expect(snowCover(-5)).toBeCloseTo(0.5);
    expect(snowCover(-10)).toBe(1); expect(snowCover(-25)).toBe(1);
  });
});
