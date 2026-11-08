// A polite client for the public Overpass servers (OpenStreetMap data, ODbL), used by scripts/kartverket/osm.ts: three mirrors in turn, retries with growing waits, and a pause between requests for the caller to use.

import { CLIENT_NAME } from '../src/shared/client';

const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const AGENT = `${CLIENT_NAME}/1.0 (https://github.com/slish/oslo-buss)`;

/** Pause between two requests to the same servers, ms. */
export const PAUSE_MS = 3000;

/** A way as `out geom` gives it. */
export interface OsmWay { id: number; tags: Record<string, string>; geometry: { lat: number; lon: number }[] }

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function overpass(query: string, attempts = 9): Promise<OsmWay[]> {
  let wait = 5000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const server = SERVERS[attempt % SERVERS.length];
    try {
      const response = await fetch(server, {
        method: 'POST', headers: { 'user-agent': AGENT, 'content-type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(120_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { elements?: OsmWay[]; remark?: string };
        if (body.remark && /error|timed out|out of memory/i.test(body.remark)) throw new Error(body.remark);
        if (Array.isArray(body.elements)) return body.elements;
        throw new Error('no elements');
      }
      console.log(`  ${new URL(server).host} ${response.status}, tries again in ${wait / 1000} s`);
    } catch (e) {
      console.log(`  ${new URL(server).host}: ${e instanceof Error ? e.message : e}, tries again in ${wait / 1000} s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 60_000);
  }
  throw new Error('Overpass did not answer');
}
