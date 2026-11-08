import { describe, expect, it } from 'vitest';
import { parseTripUpdates } from '../src/shared/protobuf';
import { busAt, expectedTimes, placeOnShape } from '../src/shared/position';
import { osloEpoch, osloTime, previousDate } from '../src/shared/time';
import { Timetable, type TimetableFile } from '../src/shared/timetable';
import { computeBuses, BusFeed } from '../src/relay/buses';
import { encodeShape, simplify, splitCsv } from '../scripts/build-timetable';

// ---- a tiny protobuf encoder, just enough for a TripUpdate feed ----
const varint = (n: number): number[] => {
  const out: number[] = [];
  let v = BigInt.asUintN(64, BigInt(n));
  while (v >= 0x80n) { out.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
  out.push(Number(v));
  return out;
};
const field = (n: number, wire: number, body: number[]) => [...varint(n * 8 + wire), ...body];
const bytes = (n: number, body: number[]) => field(n, 2, [...varint(body.length), ...body]);
const str = (n: number, s: string) => bytes(n, [...new TextEncoder().encode(s)]);
const event = (n: number, e: { delay?: number; time?: number }) => bytes(n, [...(e.delay !== undefined ? field(1, 0, varint(e.delay)) : []), ...(e.time !== undefined ? field(2, 0, varint(e.time)) : [])]);
const stopUpdate = (seq: number, stopId: string, arr?: { delay?: number; time?: number }, dep?: { delay?: number; time?: number }) =>
  bytes(2, [...field(1, 0, varint(seq)), ...(arr ? event(2, arr) : []), ...(dep ? event(3, dep) : []), ...str(4, stopId)]);
const entity = (id: string, trip: string, stops: number[][], canceled = false) =>
  bytes(2, [...str(1, id), ...bytes(3, [...bytes(1, [...str(1, trip), ...(canceled ? field(4, 0, varint(3)) : [])]), ...stops.flat()])]);
const feed = (...entities: number[][]) => new Uint8Array([...bytes(1, [...str(1, '1.0')]), ...entities.flat()]);

describe('protobuf', () => {
  it('reads trips and stops, skipping the entity id (regression: skip read the length after the position)', () => {
    const f = feed(
      entity('a', 'RUT:ServiceJourney:x', [stopUpdate(1, 'NSR:Quay:1', undefined, { delay: 30 }), stopUpdate(2, 'NSR:Quay:2', { delay: -45 }, { delay: -45 })]),
      entity('b', 'RUT:ServiceJourney:y', [], true),
    );
    const u = parseTripUpdates(f);
    expect(u.map((x) => x.tripId)).toEqual(['RUT:ServiceJourney:x', 'RUT:ServiceJourney:y']);
    expect(u[0].stops[0]).toMatchObject({ sequence: 1, stopId: 'NSR:Quay:1', departure: { delay: 30 } });
    expect(u[0].stops[1].arrival).toEqual({ delay: -45 });
    expect(u[1].canceled).toBe(true);
  });
  it('keeps only wanted trips', () => {
    const f = feed(entity('a', 'A', []), entity('b', 'B', []));
    expect(parseTripUpdates(f, (id) => id === 'B').map((x) => x.tripId)).toEqual(['B']);
  });
  it('skips other operators by prefix without reading their stops', () => {
    const f = feed(
      entity('a', 'AKT:ServiceJourney:1', [stopUpdate(1, 'NSR:Quay:9', undefined, { delay: 5 })]),
      entity('b', 'RUT:ServiceJourney:2', [stopUpdate(1, 'NSR:Quay:1', undefined, { delay: 30 })]),
      entity('c', 'RU', []),
    );
    const u = parseTripUpdates(f, undefined, 'RUT:ServiceJourney:');
    expect(u.map((x) => x.tripId)).toEqual(['RUT:ServiceJourney:2']);
    expect(u[0].stops[0].departure).toEqual({ delay: 30 });
  });
  it('fails whole on a cut feed', () => {
    const f = feed(entity('a', 'RUT:ServiceJourney:x', [stopUpdate(1, 'NSR:Quay:1', undefined, { delay: 30 })]));
    expect(() => parseTripUpdates(f.slice(0, f.length - 3))).toThrow();
  });
});

describe('time', () => {
  it('reads Oslo local date and seconds', () => {
    // 2026-11-06 12:00:00 UTC is 13:00 in Oslo (CET).
    expect(osloTime(Date.UTC(2026, 10, 6, 12))).toEqual({ date: '20261106', secs: 13 * 3600 });
    // 2026-07-01 22:30 UTC is 00:30 on the 2nd in Oslo (CEST).
    expect(osloTime(Date.UTC(2026, 6, 1, 22, 30))).toEqual({ date: '20260702', secs: 1800 });
  });
  it('turns GTFS time into epoch, also past 24 hours', () => {
    expect(osloEpoch('20261106', 13 * 3600)).toBe(Date.UTC(2026, 10, 6, 12));
    expect(osloEpoch('20261106', 25 * 3600)).toBe(Date.UTC(2026, 10, 7, 0));
  });
  it('counts GTFS time from noon minus 12 h on the day the clocks change', () => {
    // 2026-03-29: 02:00 CET became 03:00 CEST. Noon is 10:00 UTC, so GTFS "00:00" is 22:00 UTC the evening before
    // (23:00 local), and from 04:00 on GTFS time and the wall clock agree.
    expect(osloEpoch('20260329', 0)).toBe(Date.UTC(2026, 2, 28, 22, 0));
    expect(osloEpoch('20260329', 4 * 3600)).toBe(Date.UTC(2026, 2, 29, 2, 0));
    expect(osloTime(osloEpoch('20260329', 4 * 3600)).secs).toBe(4 * 3600);
  });
  it('knows the day before', () => {
    expect(previousDate('20260301')).toBe('20260228');
    expect(previousDate('20270101')).toBe('20261231');
  });
});

// ---- a small timetable: a straight road, one trip with three stops, 10:00 on 6 November 2026 ----
const file: TimetableFile = {
  version: 1, generated: '', lines: [{ id: 'RUT:Line:9', name: '9', long: 'A - C' }],
  stops: { A: ['A', 59.9, 10.7], B: ['B', 59.91, 10.7], C: ['C', 59.92, 10.7] },
  // Three points 0 / 1112 / 2224 m up the road, as deltas.
  shapes: { S: encodeShape([{ lat: 59.9, lon: 10.7, dist: 0 }, { lat: 59.91, lon: 10.7, dist: 1112 }, { lat: 59.92, lon: 10.7, dist: 2224 }]) },
  patterns: [{ line: 0, direction: 0, headsign: 'C', shape: 'S', stops: ['A', 'B', 'C'], seq: [1, 2, 3], dist: [0, 1112, 2224], arr: [0, 300, 600], dep: [0, 360, 600] }],
  services: [['20261106']],
  trips: [['t1', 0, 10 * 3600, 0]],
};
const tt = new Timetable(file);
const trip = tt.byId.get('RUT:ServiceJourney:t1')!;
const at = (secs: number) => osloEpoch('20261106', secs);

describe('shapes', () => {
  it('round-trips through encoding and finds places and bearings', () => {
    const shape = tt.shapes.get('S')!;
    expect(shape.lat[2]).toBeCloseTo(59.92, 5);
    const mid = placeOnShape(shape, 556);
    expect(mid.lat).toBeCloseTo(59.905, 3);
    expect(mid.bearing).toBeCloseTo(0, 0); // due north
    expect(placeOnShape(shape, 99999).lat).toBeCloseTo(59.92, 5); // clamped to the end
  });
  it('simplifies a straight line to its ends but keeps a corner', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ lat: 59.9 + i * 1e-4, lon: 10.7, dist: i * 11 }));
    expect(simplify(line, 2)).toHaveLength(2);
    const corner = [...line, ...Array.from({ length: 50 }, (_, i) => ({ lat: 59.9049, lon: 10.7 + (i + 1) * 1e-4, dist: 550 + i * 6 }))];
    expect(simplify(corner, 2).length).toBeGreaterThanOrEqual(3);
  });
  it('splits csv with quotes', () => {
    expect(splitCsv('a,"b,c","d ""x"""')).toEqual(['a', 'b,c', 'd "x"']);
  });
});

