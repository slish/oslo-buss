// Builds public/data/timetable.json for the chosen lines from Entur's static GTFS for Ruter.
//
//   npm run timetable               (reuses data-cache/rut.zip if it is under 12 hours old)
//   npm run timetable -- --fresh    (downloads again)
//   npm run timetable -- 20 31 63   (other lines, by their number)
//
// The zip is 50 MB and stop_times.txt 180 MB unpacked, so every file is streamed and only the chosen lines are kept.

import { createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { parseGtfsTime } from '../src/shared/time';
import { TRIP_PREFIX, type TimetableFile } from '../src/shared/timetable';

export const GTFS_URL = 'https://storage.googleapis.com/marduk-production/outbound/gtfs/rb_rut-aggregated-gtfs.zip';
export const DEFAULT_LINES = ['20', '31', '63'];
const CACHE = 'data-cache/rut.zip';
const OUT = 'public/data/timetable.json';
/** Shapes are simplified to within this many meters of the original road geometry. */
const TOLERANCE = 2;

// ---- zip and csv ----

async function download(fresh: boolean): Promise<void> {
  mkdirSync('data-cache', { recursive: true });
  if (!fresh && existsSync(CACHE) && Date.now() - statSync(CACHE).mtimeMs < 12 * 3_600_000) return;
  console.log('Downloading', GTFS_URL);
  const response = await fetch(GTFS_URL, { headers: { 'ET-Client-Name': 'fanprosjekt-oslo-buss' } });
  if (!response.ok || !response.body) throw new Error(`Download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(CACHE));
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(path, { lazyEntries: true, autoClose: false }, (e, z) => (e || !z ? reject(e) : resolve(z))));
}

/** Rows of one file in the zip, as objects keyed by the header. Files must be read one at a time. */
async function* rows(zip: yauzl.ZipFile, name: string): AsyncGenerator<Record<string, string>> {
  const entry = await new Promise<yauzl.Entry>((resolve, reject) => {
    const onEntry = (e: yauzl.Entry) => {
      if (e.fileName !== name) return zip.readEntry();
      zip.off('entry', onEntry);
      zip.off('end', onEnd);
      resolve(e);
    };
    const onEnd = () => { zip.off('entry', onEntry); reject(new Error(`${name} is not in the zip`)); };
    zip.on('entry', onEntry);
    zip.once('end', onEnd);
    zip.readEntry();
  });
  const stream = await new Promise<Readable>((resolve, reject) => zip.openReadStream(entry, (e, s) => (e || !s ? reject(e) : resolve(s))));
  let header: string[] | null = null;
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line) continue;
    const cells = splitCsv(header ? line : line.replace(/^﻿/, ''));
    if (!header) { header = cells; continue; }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? '';
    yield row;
  }
}

export function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(',');
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

// ---- shapes ----

type P = { lat: number; lon: number; dist: number };

/** Douglas-Peucker in meters (equirectangular around the shape), keeping the first and last point. */
export function simplify<T extends P>(points: T[], tolerance: number): T[] {
  if (points.length < 3) return points;
  const k = Math.cos((points[0].lat * Math.PI) / 180);
  const x = (p: P) => p.lon * 111_320 * k, y = (p: P) => p.lat * 111_320;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = x(points[a]), ay = y(points[a]), dx = x(points[b]) - ax, dy = y(points[b]) - ay;
    const len = Math.hypot(dx, dy);
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const px = x(points[i]) - ax, py = y(points[i]) - ay;
      const d = len === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** [lat*1e5, lon*1e5, meters] per point, each as the difference from the one before. */
export function encodeShape(points: P[]): number[] {
  const out: number[] = [];
  let a = 0, b = 0, c = 0;
  for (const p of points) {
    const la = Math.round(p.lat * 1e5), lo = Math.round(p.lon * 1e5), di = Math.round(p.dist);
    out.push(la - a, lo - b, di - c);
    a = la; b = lo; c = di;
  }
  return out;
}

// ---- build ----

interface Call { stop: string; seq: number; arr: number; dep: number; dist: number }

export async function build(lineNumbers: string[], zipPath = CACHE): Promise<TimetableFile> {
  const wanted = new Set(lineNumbers);
  // One zip handle per file: yauzl reads entries in order and the files are needed in a different order.
  const read = async function* (name: string) {
    const zip = await openZip(zipPath);
    try { yield* rows(zip, name); } finally { zip.close(); }
  };

  const lines: TimetableFile['lines'] = [];
  const lineIndex = new Map<string, number>();
  for await (const r of read('routes.txt')) {
    if (r.route_id.startsWith('RUT:') && wanted.has(r.route_short_name) && !lineIndex.has(r.route_id)) {
      lineIndex.set(r.route_id, lines.length);
      lines.push({ id: r.route_id, name: r.route_short_name, long: r.route_long_name });
    }
  }
  if (!lines.length) throw new Error(`None of the lines ${lineNumbers.join(', ')} are in the feed`);

  const tripInfo = new Map<string, { line: number; direction: number; headsign: string; shape: string; service: string }>();
  for await (const r of read('trips.txt')) {
    const line = lineIndex.get(r.route_id);
    if (line !== undefined) tripInfo.set(r.trip_id, { line, direction: Number(r.direction_id || 0), headsign: r.trip_headsign, shape: r.shape_id, service: r.service_id });
  }

  const usedServices = new Set([...tripInfo.values()].map((t) => t.service));
  const serviceDates = new Map<string, Set<string>>();
  for await (const r of read('calendar_dates.txt')) {
    if (usedServices.has(r.service_id) && r.exception_type === '1') {
      let s = serviceDates.get(r.service_id);
      if (!s) serviceDates.set(r.service_id, (s = new Set()));
      s.add(r.date);
    }
  }

  const calls = new Map<string, Call[]>();
  for await (const r of read('stop_times.txt')) {
    if (!tripInfo.has(r.trip_id)) continue;
    let list = calls.get(r.trip_id);
    if (!list) calls.set(r.trip_id, (list = []));
    list.push({ stop: r.stop_id, seq: Number(r.stop_sequence), arr: parseGtfsTime(r.arrival_time), dep: parseGtfsTime(r.departure_time), dist: Number(r.shape_dist_traveled) });
  }

  const shapeIds = new Set([...tripInfo.values()].map((t) => t.shape));
  const rawShapes = new Map<string, (P & { seq: number })[]>();
  for await (const r of read('shapes.txt')) {
    if (!shapeIds.has(r.shape_id)) continue;
    let list = rawShapes.get(r.shape_id);
    if (!list) rawShapes.set(r.shape_id, (list = []));
    list.push({ seq: Number(r.shape_pt_sequence), lat: Number(r.shape_pt_lat), lon: Number(r.shape_pt_lon), dist: Number(r.shape_dist_traveled) });
  }
  const shapes: TimetableFile['shapes'] = {};
  for (const [id, pts] of rawShapes) shapes[id] = encodeShape(simplify(pts.sort((a, b) => a.seq - b.seq), TOLERANCE));

  const usedStops = new Set<string>();
  const patterns: TimetableFile['patterns'] = [];
  const patternIndex = new Map<string, number>();
  const services: string[][] = [];
  const serviceIndex = new Map<string, number>();
  const trips: TimetableFile['trips'] = [];
  let skipped = 0;

  for (const [tripId, info] of tripInfo) {
    const list = calls.get(tripId);
    const dates = serviceDates.get(info.service);
    if (!list || list.length < 2 || !dates || !shapes[info.shape]) { skipped++; continue; }
    list.sort((a, b) => a.seq - b.seq);
    const start = list[0].dep;
    const pattern = {
      line: info.line, direction: info.direction, headsign: info.headsign, shape: info.shape,
      stops: list.map((c) => c.stop), seq: list.map((c) => c.seq), dist: list.map((c) => Math.round(c.dist)),
      arr: list.map((c) => c.arr - start), dep: list.map((c) => c.dep - start),
    };
    const key = JSON.stringify(pattern);
    let p = patternIndex.get(key);
    if (p === undefined) { p = patterns.length; patterns.push(pattern); patternIndex.set(key, p); for (const c of list) usedStops.add(c.stop); }
    let s = serviceIndex.get(info.service);
    if (s === undefined) { s = services.length; services.push([...dates].sort()); serviceIndex.set(info.service, s); }
    trips.push([tripId.startsWith(TRIP_PREFIX) ? tripId.slice(TRIP_PREFIX.length) : tripId, p, start, s]);
  }

  const stops: TimetableFile['stops'] = {};
  for await (const r of read('stops.txt')) {
    if (usedStops.has(r.stop_id)) stops[r.stop_id] = [r.stop_name, Math.round(Number(r.stop_lat) * 1e5) / 1e5, Math.round(Number(r.stop_lon) * 1e5) / 1e5];
  }
  console.log(`${trips.length} trips (${skipped} skipped), ${patterns.length} patterns, ${Object.keys(shapes).length} shapes, ${Object.keys(stops).length} stops, ${services.length} service day lists`);
  return { version: 1, generated: new Date().toISOString(), lines, stops, shapes, patterns, services, trips };
}

if (process.argv[1]?.endsWith('build-timetable.ts')) {
  const args = process.argv.slice(2);
  const lines = args.filter((a) => !a.startsWith('--'));
  await download(args.includes('--fresh'));
  const file = await build(lines.length ? lines : DEFAULT_LINES);
  mkdirSync('public/data', { recursive: true });
  const json = JSON.stringify(file);
  writeFileSync(OUT, json);
  console.log(`Wrote ${OUT}: ${(json.length / 1024).toFixed(0)} kB`);
}
