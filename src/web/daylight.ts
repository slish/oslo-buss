// The light of the hour: from the time of the day (and the cloud) the colours of the sky, the tint that the map is lit with and
// the light on the models of the buses. How the tint reaches the map is in mapshader.ts.

import { Color } from 'three';
import { moonAt, sunAt, direction } from '../shared/sun';
import { ORIGIN } from './world';

export interface Light {
  /** Unit vectors toward the sun and the moon in the scene (x east, y up, z south), and altitudes in degrees. */
  sunDir: [number, number, number]; moonDir: [number, number, number]; sunAlt: number; moonAlt: number;
  moonFraction: number; moonPhase: number;
  skyTop: Color; skyHorizon: Color;
  /** What the map is multiplied by: 1 is the colours as they were drawn. */
  tint: Color;
  stars: number; windows: number;
  /** The light on the models of the buses. */
  ambient: Color; sunLight: Color; sunPower: number;
}

interface Key { alt: number; top: string; hor: string; tint: [number, number, number]; windows: number; stars: number }
// Keyed on the height of the sun in degrees: deep night, nautical and civil twilight, sunset, golden hour, day.
const KEYS: Key[] = [
  { alt: -18, top: '#01030a', hor: '#060b18', tint: [0.95, 1.05, 1.4], windows: 1, stars: 1 },
  { alt: -12, top: '#040a1e', hor: '#12183a', tint: [1.0, 1.1, 1.5], windows: 1, stars: 0.9 },
  { alt: -6, top: '#0f1d48', hor: '#4a3b6a', tint: [1.2, 1.25, 1.6], windows: 1, stars: 0.35 },
  { alt: -1, top: '#27407a', hor: '#e0824f', tint: [1.8, 1.45, 1.25], windows: 0.75, stars: 0 },
  { alt: 4, top: '#3a66a8', hor: '#f2b27a', tint: [2.7, 2.15, 1.5], windows: 0.3, stars: 0 },
  { alt: 12, top: '#4a82c4', hor: '#aecbe6', tint: [3.5, 3.2, 1.9], windows: 0, stars: 0 },
  { alt: 40, top: '#3f78c0', hor: '#b5d2ec', tint: [3.9, 3.6, 2.1], windows: 0, stars: 0 },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The light at `time` (ms since 1970); `cloud` 0 to 1 greys the sky and takes the sun out of the day. */
export function lightAt(time: number, cloud = 0, lat = ORIGIN.lat, lon = ORIGIN.lon): Light {
  const sun = sunAt(time, lat, lon), moon = moonAt(time, lat, lon);
  const alt = (sun.altitude * 180) / Math.PI;
  let i = 0;
  while (i < KEYS.length - 2 && alt > KEYS[i + 1].alt) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (alt - a.alt) / (b.alt - a.alt)));
  const skyTop = new Color(a.top).lerp(new Color(b.top), t), skyHorizon = new Color(a.hor).lerp(new Color(b.hor), t);
  const tint = new Color(mix(a.tint[0], b.tint[0], t), mix(a.tint[1], b.tint[1], t), mix(a.tint[2], b.tint[2], t));
  const day = smooth(-4, 8, alt);
  // Cloud: the day gets duller and greyer, the night less starry.
  const grey = new Color().setScalar(0.35 * (0.3 + 0.7 * day));
  skyTop.lerp(grey, cloud * 0.7); skyHorizon.lerp(grey.clone().multiplyScalar(1.4), cloud * 0.6);
  tint.multiplyScalar(1 - 0.3 * cloud * day);
  // The moon lights the night a little, the more the fuller it is and the higher it stands.
  const moonAlt = (moon.altitude * 180) / Math.PI;
  const moonLight = moon.fraction * smooth(0, 25, moonAlt) * (1 - day);
  tint.add(new Color(0.1, 0.12, 0.2).multiplyScalar(moonLight * (1 - 0.6 * cloud)));
  const sunPower = smooth(-2, 10, alt) * (1 - 0.6 * cloud);
  const sunLight = new Color().lerpColors(new Color('#ff9a55'), new Color('#fff4e0'), smooth(0, 15, alt));
  const ambient = new Color(0.35, 0.4, 0.6).lerp(new Color(1.2, 1.2, 1.25), day).add(new Color(0.05, 0.06, 0.1).multiplyScalar(moonLight));
  return {
    sunDir: direction(sun), moonDir: direction(moon), sunAlt: alt, moonAlt, moonFraction: moon.fraction, moonPhase: moon.phase,
    skyTop, skyHorizon, tint, stars: mix(a.stars, b.stars, t) * (1 - 0.8 * cloud), windows: mix(a.windows, b.windows, t), ambient, sunLight, sunPower,
  };
}
