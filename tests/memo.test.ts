import { beforeEach, describe, expect, it } from 'vitest';
import { forgetAll, remembered } from '../src/worker/memo';

beforeEach(forgetAll);

const ok = (text: string) => new Response(text, { headers: { 'content-type': 'application/json' } });

describe('remembered', () => {
  it('reuses an answer until it is old, then asks again', async () => {
    let now = 1000, made = 0;
    const make = async () => ok(String(++made));
    expect(await (await remembered('k', 4000, make, () => now)).text()).toBe('1');
    now += 3999;
    expect(await (await remembered('k', 4000, make, () => now)).text()).toBe('1');
    now += 2;
    expect(await (await remembered('k', 4000, make, () => now)).text()).toBe('2');
    expect(made).toBe(2);
  });

  it('keeps the headers and keeps keys apart', async () => {
    const a = await remembered('a', 1000, async () => ok('A'));
    expect(a.headers.get('content-type')).toBe('application/json');
    expect(await (await remembered('b', 1000, async () => ok('B'))).text()).toBe('B');
  });

  it('lets requests that come while it is being made share one request', async () => {
    let made = 0, release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const make = async () => { made++; await gate; return ok('x'); };
    const all = Promise.all([remembered('k', 1000, make), remembered('k', 1000, make), remembered('k', 1000, make)]);
    release();
    const bodies = await Promise.all((await all).map((r) => r.text()));
    expect(bodies).toEqual(['x', 'x', 'x']);
    expect(made).toBe(1);
  });

  it('does not keep a failure, and passes it on', async () => {
    let made = 0;
    const make = async () => (++made === 1 ? new Response('down', { status: 503 }) : ok('fine'));
    expect((await remembered('k', 1000, make)).status).toBe(503);
    expect(await (await remembered('k', 1000, make)).text()).toBe('fine');
    expect(made).toBe(2);
  });
});
