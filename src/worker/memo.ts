// A short memory in the Worker's isolate: the same answer for the same key for a few seconds, and one request to the source
// for everyone who asks while it is being made. The Cache API does not work on workers.dev, and this does everywhere. Isolates
// are many and short-lived, so this lowers the load on the source without promising anything: each isolate asks on its own.

interface Kept { at: number; status: number; headers: [string, string][]; body: string }

const kept = new Map<string, Kept>();
const making = new Map<string, Promise<Kept | null>>();

const answer = (k: Kept) => new Response(k.body, { status: k.status, headers: k.headers });

/** The answer for `key`, made by `make` when it is older than `ttlMs`. Only a 200 is kept; anything else is passed on and asked for again. */
export async function remembered(key: string, ttlMs: number, make: () => Promise<Response>, now: () => number = Date.now): Promise<Response> {
  const hit = kept.get(key);
  if (hit && now() - hit.at < ttlMs) return answer(hit);
  let pending = making.get(key);
  if (!pending) {
    let passed: Response | null = null;
    pending = make().then(async (response) => {
      if (response.status !== 200) { passed = response; return null; }
      const k: Kept = { at: now(), status: 200, headers: [...response.headers], body: await response.text() };
      kept.set(key, k);
      return k;
    }).finally(() => { making.delete(key); });
    making.set(key, pending);
    const k = await pending;
    return k ? answer(k) : passed!;
  }
  const k = await pending;
  // Someone else's request failed: this one asks for itself rather than copy a failure it did not see.
  return k ? answer(k) : make();
}

/** For tests. */
export function forgetAll(): void { kept.clear(); making.clear(); }
