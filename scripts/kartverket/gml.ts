// Reading the big GML files from Geonorge without an XML library. The files are far bigger than a JavaScript string can
// be, so they are cut into one element per feature, and the few fields we need are picked out with regular expressions.
import { createReadStream } from 'node:fs';
import type { XY } from '../../src/shared/tiles';

/** Yields the inside of each `<tag>...</tag>` element, one feature at a time (`tag` is the member wrapper, e.g. gml:featureMember). */
export async function* members(file: string, tag: string): AsyncGenerator<string> {
  const open = `<${tag}>`, close = `</${tag}>`;
  let rest = '';
  const decoder = new TextDecoder('utf-8');
  for await (const chunk of createReadStream(file, { highWaterMark: 4 << 20 })) {
    rest += decoder.decode(chunk as Buffer, { stream: true });
    for (;;) {
      const a = rest.indexOf(open);
      if (a < 0) { rest = rest.slice(Math.max(0, rest.length - open.length)); break; }
      const b = rest.indexOf(close, a);
      if (b < 0) { rest = rest.slice(a); break; }
      yield rest.slice(a + open.length, b);
      rest = rest.slice(b + close.length);
    }
  }
}

/** The text of the first <name>…</name> in the feature (any namespace prefix). */
export function field(feature: string, name: string): string | undefined {
  return new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`).exec(feature)?.[1];
}

/** Numbers of a gml:posList as points; `dim` is 2 or 3 numbers per point (a third one is dropped). */
export function parsePosList(text: string, dim: number): XY[] {
  const nums = text.trim().split(/\s+/).map(Number);
  const out: XY[] = [];
  for (let i = 0; i + dim - 1 < nums.length; i += dim) out.push([nums[i], nums[i + 1]]);
  return out;
}

/** All rings of the surfaces in the feature; `outer` tells exterior rings from holes. */
export function surfaceRings(feature: string): { ring: XY[]; outer: boolean }[] {
  const out: { ring: XY[]; outer: boolean }[] = [];
  const re = /<gml:(exterior|interior)>\s*<gml:LinearRing[^>]*>\s*<gml:posList[^>]*>([^<]*)<\/gml:posList>/g;
  for (let m = re.exec(feature); m; m = re.exec(feature)) out.push({ ring: parsePosList(m[2], 2), outer: m[1] === 'exterior' });
  return out;
}

/** All gml:posList position lists in the feature (the lines of a LineString or curve). */
export function lineStrings(feature: string, dim: number): XY[][] {
  const out: XY[][] = [];
  const re = /<gml:posList[^>]*>([^<]*)<\/gml:posList>/g;
  for (let m = re.exec(feature); m; m = re.exec(feature)) out.push(parsePosList(m[1], dim));
  return out;
}
