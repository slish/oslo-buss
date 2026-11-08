// The Worker: serves the built page from its assets, and sends the two live paths to the feeds' Durable Object.
// Everything else is a static file and never reaches this code (wrangler.jsonc: run_worker_first).

import type { Env } from './feeds';
import { weather } from './weather';

export { Feeds } from './feeds';

const LIVE = new Set(['/feeds/buses', '/data/timetable.json']);

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
      return open(await weather(request, ctx));
    }
    if (!LIVE.has(url.pathname)) return env.ASSETS.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    // One object for everyone: it is what keeps Entur's load at one request every 15 s.
    return open(await env.FEEDS.get(env.FEEDS.idFromName('main')).fetch(request));
  },
} satisfies ExportedHandler<Env>;
