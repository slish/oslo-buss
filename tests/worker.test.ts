// The Worker and the feeds' Durable Object, without Cloudflare: the base class is a small stand-in, storage is a Map and fetch is a stub.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class { constructor(readonly ctx: unknown, readonly env: unknown) {} },
}));

const { Feeds } = await import('../src/worker/feeds');
const { forgetAll } = await import('../src/worker/memo');
const worker = (await import('../src/worker/index')).default;

const URL_TIMETABLE = 'https://example.test/timetable.json';
const NOW = Date.UTC(2026, 10, 14, 12);

const timetableText = (generated: string) => JSON.stringify({ version: 1, generated, lines: [], stops: {}, shapes: {}, patterns: [], services: [], trips: [] });

function storage() {
  const map = new Map<string, unknown>();
  return {
    map,
    get: async (key: string) => map.get(key),
    put: async (entries: Record<string, unknown>) => { for (const [k, v] of Object.entries(entries)) map.set(k, v); },
  };
}

type Store = ReturnType<typeof storage>;
const feedsOn = (store: Store) => new Feeds({ storage: store } as never, { FEEDS: null, ASSETS: null, TIMETABLE_URL: URL_TIMETABLE } as never);
const get = (path: string) => new Request('https://oslo-buss.test' + path);

/** What the stub answers for each address; a missing entry is a network error. */
let answers: Record<string, () => Response>;
let asked: { url: string; headers: Headers }[];

beforeEach(() => {
  forgetAll();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  asked = [];
  answers = {};
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, headers: new Headers(init?.headers) });
    const answer = answers[url];
    if (!answer) throw new Error('network down');
    return answer();
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ENTUR = 'https://api.entur.io/realtime/v1/gtfs-rt/trip-updates';
const json = async (r: Response) => r.json() as Promise<Record<string, any>>;

describe('Feeds: the timetable', () => {
  it('answers 503 on a cold start when GitHub cannot be read, and says so on /health', async () => {
    const feeds = feedsOn(storage());
    expect((await feeds.fetch(get('/feeds/buses'))).status).toBe(503);
    const health = await feeds.fetch(get('/health'));
    expect(health.status).toBe(503);
    expect((await json(health)).ok).toBe(false);
  });

  it('serves the timetable it read, and /health is fine while it is young', async () => {
    answers[URL_TIMETABLE] = () => new Response(timetableText(new Date(NOW - 3600_000).toISOString()), { headers: { etag: '"a"' } });
    const feeds = feedsOn(storage());
    const response = await feeds.fetch(get('/data/timetable.json'));
    expect(response.status).toBe(200);
    expect((await json(response)).version).toBe(1);
    const health = await feeds.fetch(get('/health'));
    expect(health.status).toBe(200);
    expect(await json(health)).toMatchObject({ ok: true, timetable: { loaded: true, ageHours: 1 } });
  });

  it('says 503 on /health when the nightly job has not run for more than a day and a half', async () => {
    answers[URL_TIMETABLE] = () => new Response(timetableText(new Date(NOW - 40 * 3600_000).toISOString()));
    const health = await feedsOn(storage()).fetch(get('/health'));
    expect(health.status).toBe(503);
    expect((await json(health)).timetable.ageHours).toBe(40);
  });

  it('asks again after half an hour with the ETag, and keeps its copy on 304', async () => {
    answers[URL_TIMETABLE] = () => new Response(timetableText(new Date(NOW).toISOString()), { headers: { etag: '"a"' } });
    const store = storage();
    const feeds = feedsOn(store);
    await feeds.fetch(get('/data/timetable.json'));
    await feeds.fetch(get('/data/timetable.json')); // within the half hour: nothing asked
    expect(asked.filter((a) => a.url === URL_TIMETABLE)).toHaveLength(1);

    answers[URL_TIMETABLE] = () => new Response(null, { status: 304 });
    vi.setSystemTime(NOW + 31 * 60_000);
    const again = await feeds.fetch(get('/data/timetable.json'));
    expect(again.status).toBe(200);
    const second = asked.filter((a) => a.url === URL_TIMETABLE)[1];
    expect(second.headers.get('if-none-match')).toBe('"a"');
    expect(store.map.get('loadedAt')).toBe(NOW + 31 * 60_000);
  });

  it('keeps the old copy when GitHub fails later, and waits a minute before trying again', async () => {
    answers[URL_TIMETABLE] = () => new Response(timetableText(new Date(NOW).toISOString()));
    const feeds = feedsOn(storage());
    await feeds.fetch(get('/data/timetable.json'));
    delete answers[URL_TIMETABLE];
    vi.setSystemTime(NOW + 31 * 60_000);
    expect((await feeds.fetch(get('/data/timetable.json'))).status).toBe(200);
    await feeds.fetch(get('/data/timetable.json'));
    expect(asked.filter((a) => a.url === URL_TIMETABLE)).toHaveLength(2); // the second failure was not asked again at once
  });

  it('restores the timetable from storage after the object was evicted, without GitHub', async () => {
    answers[URL_TIMETABLE] = () => new Response(timetableText(new Date(NOW).toISOString()), { headers: { etag: '"a"' } });
    const store = storage();
    await feedsOn(store).fetch(get('/data/timetable.json'));
    expect(store.map.has('timetable')).toBe(true);

    delete answers[URL_TIMETABLE];
    vi.setSystemTime(NOW + 2 * 3600_000);
    const response = await feedsOn(store).fetch(get('/data/timetable.json')); // a new object, the same storage
    expect(response.status).toBe(200);
    expect((await json(response)).version).toBe(1);
  });
});

