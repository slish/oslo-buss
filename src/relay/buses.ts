// The relay's bus feed: Entur's TripUpdates for the timetable's trips, turned into positions.
//
// Players never call Entur. The relay asks once per TTL for everyone, shares one fetch between concurrent requests,
// and keeps its last good answer for a while if Entur fails. Nothing here needs Node: it runs in a Worker too.

import { CLIENT_NAME } from '../shared/client';
import { parseTripUpdates, type TripUpdate } from '../shared/protobuf';
import { busAt, type Bus } from '../shared/position';
import type { Timetable } from '../shared/timetable';

export const TRIP_UPDATES = 'https://api.entur.io/realtime/v1/gtfs-rt/trip-updates';

/** The buses on the road at `nowMs` for the timetable's lines. Pure: takes the updates, fetches nothing. */
export function computeBuses(tt: Timetable, updates: Map<string, TripUpdate>, nowMs: number): Bus[] {
  const buses: Bus[] = [];
  for (const date of tt.activeDates(nowMs)) {
    for (const trip of tt.tripsOn(date)) {
      const bus = busAt(tt, trip, date, nowMs, updates.get(trip.id));
      if (bus) buses.push(bus);
    }
  }
  return buses;
}

export async function fetchTripUpdates(tt: Timetable, fetcher: typeof fetch = fetch): Promise<Map<string, TripUpdate>> {
  const response = await fetcher(TRIP_UPDATES, { headers: { 'ET-Client-Name': CLIENT_NAME, 'accept-encoding': 'gzip' }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Entur ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const map = new Map<string, TripUpdate>();
  // Only this timetable's trips are kept: the national feed is some 8 MB.
  for (const u of parseTripUpdates(bytes, (id) => tt.byId.has(id))) map.set(u.tripId, u);
  return map;
}

export interface BusAnswer {
  /** When the answer was made, epoch ms. */
  at: number;
  /** When Entur was last heard from, epoch ms (0 if never). */
  updatedAt: number;
  /** Whether the updates are older than the feed's keep time: the buses then follow the plain timetable. */
  stale: boolean;
  buses: Bus[];
}

export class BusFeed {
  private updates = new Map<string, TripUpdate>();
  private updatedAt = 0;
  private pending: Promise<void> | null = null;
  private failedAt = 0;

  constructor(
    readonly tt: Timetable,
    private readonly opts: { ttl?: number; keep?: number; retry?: number; fetcher?: typeof fetch; now?: () => number; onError?: (e: unknown) => void } = {},
  ) {}

  private get now() { return this.opts.now?.() ?? Date.now(); }

  /** Refreshes when the copy is older than the TTL, sharing one fetch. A failed fetch is not repeated for `retry` ms. */
  private refresh(): Promise<void> {
    const ttl = this.opts.ttl ?? 15_000, retry = this.opts.retry ?? 15_000;
    const now = this.now;
    if (this.pending) return this.pending;
    if (now - this.updatedAt < ttl || now - this.failedAt < retry) return Promise.resolve();
    this.pending = fetchTripUpdates(this.tt, this.opts.fetcher)
      .then((u) => { this.updates = u; this.updatedAt = this.now; })
      .catch((e) => { this.failedAt = this.now; this.opts.onError?.(e); })
      .finally(() => { this.pending = null; });
    return this.pending;
  }

  async get(): Promise<BusAnswer> {
    await this.refresh();
    const now = this.now;
    const stale = now - this.updatedAt > (this.opts.keep ?? 5 * 60_000);
    // Past the keep time the old delays are worth less than the plain timetable.
    const buses = computeBuses(this.tt, stale ? new Map() : this.updates, now);
    return { at: now, updatedAt: this.updatedAt, stale, buses };
  }
}
