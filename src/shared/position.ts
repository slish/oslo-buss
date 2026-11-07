// Where a bus is: its timetable, moved to what Entur expects now, laid along the road geometry.
//
// Entur gives times per stop, not positions (Ruter sends no GPS to Entur's vehicle feeds). Between two stops the
// bus is placed by time: the fraction of the way between the stops' departure and arrival is the fraction of the
// distance along the shape (the road). It stands at a stop between its arrival and departure.

import { osloEpoch } from './time';
import type { Shape, Timetable, Trip } from './timetable';
import type { StopUpdate, TripUpdate } from './protobuf';

export interface Bus {
  /** Trip id without the RUT:ServiceJourney: prefix, plus the service day: the same trip runs on other days. */
  id: string;
  line: string;
  direction: number;
  headsign: string;
  lat: number;
  lon: number;
  /** Degrees clockwise from north. */
  bearing: number;
  /** Seconds late (negative: early) at the last stop it left or reached. */
  delay: number;
  atStop: boolean;
  /** Whether Entur has told us about this trip (otherwise it is the plain timetable). */
  live: boolean;
  /** Name of the stop it is heading for, or standing at. */
  next: string;
  /** The road it follows (a key in the timetable's shapes) and how far along it the bus is, in meters. */
  shape: string;
  dist: number;
  /** Meters per second along the road right now (0 at a stop), and where it stops moving: the next stop's distance. */
  speed: number;
  until: number;
}

export interface Place { lat: number; lon: number; bearing: number }

/** The point `dist` meters along a shape, and the direction of the road there. */
export function placeOnShape(shape: Shape, dist: number): Place {
  const n = shape.dist.length;
  if (dist <= shape.dist[0]) return segment(shape, 0, 0);
  if (dist >= shape.dist[n - 1]) return segment(shape, n - 2, 1);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (shape.dist[mid] <= dist) lo = mid; else hi = mid;
  }
  const span = shape.dist[hi] - shape.dist[lo];
  return segment(shape, lo, span > 0 ? (dist - shape.dist[lo]) / span : 0);
}

function segment(shape: Shape, i: number, f: number): Place {
  const a = i, b = i + 1;
  const lat = shape.lat[a] + (shape.lat[b] - shape.lat[a]) * f;
  const lon = shape.lon[a] + (shape.lon[b] - shape.lon[a]) * f;
  const dy = shape.lat[b] - shape.lat[a];
  const dx = (shape.lon[b] - shape.lon[a]) * Math.cos((shape.lat[a] * Math.PI) / 180);
  const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
  return { lat, lon, bearing: (bearing + 360) % 360 };
}

export interface Expected {
  /** Epoch seconds. */
  arr: number[];
  dep: number[];
  /** Delay in seconds at departure, per stop. */
  delay: number[];
  live: boolean;
}

/** The timetable of a trip on a service day, in epoch seconds, moved to the times a TripUpdate expects. */
export function expectedTimes(trip: Trip, date: string, update?: TripUpdate): Expected {
  const p = trip.pattern;
  const base = osloEpoch(date, trip.start) / 1000;
  const n = p.stops.length;
  const schedArr = p.arr.map((s) => base + s);
  const schedDep = p.dep.map((s) => base + s);

  // Delay of each stop's arrival and departure as far as the update says; NaN where it is silent.
  const dArr = new Array<number>(n).fill(NaN), dDep = new Array<number>(n).fill(NaN);
  let cursor = 0;
  for (const su of update?.stops ?? []) {
    const i = stopIndex(trip, su, cursor);
    if (i < 0) continue;
    cursor = i;
    if (su.skipped) continue;
    const a = delayOf(su.arrival, schedArr[i]), d = delayOf(su.departure, schedDep[i]);
    dArr[i] = a ?? d ?? NaN;
    dDep[i] = d ?? a ?? NaN;
  }

  // Carry a known delay forward to the stops it does not mention; before the first mention, use the first.
  const known = dDep.findIndex((x) => !Number.isNaN(x));
  const first = known >= 0 ? dArr[known] : 0;
  let carry = first;
  const delay = new Array<number>(n);
  const arr = new Array<number>(n), dep = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = Number.isNaN(dArr[i]) ? carry : dArr[i];
    const d = Number.isNaN(dDep[i]) ? a : dDep[i];
    carry = d;
    arr[i] = schedArr[i] + a;
    dep[i] = Math.max(schedDep[i] + d, arr[i]);
    delay[i] = dep[i] - schedDep[i];
    // A bus cannot reach a stop before it left the one before.
    if (i > 0 && arr[i] < dep[i - 1]) { arr[i] = dep[i - 1]; dep[i] = Math.max(dep[i], arr[i]); delay[i] = dep[i] - schedDep[i]; }
  }
  return { arr, dep, delay, live: known >= 0 };
}

