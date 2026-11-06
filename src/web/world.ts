// Latitude and longitude to the scene's meters. x is east, z is south (so north is up on screen), y is up.

export const ORIGIN = { lat: 59.9139, lon: 10.7522 }; // Oslo sentrum
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);

export const toX = (lon: number) => (lon - ORIGIN.lon) * M_PER_DEG_LON;
export const toZ = (lat: number) => -(lat - ORIGIN.lat) * M_PER_DEG_LAT;

/** Colours of the lines, as RGB 0-1. Neon on a dark ground: the points are light, not paint. */
export const LINE_COLORS: Record<string, string> = { '20': '#ffa51f', '31': '#2fc8ff', '63': '#ff4fa8' };
export const colorOf = (line: string) => LINE_COLORS[line] ?? '#c8d2e6';
