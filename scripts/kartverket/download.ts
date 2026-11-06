// Downloads the open Kartverket datasets for Oslo and Bærum into data-cache/kartverket/ (gitignored).
// Safe to run again: finished files are skipped, partial ones are resumed. One download at a time, with a pause between.
// Usage: npx tsx scripts/kartverket/download.ts [--dir <folder>] [--only n50,nvdb,bygningspunkt,dtm,dom]
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const API = 'https://nedlasting.geonorge.no/api';
const MUNICIPALITIES = [{ code: '0301', name: 'Oslo' }, { code: '3201', name: 'Bærum' }];
const PAUSE_MS = 2000;
/** Budget guard: the user allowed 5 GB in total. */
const MAX_TOTAL_BYTES = 5 * 1024 ** 3;

export interface Dataset { key: string; uuid: string; label: string; projection: string; format: string }
export const DATASETS: Dataset[] = [
  { key: 'n50', uuid: 'ea192681-d039-42ec-b1bc-f3ce04c189ac', label: 'N50 Kartdata', projection: '25832', format: 'GML' },
  { key: 'nvdb', uuid: '97e6a869-8dd4-4379-bf39-f7d7dbf94863', label: 'NVDB Vegnett Pluss', projection: '5973', format: 'GML' },
  { key: 'bygningspunkt', uuid: '24d7e9d1-87f6-45a0-b38e-3447f8d7f9a1', label: 'Matrikkelen - Bygningspunkt', projection: '25832', format: 'GML' },
];

/** The DTM comes from Kartverket's open WCS (national height model, 10 m grid), in blocks that stay small. */
export const WCS = 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25832';
export const DTM_BBOX = { minE: 566_000, minN: 6_612_000, maxE: 616_000, maxN: 6_672_000 }; // EPSG:25832, covers Oslo and Bærum
export const DTM_BLOCK = 10_000;
export const DTM_RES = 10;
/** The surface model (DOM, with buildings and trees) is fetched coarser, only to estimate building heights as DOM minus DTM. */
export const WCS_DOM = 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dom-nhm-25832';
export const DOM_RES = 4;

const args = process.argv.slice(2);
const argOf = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dir = argOf('--dir') ?? join(process.cwd(), 'data-cache', 'kartverket');
const only = argOf('--only')?.split(',');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UA = 'oslo-buss-fanprosjekt/0.1 (github.com/slish/oslo-buss; opne data)';

interface LogEntry { file: string; url: string; bytes: number; at: string; note?: string }
const logPath = () => join(dir, 'download-log.jsonl');
function log(e: LogEntry) { appendFileSync(logPath(), JSON.stringify(e) + '\n'); console.log(`${e.file}  ${(e.bytes / 1e6).toFixed(1)} MB`); }
function totalBytes(): number {
  if (!existsSync(logPath())) return 0;
  const seen = new Map<string, number>();
  for (const l of readFileSync(logPath(), 'utf8').split('\n').filter(Boolean)) { const e = JSON.parse(l) as LogEntry; seen.set(e.file, e.bytes); }
  return [...seen.values()].reduce((a, b) => a + b, 0);
}

async function fetchTo(url: string, file: string, init: RequestInit = {}): Promise<number> {
  let have = existsSync(file) ? statSync(file).size : 0;
  const head = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA }, ...init.method ? {} : {} }).catch(() => undefined);
  const size = Number(head?.headers.get('content-length') ?? 0);
  if (size && have === size) return have; // already complete
  if (size && totalBytes() + (size - have) > MAX_TOTAL_BYTES) throw new Error('5 GB budget would be exceeded, stopping');
  const resume = have > 0 && head?.headers.get('accept-ranges') === 'bytes' && size > have;
  if (!resume) have = 0;
  const res = await fetch(url, { headers: { 'user-agent': UA, ...(resume ? { range: `bytes=${have}-` } : {}) } });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file, { flags: resume ? 'a' : 'w' }));
  return statSync(file).size;
}

async function orderAndDownload(ds: Dataset, area: { code: string; name: string }) {
  const stem = `${ds.key}_${area.code}_${area.name}`;
  if (existsSync(join(dir, `${stem}.done`))) { console.log(`skip ${stem}`); return; }
  const res = await fetch(`${API}/order`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({ email: '', orderLines: [{ metadataUuid: ds.uuid, areas: [{ code: area.code, type: 'kommune', name: area.name }], projections: [{ code: ds.projection }], formats: [{ name: ds.format }] }] }),
  });
  if (!res.ok) throw new Error(`order ${stem}: HTTP ${res.status} ${await res.text()}`);
  const order = (await res.json()) as { files: { downloadUrl: string; name: string; status: string }[] };
  for (const f of order.files) {
    if (f.status !== 'ReadyForDownload') throw new Error(`${f.name}: status ${f.status}`);
    const file = join(dir, f.name);
    const bytes = await fetchTo(f.downloadUrl, file);
    log({ file: f.name, url: f.downloadUrl, bytes, at: new Date().toISOString(), note: `${ds.label}, ${area.name}` });
    writeFileSync(join(dir, `${stem}.done`), f.name);
    await sleep(PAUSE_MS);
  }
}

async function downloadWcs(sub: string, wcs: string, coverage: string, res: number, note: string) {
  const out = join(dir, sub);
  mkdirSync(out, { recursive: true });
  for (let e = DTM_BBOX.minE; e < DTM_BBOX.maxE; e += DTM_BLOCK) {
    for (let n = DTM_BBOX.minN; n < DTM_BBOX.maxN; n += DTM_BLOCK) {
      const name = `${sub}_${e}_${n}.tif`;
      const file = join(out, name);
      if (existsSync(file) && statSync(file).size > 1000) continue;
      if (totalBytes() + (DTM_BLOCK / res) ** 2 * 4 > MAX_TOTAL_BYTES) throw new Error('5 GB budget would be exceeded, stopping');
      const px = DTM_BLOCK / res;
      const url = `${wcs}?SERVICE=WCS&VERSION=1.0.0&REQUEST=GetCoverage&COVERAGE=${coverage}&CRS=EPSG:25832&BBOX=${e},${n},${e + DTM_BLOCK},${n + DTM_BLOCK}&WIDTH=${px}&HEIGHT=${px}&FORMAT=GeoTIFF`;
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1000) throw new Error(`${name}: unexpected answer ${buf.toString('utf8', 0, 200)}`);
      writeFileSync(file, buf);
      log({ file: `${sub}/${name}`, url, bytes: buf.length, at: new Date().toISOString(), note });
      await sleep(500);
    }
  }
}

async function main() {
  mkdirSync(dir, { recursive: true });
  for (const ds of DATASETS) {
    if (only && !only.includes(ds.key)) continue;
    for (const area of MUNICIPALITIES) await orderAndDownload(ds, area);
  }
  if (!only || only.includes('dtm')) await downloadWcs('dtm10', WCS, 'nhm_dtm_topo_25832', DTM_RES, 'DTM 10 m, WCS');
  if (!only || only.includes('dom')) await downloadWcs('dom4', WCS_DOM, 'nhm_dom_topo_25832', DOM_RES, 'DOM 4 m, WCS');
  console.log(`total ${(totalBytes() / 1e6).toFixed(1)} MB`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(e); process.exit(1); });
