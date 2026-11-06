// The background map: roads and buildings from OpenStreetMap along the lines (scripts/build-map.ts).
// Map data © OpenStreetMap contributors, ODbL.
//
// Coordinates are in the scene's meters (src/web/world.ts) as whole decimeters, each line as its first point followed
// by differences, which keeps the file small and needs no projecting in the browser.

export interface MapFile {
  version: 1;
  generated: string;
  license: string;
  /** Road classes, by index. */
  classes: string[];
  /** [class, x0, z0, dx1, dz1, ...] */
  roads: number[][];
  /** [height in decimeters, x0, z0, dx1, dz1, ...] The ring is open: the last point is not the first. */
  buildings: number[][];
}

export const ROAD_CLASSES = ['motorway', 'primary', 'secondary', 'tertiary', 'residential'] as const;

/** Road class of an OSM `highway` value, as an index into ROAD_CLASSES, or -1 for what the map leaves out. */
export function roadClass(highway: string | undefined): number {
  switch (highway) {
    case 'motorway': case 'motorway_link': case 'trunk': case 'trunk_link': return 0;
    case 'primary': case 'primary_link': return 1;
    case 'secondary': case 'secondary_link': return 2;
    case 'tertiary': case 'tertiary_link': return 3;
    case 'residential': case 'unclassified': case 'living_street': return 4;
    default: return -1;
  }
}

/** Points (meters) to [first, differences...] in decimeters. */
export function encodePoints(points: [number, number][]): number[] {
  const out: number[] = [];
  let px = 0, pz = 0;
  for (const [x, z] of points) {
    const ix = Math.round(x * 10), iz = Math.round(z * 10);
    out.push(ix - px, iz - pz);
    px = ix; pz = iz;
  }
  return out;
}

/** The inverse, from `from` on in `flat`: points in meters. */
export function decodePoints(flat: number[], from: number): [number, number][] {
  const out: [number, number][] = [];
  let x = 0, z = 0;
  for (let i = from; i + 1 < flat.length; i += 2) {
    x += flat[i]; z += flat[i + 1];
    out.push([x / 10, z / 10]);
  }
  return out;
}

/** A building's height in meters from its OSM tags; a guess from the kind of building when it has neither. */
export function buildingHeight(tags: Record<string, string>): number {
  const h = parseFloat(tags.height ?? '');
  if (Number.isFinite(h) && h > 0) return Math.min(h, 250);
  const levels = parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return Math.min(levels, 70) * 3.1 + 1;
  switch (tags.building) {
    case 'house': case 'detached': case 'semidetached_house': case 'terrace': case 'garage': case 'garages': case 'shed': case 'cabin': return tags.building === 'house' || tags.building === 'detached' ? 7 : 4;
    case 'apartments': case 'residential': return 15;
    case 'church': case 'cathedral': return 18;
    case 'industrial': case 'warehouse': case 'commercial': case 'retail': return 9;
    default: return 9;
  }
}
