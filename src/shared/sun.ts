// Where the sun and the moon stand, from the date and the place: a few hundred lines of astronomy short enough to do in the
// browser. Good to about a degree, which is far more than a sky needs. Angles in radians; azimuth from north, clockwise.

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588, J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (t: number) => t / DAY_MS - 0.5 + J1970 - J2000;
const rightAscension = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const siderealTime = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;

export interface Sky { altitude: number; azimuth: number }

function horizontal(d: number, lat: number, lon: number, ra: number, dec: number): Sky {
  const lw = -lon * RAD, phi = lat * RAD, H = siderealTime(d, lw) - ra;
  return {
    altitude: Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)),
    azimuth: Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI,
  };
}

/** The sun at `time` (ms since 1970), seen from lat/lon in degrees. */
export function sunAt(time: number, lat: number, lon: number): Sky {
  const d = toDays(time);
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI; // ecliptic longitude
  return horizontal(d, lat, lon, rightAscension(L, 0), declination(L, 0));
}

/** The moon at `time`, with the lit part of its face (0 new, 1 full) and its phase (0 new, 0.5 full, 1 new again). */
export function moonAt(time: number, lat: number, lon: number): Sky & { fraction: number; phase: number } {
  const d = toDays(time);
  const L = RAD * (218.316 + 13.176396 * d), M = RAD * (134.963 + 13.064993 * d), F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M), b = RAD * 5.128 * Math.sin(F);
  const sky = horizontal(d, lat, lon, rightAscension(l, b), declination(l, b));
  // The phase from the angle between sun and moon along the ecliptic.
  const sunM = RAD * (357.5291 + 0.98560028 * d);
  const sunL = sunM + RAD * (1.9148 * Math.sin(sunM)) + RAD * 102.9372 + Math.PI;
  const elong = Math.atan2(Math.sin(l - sunL), Math.cos(l - sunL));
  return { ...sky, fraction: (1 - Math.cos(elong)) / 2, phase: ((elong / (2 * Math.PI)) + 1) % 1 };
}

/** The unit vector toward a sky position in the scene: x east, y up, z south. */
export function direction(s: Sky): [number, number, number] {
  const c = Math.cos(s.altitude);
  return [c * Math.sin(s.azimuth), Math.sin(s.altitude), -c * Math.cos(s.azimuth)];
}
