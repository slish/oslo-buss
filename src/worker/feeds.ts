// The feeds' Durable Object: one place in the world that asks Entur, however many players and data centers there are.
// It holds the timetable (read from the `data` branch that the daily GitHub Action writes) and the bus feed, and answers
// GET /feeds/buses, GET /data/timetable.json and GET /health. The timetable is also kept (gzipped) in the object's own storage, so that a
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
/** The timetable is older than this when the Action has failed for more than a night: /health then says so. */
const TIMETABLE_MAX_AGE = 36 * 3600 * 1000;
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

  /** One reading at a time. `finally` runs after the promise is stored, also when nothing was awaited (a fresh copy in memory). */
  private load(): Promise<void> {
    if (this.loading) return this.loading;
    const run: Promise<void> = this.reload().finally(() => { if (this.loading === run) this.loading = null; });
    this.loading = run;
    return run;
  }

  private async reload(): Promise<void> {
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
  }

  /** For an uptime check: 200 when there is a fresh timetable, else 503. Asks Entur nothing, so a check every minute does not wake it. */
  private health(): Response {
    const generated = this.feed ? Date.parse(this.feed.tt.file.generated) : NaN;
    const ageHours = Number.isFinite(generated) ? Math.round((Date.now() - generated) / 360_000) / 10 : null;
    const timetable = this.json !== null && ageHours !== null && ageHours * 3600_000 < TIMETABLE_MAX_AGE;
    const body = { ok: timetable, timetable: { loaded: this.json !== null, generated: this.feed?.tt.file.generated ?? null, ageHours }, entur: { lastUpdate: this.feed?.lastUpdate || null } };
    return new Response(JSON.stringify(body), { status: timetable ? 200 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    await this.load();
    if (path === '/health') return this.health();
    if (!this.json || !this.feed) return reply({ error: 'Tidstabellen er ikkje tilgjengeleg enno' }, 503, 5);
    if (path === '/data/timetable.json') return new Response(this.json, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    if (path === '/feeds/buses') return reply(await this.feed.get(), 200, 10);
    return new Response('Not found', { status: 404 });
  }
}

function reply(body: unknown, status: number, maxAge: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${maxAge}` } });
}