describe('position', () => {
  it('tells the browser how to keep the bus moving: road, distance, speed and where it stops', () => {
    const moving = busAt(tt, trip, '20261106', at(10 * 3600 + 150))!; // halfway through the 300 s leg A -> B (1112 m)
    expect(moving).toMatchObject({ shape: 'S', dist: 556, until: 1112 });
    expect(moving.speed).toBeCloseTo(1112 / 300, 1);
    const standing = busAt(tt, trip, '20261106', at(10 * 3600 + 330))!;
    expect(standing).toMatchObject({ dist: 1112, speed: 0, until: 1112 });
    // What the browser does with it: the same place as the server's, a few seconds later.
    const later = placeOnShape(tt.shapes.get('S')!, moving.dist + moving.speed * 10);
    expect(later.lat).toBeGreaterThan(moving.lat);
  });
  it('follows the plain timetable without an update', () => {
    expect(busAt(tt, trip, '20261106', at(10 * 3600 - 1))).toBeNull();
    const b = busAt(tt, trip, '20261106', at(10 * 3600 + 150))!; // halfway A -> B
    expect(b.lat).toBeCloseTo(59.905, 3);
    expect(b).toMatchObject({ atStop: false, live: false, next: 'B', delay: 0, line: '9' });
    const s = busAt(tt, trip, '20261106', at(10 * 3600 + 330))!; // standing at B
    expect(s).toMatchObject({ atStop: true, next: 'B' });
    expect(s.lat).toBeCloseTo(59.91, 4);
    expect(busAt(tt, trip, '20261106', at(10 * 3600 + 601))).toBeNull();
  });
  it('is held back by a delay, and a delay carries on to later stops', () => {
    const update = { tripId: trip.id, canceled: false, stops: [{ skipped: false, sequence: 1, departure: { delay: 120 } }] };
    const e = expectedTimes(trip, '20261106', update);
    expect(e.live).toBe(true);
    expect(e.delay).toEqual([120, 120, 120]);
    expect(busAt(tt, trip, '20261106', at(10 * 3600 + 60), update)).toBeNull(); // not left yet
    const b = busAt(tt, trip, '20261106', at(10 * 3600 + 270), update)!; // 150 s into a 300 s leg
    expect(b.lat).toBeCloseTo(59.905, 3);
    expect(b.delay).toBe(120);
  });
  it('uses absolute times and matches stops by id when there is no sequence', () => {
    const update = { tripId: trip.id, canceled: false, stops: [{ skipped: false, stopId: 'B', arrival: { time: at(10 * 3600 + 400) / 1000 }, departure: { time: at(10 * 3600 + 460) / 1000 } }] };
    const e = expectedTimes(trip, '20261106', update);
    expect(e.delay[1]).toBe(100);
    expect(e.delay[2]).toBe(100);
    expect(e.delay[0]).toBe(100); // before the first mention, the first is used
  });
  it('never lets a bus arrive before it left the stop before', () => {
    const update = { tripId: trip.id, canceled: false, stops: [{ skipped: false, sequence: 1, departure: { delay: 500 } }, { skipped: false, sequence: 2, arrival: { delay: 0 }, departure: { delay: 0 } }] };
    const e = expectedTimes(trip, '20261106', update);
    for (let i = 1; i < 3; i++) expect(e.arr[i]).toBeGreaterThanOrEqual(e.dep[i - 1]);
  });
  it('drops a cancelled trip', () => {
    expect(busAt(tt, trip, '20261106', at(10 * 3600 + 150), { tripId: trip.id, canceled: true, stops: [] })).toBeNull();
  });
  it('is on the road on its service day only, and a trip past midnight belongs to the day before', () => {
    expect(computeBuses(tt, new Map(), at(10 * 3600 + 150))).toHaveLength(1);
    expect(computeBuses(tt, new Map(), at(10 * 3600 + 150) + 86_400_000)).toHaveLength(0);
    const late = new Timetable({ ...file, trips: [['late', 0, 23 * 3600 + 59 * 60, 0]] });
    // 00:02 on the 7th is 24:02 of the 6th: 3 minutes into the trip.
    const buses = computeBuses(late, new Map(), osloEpoch('20261107', 2 * 60));
    expect(buses).toHaveLength(1);
    expect(buses[0].id).toBe('late-20261106');
  });
});

