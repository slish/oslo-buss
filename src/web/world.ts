// Latitude and longitude to the scene's meters. x is east, z is south (so north is up on screen), y is up.

export const ORIGIN = { lat: 59.9139, lon: 10.7522 }; // Oslo sentrum
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const toX = (lon: number) => (lon - ORIGIN.lon) * M_PER_DEG_LON;
export const toZ = (lat: number) => -(lat - ORIGIN.lat) * M_PER_DEG_LAT;

/** Colours of the lines, as RGB 0-1. Neon on a dark ground: the points are light, not paint. */
export const LINE_COLORS: Record<string, string> = {
  '20': '#ffa51f', '24': '#e86bff', '31': '#2fc8ff', '46': '#b48cff', '54': '#ffe14d',
  '58': '#3dffc4', '63': '#ff4fa8', '70': '#ff6b4a', '71': '#5a7bff', '130': '#8cff5a',
};
/** Lines without a fixed colour get one from their name: hues spread by the golden angle, so neighbours differ. */
function hashColor(line: string): string {
  let n = 0;
  for (const c of line) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const h = ((n * 137.508) % 360) / 360, s = 0.85, l = 0.62;
  const f = (k: number) => {
    const a = s * Math.min(l, 1 - l), t = (k + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(t - 3, 9 - t, 1))));
  };
  return '#' + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export const colorOf = (line: string) => LINE_COLORS[line] ?? hashColor(line);
