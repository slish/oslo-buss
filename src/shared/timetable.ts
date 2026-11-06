// The timetable file for the chosen lines (scripts/build-timetable.ts) and its in-memory form.
//
// Patterns are shared between trips: most trips of a line run the same stops with the same relative times, and only
// start at another time. Shapes are the road geometry, delta-encoded.

import { osloTime, previousDate } from './time';

export const TRIP_PREFIX = 'RUT:ServiceJourney:';

export interface TimetableFile {
  version: 1;
  generated: string;
  /** Lines in the file. */
  lines: { id: string; name: string; long: string }[];
  /** Stop id -> [name, lat, lon]. */
  stops: Record<string, [string, number, number]>;
  /** Shape id -> flat [lat*1e5, lon*1e5, meters] with each value after the first triple given as a difference. */
  shapes: Record<string, number[]>;
  patterns: {
    line: number;
    direction: number;
    headsign: string;
    shape: string;
    stops: string[];
    /** stop_sequence of each stop. */
    seq: number[];
    /** Meters along the shape. */
    dist: number[];
    /** Arrival and departure, seconds after the trip's start. */
    arr: number[];
    dep: number[];
  }[];
  /** Service day lists (YYYYMMDD). */
  services: string[][];
  /** [id without TRIP_PREFIX, pattern, start seconds after midnight of the service day, service]. */
  trips: [string, number, number, number][];
}

export interface Shape {
  lat: Float64Array;
  lon: Float64Array;
  dist: Float64Array;
}

export interface Trip {
  id: string;
  pattern: TimetableFile['patterns'][number];
  start: number;
  service: number;
}

export function decodeShape(flat: number[]): Shape {
  const n = flat.length / 3;
  const lat = new Float64Array(n), lon = new Float64Array(n), dist = new Float64Array(n);
  let a = 0, b = 0, c = 0;
  for (let i = 0; i < n; i++) {
    a += flat[i * 3]; b += flat[i * 3 + 1]; c += flat[i * 3 + 2];
    lat[i] = a / 1e5; lon[i] = b / 1e5; dist[i] = c;
  }
  return { lat, lon, dist };
}

export class Timetable {
  readonly shapes = new Map<string, Shape>();
  readonly trips: Trip[];
  readonly byId = new Map<string, Trip>();
  private readonly serviceSets: Set<string>[];
  private readonly dayCache = new Map<string, Trip[]>();

  constructor(readonly file: TimetableFile) {
    for (const [id, flat] of Object.entries(file.shapes)) this.shapes.set(id, decodeShape(flat));
    this.serviceSets = file.services.map((d) => new Set(d));
    this.trips = file.trips.map(([id, pattern, start, service]) => ({ id: TRIP_PREFIX + id, pattern: file.patterns[pattern], start, service }));
    for (const t of this.trips) this.byId.set(t.id, t);
  }

  /** The trips whose service day is `date`. */
  tripsOn(date: string): Trip[] {
    let list = this.dayCache.get(date);
    if (!list) {
      list = this.trips.filter((t) => this.serviceSets[t.service].has(date));
      this.dayCache.set(date, list);
      if (this.dayCache.size > 4) this.dayCache.delete(this.dayCache.keys().next().value!);
    }
    return list;
  }

  runsOn(trip: Trip, date: string): boolean {
    return this.serviceSets[trip.service].has(date);
  }

  /** The last service date the file covers. */
  lastDate(): string {
    return this.serviceSets.reduce((m, s) => { for (const d of s) if (d > m) m = d; return m; }, '');
  }

  /** The service days that can have a bus on the road at `epochMs`: today, and yesterday for trips that pass midnight. */
  activeDates(epochMs: number): string[] {
    const { date } = osloTime(epochMs);
    return [date, previousDate(date)];
  }
}
