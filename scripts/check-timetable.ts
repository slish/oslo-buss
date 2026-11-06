// Checks a freshly built public/data/timetable.json before it is published: a download that parsed into something
// empty or old must never replace a good timetable.
//   npm run check-timetable

import { readFileSync } from 'node:fs';
import { Timetable, type TimetableFile } from '../src/shared/timetable';
import { osloTime } from '../src/shared/time';

const path = process.argv[2] ?? 'public/data/timetable.json';
const file = JSON.parse(readFileSync(path, 'utf8')) as TimetableFile;
const tt = new Timetable(file);
const problems: string[] = [];

if (file.version !== 1) problems.push(`unknown version ${file.version}`);
if (file.lines.length < 3) problems.push(`only ${file.lines.length} lines`);
if (file.trips.length < 500) problems.push(`only ${file.trips.length} trips`);
for (const [i, p] of file.patterns.entries()) {
  if (!tt.shapes.has(p.shape)) problems.push(`pattern ${i} has no shape ${p.shape}`);
  if (p.stops.some((s) => !file.stops[s])) problems.push(`pattern ${i} has an unknown stop`);
  if (p.dist.some((d, j) => j > 0 && d < p.dist[j - 1])) problems.push(`pattern ${i} runs backwards`);
}
// The timetable is used for as long as it has trips today, so it should reach a good way ahead.
const today = osloTime(Date.now()).date;
const daysAhead = (Date.parse(`${tt.lastDate().replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')}T00:00:00Z`) - Date.parse(`${today.replace(/(\d{4})(\d\d)(\d\d)/, '$1-$2-$3')}T00:00:00Z`)) / 86_400_000;
if (daysAhead < 5) problems.push(`covers only ${daysAhead} days ahead (last day ${tt.lastDate()})`);
if (tt.tripsOn(today).length < 100) problems.push(`only ${tt.tripsOn(today).length} trips today`);

if (problems.length) {
  console.error('Timetable rejected:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Timetable OK: ${file.trips.length} trips, ${file.patterns.length} patterns, ${tt.tripsOn(today).length} trips today, reaches ${tt.lastDate()} (${daysAhead} days ahead)`);