function delayOf(e: { time?: number; delay?: number } | undefined, scheduled: number): number | undefined {
  if (!e) return undefined;
  if (e.time !== undefined && e.time > 0) return e.time - scheduled;
  return e.delay;
}

function stopIndex(trip: Trip, su: StopUpdate, from: number): number {
  const p = trip.pattern;
  if (su.sequence !== undefined) {
    const i = p.seq.indexOf(su.sequence);
    if (i >= 0) return i;
  }
  if (su.stopId) {
    for (let i = from; i < p.stops.length; i++) if (p.stops[i] === su.stopId) return i;
  }
  return -1;
}

/** Where `trip` is at `nowMs` on service day `date`, or null while it is not on the road. */
export function busAt(tt: Timetable, trip: Trip, date: string, nowMs: number, update?: TripUpdate): Bus | null {
  if (update?.canceled) return null;
  if (!update) { // on schedule: most trips are not on the road, and that is cheap to see without building the times
    const base = osloEpoch(date, trip.start) / 1000, arr = trip.pattern.arr;
    if (nowMs / 1000 < base + trip.pattern.dep[0] || nowMs / 1000 > base + arr[arr.length - 1]) return null;
  }
  const e = expectedTimes(trip, date, update);
  const t = nowMs / 1000;
  const n = trip.pattern.stops.length;
  if (t < e.dep[0] || t > e.arr[n - 1]) return null;

  let i = 0; // the last stop whose departure has passed
  while (i < n - 2 && e.dep[i + 1] <= t) i++;
  const dist = trip.pattern.dist;
  let at: number, atStop: boolean, speed = 0;
  const next = i + 1;
  if (t < e.arr[i + 1]) {
    const span = e.arr[i + 1] - e.dep[i];
    const f = span > 0 ? (t - e.dep[i]) / span : 1;
    at = dist[i] + (dist[i + 1] - dist[i]) * f;
    atStop = false;
    if (span > 0) speed = (dist[i + 1] - dist[i]) / span;
  } else {
    at = dist[i + 1];
    atStop = true;
  }
  const shape = tt.shapes.get(trip.pattern.shape)!;
  const place = placeOnShape(shape, at);
  const line = tt.file.lines[trip.pattern.line];
  return {
    id: `${trip.id.slice(trip.id.lastIndexOf(':') + 1)}-${date}`,
    line: line.name,
    direction: trip.pattern.direction,
    headsign: trip.pattern.headsign,
    lat: round5(place.lat), lon: round5(place.lon), bearing: Math.round(place.bearing),
    delay: Math.round(e.delay[atStop ? next : i]),
    atStop, live: e.live,
    next: tt.file.stops[trip.pattern.stops[next]]?.[0] ?? '',
    shape: trip.pattern.shape,
    dist: Math.round(at), speed: Math.round(speed * 10) / 10, until: dist[next],
  };
}

const round5 = (x: number) => Math.round(x * 1e5) / 1e5;
