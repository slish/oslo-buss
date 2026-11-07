import { describe, expect, it } from 'vitest';
import { pack, unpack } from '../src/worker/pack';
import { LazyShapes, Timetable } from '../src/shared/timetable';
import { encodeShape } from '../scripts/build-timetable';

describe('pack', () => {
  it('round-trips text, also big and with non-ASCII letters', async () => {
    const text = JSON.stringify({ stops: 'Skøyen – Galgeberg', rows: Array.from({ length: 20_000 }, (_, i) => [i, i * 2, 'Åsbråten']) });
    const bytes = await pack(text);
    expect(bytes.length).toBeLessThan(text.length / 3);
    expect(await unpack(bytes)).toBe(text);
  });
});

describe('LazyShapes', () => {
  const flat = {
    A: encodeShape([{ lat: 59.9, lon: 10.7, dist: 0 }, { lat: 59.91, lon: 10.7, dist: 1112 }]),
    B: encodeShape([{ lat: 60, lon: 11, dist: 0 }, { lat: 60.01, lon: 11, dist: 1112 }]),
  };
  it('reads like a Map and decodes once', () => {
    const shapes = new LazyShapes(flat);
    expect(shapes.has('A')).toBe(true);
    expect(shapes.has('C')).toBe(false);
    expect(shapes.get('C')).toBeUndefined();
    const a = shapes.get('A')!;
    expect(a.lat[1]).toBeCloseTo(59.91, 5);
    expect(shapes.get('A')).toBe(a);
    expect([...shapes].map(([id]) => id)).toEqual(['A', 'B']);
    expect([...shapes.values()].length).toBe(2);
    expect(shapes.size).toBe(2);
  });
  it('is what a Timetable offers', () => {
    const tt = new Timetable({ version: 1, generated: '', lines: [], stops: {}, shapes: flat, patterns: [], services: [], trips: [] });
    expect(tt.shapes.get('B')!.lon[0]).toBeCloseTo(11, 5);
  });
});
