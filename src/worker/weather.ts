// GET /feeds/weather: the weather over Oslo from MET Norway, for everyone, cached for half an hour so MET sees a request
// a few times an hour however many visit.

import { MET_URL, MET_USER_AGENT, reduceForecast } from '../shared/weather';

const MAX_AGE = 30 * 60;

export async function weather(request: Request, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const key = new Request(new URL('/feeds/weather', request.url).toString());
  const hit = await cache.match(key);
  if (hit) return hit;
  try {
    const response = await fetch(MET_URL, { headers: { 'user-agent': MET_USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`MET ${response.status}`);
    const reduced = reduceForecast(await response.json(), Date.now());
    if (!reduced) throw new Error('MET: unexpected answer');
    const out = new Response(JSON.stringify(reduced), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${MAX_AGE}` } });
    ctx.waitUntil(cache.put(key, out.clone()));
    return out;
  } catch (e) {
    console.warn('Weather not read:', String(e));
    return new Response(JSON.stringify({ error: 'Vêret er ikkje tilgjengeleg' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' } });
  }
}
