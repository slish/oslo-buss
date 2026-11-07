// Colours for the terrain seen from the seat of a bus: a dusk version of nature, with variation from place to place,
// rock on the steep ground, and a little less noise on water. Only used up close (see KartverketMap.setRide).

import { Color } from 'three';

/** Land cover classes: sea, water, farmland, marsh, forest, built, park. */
export const RIDE_COLORS = ['#16315c', '#1d4572', '#4a5a2c', '#3b5446', '#1f4a2b', '#4a4d58', '#3f7a3f'].map((c) => new Color(c));
export const RIDE_GROUND = new Color('#33392c');
const ROCK = new Color('#7a7873');
export const ASPHALT = new Color('#2a2c33');
export const GRAVEL = new Color('#4b4638');

function hash(i: number, j: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise in 0..1 with a feature size of one unit. */
export function noise(x: number, z: number): number {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The colour of a point: land cover class (-1: none), slope in meters per meter, and its place in the scene (for the variation). */
export function rideColor(out: Color, cls: number, slope: number, x: number, z: number): Color {
  const base = cls < 0 ? RIDE_GROUND : RIDE_COLORS[cls];
  const water = cls === 0 || cls === 1;
  const patch = noise(x / 45, z / 45), grain = noise(x / 7, z / 7);
  const k = water ? 0.97 + 0.06 * patch : 0.8 + 0.3 * patch + 0.18 * grain;
  out.copy(base).multiplyScalar(k);
  if (!water) { // steep ground shows rock
    const rock = smooth(0.4, 0.95, slope) * (0.55 + 0.45 * grain);
    out.lerp(ROCK, rock * 0.75).multiplyScalar(1 + rock * 0.1);
  }
  return out;
}
