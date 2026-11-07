import { describe, expect, it } from 'vitest';
import { direction, moonAt, sunAt } from '../src/shared/sun';

const deg = (r: number) => (r * 180) / Math.PI;
const OSLO = [59.9139, 10.7522] as const;

describe('sun', () => {
  it('stands about 6.5 degrees up at noon at the winter solstice and 53.5 at midsummer', () => {
    // Solar noon in Oslo is about 11:15 UTC at the winter solstice.
    const winter = Math.max(...Array.from({ length: 48 }, (_, i) => deg(sunAt(Date.UTC(2026, 11, 21, 9 + i / 12), ...OSLO).altitude)));
    const summer = Math.max(...Array.from({ length: 48 }, (_, i) => deg(sunAt(Date.UTC(2026, 5, 21, 9 + i / 12), ...OSLO).altitude)));
    expect(winter).toBeGreaterThan(6); expect(winter).toBeLessThan(7.2);
    expect(summer).toBeGreaterThan(53); expect(summer).toBeLessThan(54.2);
  });
  it('is below the horizon at midnight in November and in the south at noon', () => {
    expect(sunAt(Date.UTC(2026, 10, 7, 23), ...OSLO).altitude).toBeLessThan(0);
    const noon = sunAt(Date.UTC(2026, 10, 7, 11, 15), ...OSLO);
    expect(deg(noon.azimuth)).toBeGreaterThan(170); expect(deg(noon.azimuth)).toBeLessThan(190);
  });
  it('points toward the south in the scene at noon (z positive)', () => {
    const [, y, z] = direction(sunAt(Date.UTC(2026, 10, 7, 11, 15), ...OSLO));
    expect(y).toBeGreaterThan(0); expect(z).toBeGreaterThan(0);
  });
});

describe('moon', () => {
  it('is full on 2026-11-24 (new moon on the 9th)', () => {
    expect(moonAt(Date.UTC(2026, 10, 24, 14), ...OSLO).fraction).toBeGreaterThan(0.95);
    expect(moonAt(Date.UTC(2026, 10, 9, 8), ...OSLO).fraction).toBeLessThan(0.05);
  });
});
