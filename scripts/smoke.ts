// Live check against Entur: loads the timetable, fetches TripUpdates and prints the buses on the road now.
//   npm run timetable && npm run smoke

import { readFileSync } from 'node:fs';
import { Timetable, type TimetableFile } from '../src/shared/timetable';
import { BusFeed } from '../src/relay/buses';

const tt = new Timetable(JSON.parse(readFileSync('public/data/timetable.json', 'utf8')) as TimetableFile);
const feed = new BusFeed(tt, { onError: (e) => console.error('ERROR', e) });
const t0 = Date.now();
const answer = await feed.get();
console.log(`Fetched in ${Date.now() - t0} ms, stale=${answer.stale}, updatedAt=${new Date(answer.updatedAt).toISOString()}`);
const byLine: Record<string, { n: number; live: number }> = {};
for (const b of answer.buses) {
  const l = (byLine[b.line] ??= { n: 0, live: 0 });
  l.n++; if (b.live) l.live++;
}
console.log('Buses by line (on the road / with live data):', byLine);
for (const b of answer.buses.slice(0, 12)) {
  console.log(`${b.line.padEnd(3)} -> ${b.headsign.padEnd(26)} ${b.lat.toFixed(5)},${b.lon.toFixed(5)} ${String(b.bearing).padStart(3)}°  delay ${String(b.delay).padStart(5)} s  ${b.atStop ? 'at' : 'to'} ${b.next}  ${b.live ? 'LIVE' : 'plan'}`);
}