describe('BusFeed', () => {
  const now = at(10 * 3600 + 150);
  const reply = (u: Uint8Array) => (async () => new Response(u as BodyInit)) as typeof fetch;
  it('shares one fetch inside the TTL and keeps the last copy when Entur fails', async () => {
    let calls = 0, fail = false, clock = now;
    const fetcher = (async () => {
      calls++;
      if (fail) return new Response('no', { status: 503 });
      return new Response(feed(entity("a", trip.id, [stopUpdate(1, "A", undefined, { delay: 120 })])) as BodyInit);
    }) as typeof fetch;
    const errors: unknown[] = [];
    const f = new BusFeed(tt, { fetcher, now: () => clock, onError: (e) => errors.push(e) });
    const [a, b] = await Promise.all([f.get(), f.get()]);
    expect(calls).toBe(1);
    expect(a.buses[0].delay).toBe(120);
    expect(b.stale).toBe(false);
    clock += 5_000; await f.get();
    expect(calls).toBe(1);
    fail = true; clock += 20_000;
    const kept = await f.get();
    expect(errors).toHaveLength(1);
    expect(kept.buses[0]?.live ?? true).toBe(true); // still the last copy
    clock += 5_000; await f.get();
    expect(calls).toBe(2); // the failure is not retried at once
  });
  it('places the buses once for the answers of the same two seconds', async () => {
    let clock = now;
    const f = new BusFeed(tt, { fetcher: reply(feed(entity('a', trip.id, [stopUpdate(1, 'A', undefined, { delay: 120 })]))), now: () => clock });
    const first = await f.get();
    clock += 1_000;
    expect(await f.get()).toBe(first);
    clock += 2_000;
    const later = await f.get();
    expect(later).not.toBe(first);
    expect(later.at).toBe(clock);
  });
  it('falls back to the plain timetable once the copy is too old', async () => {
    let clock = now;
    const ok = (async () => new Response(feed(entity("a", trip.id, [stopUpdate(1, "A", undefined, { delay: 120 })])) as BodyInit)) as typeof fetch;
    const f = new BusFeed(tt, { fetcher: ok, now: () => clock });
    await f.get();
    // Entur goes quiet for ten minutes.
    const dead = new BusFeed(tt, { fetcher: reply(new Uint8Array([0xff])), now: () => clock, onError: () => {} });
    clock += 10 * 60_000;
    const a = await dead.get();
    expect(a.stale).toBe(true);
    expect(a.buses.every((x) => !x.live)).toBe(true);
  });
});
