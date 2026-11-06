// The feeds' Durable Object: one place in the world that asks Entur, however many players and data centers there are.
// It holds the timetable (read from the `data` branch that the daily GitHub Action writes) and the bus feed, and answers
// GET /feeds/buses and GET /data/timetable.json. Entur sees one request every 15 s, and only while someone asks.

import { DurableObject } from 'cloudflare:workers';
import { BusFeed } from '../relay/buses';
import { Timetable, type TimetableFile } from '../shared/timetable';

export interface Env {
  FEEDS: DurableObjectNamespace<Feeds>;
  ASSETS: Fetcher;
  /** Where the daily timetable lives. */
  TIMETABLE_URL: string;
}

/** The timetable is read again this often: the Action writes a new one every night. */
const TIMETABLE_TTL = 6 * 60 * 60 * 1000;
/** After a failed read, wait this long before trying again. */
const TIMETABLE_RETRY = 60 * 1000;

export class Feeds extends DurableObject<Env> {
  private json: string | null = null;
  private feed: BusFeed | null = null;
  private loadedAt = 0;
  private failedAt = 0;
  private loading: Promise<void> | null = null;

  private load(): Promise<void> {
    const now = Date.now();
    if (this.loading) return this.loading;
    if (this.json && now - this.loadedAt < TIMETABLE_TTL) return Promise.resolve();
    if (now - this.failedAt < TIMETABLE_RETRY) return Promise.resolve();
    this.loading = (async () => {
      try {
        const response = await fetch(this.env.TIMETABLE_URL, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'slish-oslo-buss' } });
        if (!response.ok) throw new Error(`timetable ${response.status}`);
        const text = await response.text();
        const timetable = new Timetable(JSON.parse(text) as TimetableFile);
        this.json = text;
        this.feed = new BusFeed(timetable, { onError: (e) => console.warn('Entur:', String(e)) });
        this.loadedAt = Date.now();
      } catch (e) {
        this.failedAt = Date.now();
        console.warn('Timetable not read:', String(e));
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    await this.load();
    if (!this.json || !this.feed) return reply({ error: 'Tidstabellen er ikkje tilgjengeleg enno' }, 503, 5);
    if (path === '/data/timetable.json') return new Response(this.json, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    if (path === '/feeds/buses') return reply(await this.feed.get(), 200, 10);
    return new Response('Not found', { status: 404 });
  }
}

function reply(body: unknown, status: number, maxAge: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${maxAge}` } });
}
