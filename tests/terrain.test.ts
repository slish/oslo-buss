import { describe, expect, it } from 'vitest';
import { upsample2 } from '../src/shared/terrain';

describe('upsample2', () => {
  it('keeps the original samples and doubles the resolution', () => {
    const n = 4, g = Int16Array.from({ length: n * n }, (_, k) => (k % n) * 10 + Math.floor(k / n) * 7);
    const out = upsample2(g, n);
    expect(out.length).toBe(7 * 7);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) expect(out[2 * j * 7 + 2 * i]).toBe(g[j * n + i]);
  });
  it('follows a plane exactly, also halfway', () => {
    const n = 5, g = Float32Array.from({ length: n * n }, (_, k) => (k % n) * 4 + Math.floor(k / n) * 2);
    const out = upsample2(g, n);
    // Halfway between samples: x + 0.5 steps = +2, y + 0.5 steps = +1 (away from the edge, where the plane is not clamped).
    expect(out[2 * 9 + 3]).toBeCloseTo(g[1 * n + 1] + 2, 6);
    expect(out[3 * 9 + 2]).toBeCloseTo(g[1 * n + 1] + 1, 6);
    expect(out[3 * 9 + 3]).toBeCloseTo(g[1 * n + 1] + 3, 6);
  });
  it('is smooth over a bump: halfway points lie on the curve, not the chord', () => {
    const n = 5, g = new Float32Array(n * n);
    g[2 * n + 2] = 100; // a single peak
    const out = upsample2(g, n);
    const chord = 50;
    expect(out[4 * 9 + 5]).toBeGreaterThan(chord); // halfway between the peak and its neighbour
  });
});
