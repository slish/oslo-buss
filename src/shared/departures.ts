// What the timetable says about one stop or one line, for the info panel. Only the lines in the timetable are known:
// a stop shows the departures of those lines, not of everything that stops there.

import { osloEpoch } from './time';
import type { Timetable, Trip } from './timetable';

export interface Departure {
  line: string;
  headsign: string;
  /** Epoch ms: the scheduled time plus the delay we know of. */
  at: number;
  scheduled: number;
  /** Seconds late (negative: early), or null when the trip has not been seen on the road. */
  delay: number | null;
}

type Pattern = Trip['pattern'];
const indexes = new WeakMap<Timetable, Map<string, Map<Pattern, number[]>>>();

/** stop id -> the patterns that call there, with the positions in each. Built once per timetable. */
function stopIndex(tt: Timetable): Map<string, Map<Pattern, number[]>> {
  let index = indexes.get(tt);
  if (!index) {
    index = new Map();
    for (const pattern of tt.file.patterns) {
      pattern.stops.forEach((stop, i) => {
        if (i === pattern.stops.length - 1) return; // nobody gets on at the last stop
        let byPattern = index!.get(stop);
        if (!byPattern) index!.set(stop, (byPattern = new Map()));
        let list = byPattern.get(pattern);
        if (!list) byPattern.set(pattern, (list = []));
        list.push(i);
      });
    }
    indexes.set(tt, index);
  }
  return index;
}

/** The names of the lines that call at the stop. */
export function linesAt(tt: Timetable, stopId: string): string[] {
  const names = new Set<string>();
  for (const pattern of stopIndex(tt).get(stopId)?.keys() ?? []) names.add(tt.file.lines[pattern.line].name);
  return [...names];
}

/**
 * The next departures from a stop. `delays` maps a bus id (`<trip hash>-<service day>`) to its delay in seconds for the
 * trips that are on the road now.
 */
export function nextDepartures(tt: Timetable, stopId: string, nowMs: number, delays: Map<string, number>, limit = 8): Departure[] {
  const patterns = stopIndex(tt).get(stopId);
  if (!patterns) return [];
  const out: Departure[] = [];
  for (const date of tt.activeDates(nowMs)) {
    const base = osloEpoch(date, 0);
    for (const trip of tt.tripsOn(date)) {
      const at = patterns.get(trip.pattern);
      if (!at) continue;
      const id = `${trip.id.slice(trip.id.lastIndexOf(':') + 1)}-${date}`;
      const delay = delays.get(id) ?? null;
      for (const i of at) {
        const scheduled = base + (trip.start + trip.pattern.dep[i]) * 1000;
        const real = scheduled + (delay ?? 0) * 1000;
        if (real < nowMs - 30_000 || real > nowMs + 12 * 3_600_000) continue;
        out.push({ line: tt.file.lines[trip.pattern.line].name, headsign: trip.pattern.headsign, at: real, scheduled, delay });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, limit);
}

export interface LineInfo {
  name: string;
  long: string;
  headsigns: string[];
  /** Trips today (service day of now), with the first and last start as epoch ms. */
  trips: number;
  first: number | null;
  last: number | null;
  /** Trips that start in the next 60 minutes, in both directions. */
  nextHour: number;
}

export function lineInfo(tt: Timetable, name: string, nowMs: number): LineInfo | null {
  const index = tt.file.lines.findIndex((l) => l.name === name);
  if (index < 0) return null;
  const headsigns = new Set<string>();
  for (const p of tt.file.patterns) if (p.line === index) headsigns.add(p.headsign);
  let trips = 0, first: number | null = null, last: number | null = null, nextHour = 0;
  const [today] = tt.activeDates(nowMs);
  const base = osloEpoch(today, 0);
  for (const trip of tt.tripsOn(today)) {
    if (trip.pattern.line !== index) continue;
    const start = base + (trip.start + trip.pattern.dep[0]) * 1000;
    const end = base + (trip.start + trip.pattern.arr[trip.pattern.arr.length - 1]) * 1000;
    trips++;
    if (first === null || start < first) first = start;
    if (last === null || end > last) last = end;
    if (start >= nowMs && start < nowMs + 3_600_000) nextHour++;
  }
  return { name, long: tt.file.lines[index].long, headsigns: [...headsigns], trips, first, last, nextHour };
}
