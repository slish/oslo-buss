// The Worker: serves the built page from its assets, and sends the live paths to the feeds' Durable Object.
// Everything else is a static file and never reaches this code (wrangler.jsonc: run_worker_first).

import type { Env } from './feeds';
import { remembered } from './memo';
import { weather } from './weather';

export { Feeds } from './feeds';

/** How long an isolate reuses an answer, ms: a little under the 15 s between Entur's updates; the weather is kept for half an hour. */
const BUSES_KEPT = 4000, WEATHER_KEPT = 30 * 60_000;

const LIVE = new Set(['/feeds/buses', '/data/timetable.json', '/health']);

/** The same response, readable from any page. */
function open(response: Response): Response {
  const out = new Response(response.body, response);
  out.headers.set('access-control-allow-origin', '*');
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/feeds/weather' && (request.method === 'GET' || request.method === 'HEAD')) {
      return open(request.method === 'GET' ? await remembered('weather', WEATHER_KEPT, () => weather(request, ctx)) : await weather(request, ctx));
    }
    if (!LIVE.has(url.pathname)) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    // One object for everyone: it is what keeps Entur's load at one request every 15 s.
    const feeds = () => env.FEEDS.get(env.FEEDS.idFromName('main')).fetch(request);
    return open(url.pathname === '/feeds/buses' && request.method === 'GET' ? await remembered('buses', BUSES_KEPT, feeds) : await feeds());
  },
} satisfies ExportedHandler<Env>;