describe('Feeds: the buses', () => {
  it('still answers when Entur fails, marked as stale', async () => {
    answers[URL_TIMETABLE] = () => new Response(timetableText(new Date(NOW).toISOString()));
    answers[ENTUR] = () => new Response('down', { status: 500 });
    const response = await feedsOn(storage()).fetch(get('/feeds/buses'));
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ stale: true, updatedAt: 0, buses: [] });
  });

  it('does not ask Entur for /health', async () => {
    answers[URL_TIMETABLE] = () => new Response(timetableText(new Date(NOW).toISOString()));
    await feedsOn(storage()).fetch(get('/health'));
    expect(asked.some((a) => a.url === ENTUR)).toBe(false);
  });

  it('answers 404 for a path it does not know', async () => {
    answers[URL_TIMETABLE] = () => new Response(timetableText(new Date(NOW).toISOString()));
    expect((await feedsOn(storage()).fetch(get('/nope'))).status).toBe(404);
  });
});

describe('the Worker', () => {
  const assets = vi.fn(async () => new Response('a static file'));
  const env = () => {
    answers[URL_TIMETABLE] = () => new Response(timetableText(new Date(NOW).toISOString()));
    const feeds = feedsOn(storage());
    return { ASSETS: { fetch: assets }, TIMETABLE_URL: URL_TIMETABLE, FEEDS: { idFromName: () => 'main', get: () => ({ fetch: (r: Request) => feeds.fetch(r) }) } } as never;
  };
  const ctx = {} as ExecutionContext;

  it('answers 405 to anything but GET and HEAD on the live paths', async () => {
    const response = await worker.fetch(new Request('https://oslo-buss.test/feeds/buses', { method: 'POST' }), env(), ctx);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('hands every other path to the static files, which is where a 404 comes from', async () => {
    const response = await worker.fetch(get('/finnes-ikkje'), env(), ctx);
    expect(await response.text()).toBe('a static file');
    expect(assets).toHaveBeenCalled();
  });

  it('opens the live paths to any page', async () => {
    const response = await worker.fetch(get('/health'), env(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('asks the object once for the buses within a few seconds, and again after that', async () => {
    const calls = vi.spyOn(Feeds.prototype, 'fetch');
    const e = env();
    answers[ENTUR] = () => new Response(new Uint8Array(), { status: 200 });
    await worker.fetch(get('/feeds/buses'), e, ctx);
    await worker.fetch(get('/feeds/buses'), e, ctx);
    expect(calls).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 5000);
    await worker.fetch(get('/feeds/buses'), e, ctx);
    expect(calls).toHaveBeenCalledTimes(2);
  });
});
