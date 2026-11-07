// Measures what a set of lines costs: timetable size, and the CPU time of one Durable Object refresh (parse the Entur
// feed + place the buses). Uses the cached data-cache/rut.zip and one live fetch of the feed.
//   npx tsx scripts/measure-lines.ts 20 31 63
import { gzipSync } from 'node:zlib';
import { build } from './build-timetable';
import { Timetable } from '../src/shared/timetable';
import { TRIP_PREFIX } from '../src/shared/timetable';
import { parseTripUpdates } from '../src/shared/protobuf';
import { computeBuses, TRIP_UPDATES } from '../src/relay/buses';
import { CLIENT_NAME } from '../src/shared/client';

const lines = process.argv.slice(2);
if (!lines.length) throw new Error('Give the lines, e.g. 20 31 63');
const file = await build(lines);
const json = JSON.stringify(file);
const t0 = process.hrtime.bigint();
const tt = new Timetable(JSON.parse(json));
const loadMs = Number(process.hrtime.bigint() - t0) / 1e6;

const res = await fetch(TRIP_UPDATES, { headers: { 'ET-Client-Name': CLIENT_NAME, 'accept-encoding': 'gzip' } });
const bytes = new Uint8Array(await res.arrayBuffer());

const cpu = <T>(fn: () => T, n = 30): { ms: number; out: T } => {
  let out!: T;
  for (let i = 0; i < 5; i++) out = fn(); // warm up the JIT
  const s = process.cpuUsage();
  for (let i = 0; i < n; i++) out = fn();
  const u = process.cpuUsage(s);
  return { ms: (u.user + u.system) / 1000 / n, out };
};
const parse = cpu(() => new Map(parseTripUpdates(bytes, (id) => tt.byId.has(id), TRIP_PREFIX).map((u) => [u.tripId, u])));
const place = cpu(() => computeBuses(tt, parse.out, Date.now()));
console.log(JSON.stringify({
  lines: lines.length, trips: file.trips.length, timetableKB: Math.round(json.length / 1024), gzipKB: Math.round(gzipSync(json).length / 1024),
  loadMs: Math.round(loadMs), feedMB: +(bytes.length / 1e6).toFixed(1), updatesKept: parse.out.size, buses: place.out.length,
  parseMs: +parse.ms.toFixed(1), placeMs: +place.ms.toFixed(1), refreshMs: +(parse.ms + place.ms).toFixed(1),
}));
