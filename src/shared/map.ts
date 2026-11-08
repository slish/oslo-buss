// Guessing what OpenStreetMap does not say. Map data © OpenStreetMap contributors, ODbL.

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
