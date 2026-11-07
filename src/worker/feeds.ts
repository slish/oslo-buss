// The feeds' Durable Object: one place in the world that asks Entur, however many players and data centers there are.
// It holds the timetable (read from the `data` branch that the daily GitHub Action writes) and the bus feed, and answers
// GET /feeds/buses and GET /data/timetable.json. The timetable is also kept (gzipped) in the object's own storage, so that a
// cold start after the object was evicted does not have to read it from GitHub again. Entur sees one request every 15 s, and only while someone asks.

import { DurableObject } from 'cloudflare:workers';
import { BusFeed } from '../relay/buses';
import { Timetable, type TimetableFile } from '../shared/timetable';
import { pack, unpack } from './pack';

export interface Env {
  FEEDS: DurableObjectNamespace<Feeds>;
  ASSETS: Fetcher;
  /** Where the daily timetable lives. */
  TIMETABLE_URL: string;
}

/** The timetable is checked again this often (a cheap conditional request): the Action writes a new one every night. */
const TIMETABLE_TTL = 30 * 60 * 1000;
/** After a failed read, wait this long before trying again. */
const TIMETABLE_RETRY = 60 * 1000;

export class Feeds extends DurableObject<Env> {
  private json: string | null = null;
  private feed: BusFeed | null = null;
  private loadedAt = 0;
  private etag: string | null = null;
  private failedAt = 0;
  private loading: Promise<void> | null = null;

  private start(text: string, loadedAt: number): void {
    this.feed = new BusFeed(new Timetable(JSON.parse(text) as TimetableFile), { onError: (e) => console.warn('Entur:', String(e)) });
    this.json = text;
    this.loadedAt = loadedAt;
  }

  private async remember(extra: Record<string, unknown>): Promise<void> {
    await this.ctx.storage.put({ loadedAt: this.loadedAt, etag: this.etag, ...extra });
  }

  /** The copy in storage, if there is one: it is used even when old, until a fresh one has been read. */
  private async restore(): Promise<void> {
    try {
      const [bytes, at, etag] = await Promise.all([this.ctx.storage.get<Uint8Array>('timetable'), this.ctx.storage.get<number>('loadedAt'), this.ctx.storage.get<string>('etag')]);
      if (bytes && at) { this.start(await unpack(bytes), at); this.etag = etag ?? null; }
    } catch (e) {
      console.warn('Stored timetable not read:', String(e));
    }
  }

  private load(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        if (!this.json) await this.restore();
        const now = Date.now();
        if (this.json && now - this.loadedAt < TIMETABLE_TTL) return;
        if (now - this.failedAt < TIMETABLE_RETRY) return;
        try {
          const response = await fetch(this.env.TIMETABLE_URL, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'slish-oslo-buss', ...(this.json && this.etag ? { 'if-none-match': this.etag } : {}) } });
          if (response.status === 304) { this.loadedAt = Date.now(); await this.remember({}); return; }
          if (!response.ok) throw new Error(`timetable ${response.status}`);
          const text = await response.text();
          const bytes = await pack(text);
          this.start(text, Date.now());
          this.etag = response.headers.get('etag');
          await this.remember({ timetable: bytes });
        } catch (e) {
          this.failedAt = Date.now();
          console.warn('Timetable not read:', String(e));
        }
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
