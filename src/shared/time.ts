// Oslo local time. GTFS times are seconds after midnight of the service day in Europe/Oslo and may pass 24 h.

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Oslo', hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export interface OsloTime { date: string; secs: number }

function fields(epochMs: number) {
  const o: Record<string, number> = {};
  for (const p of parts.formatToParts(new Date(epochMs))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o;
}

/** Local date (YYYYMMDD) and seconds since local midnight. */
export function osloTime(epochMs: number): OsloTime {
  const f = fields(epochMs);
  return { date: `${f.year}${String(f.month).padStart(2, '0')}${String(f.day).padStart(2, '0')}`, secs: f.hour * 3600 + f.minute * 60 + f.second };
}

/**
 * Epoch ms of GTFS time `secs` on service day `date` (YYYYMMDD). GTFS counts from "noon minus 12 hours", so on the days
 * the clocks change a time such as 03:30 is still real elapsed time from that reference.
 */
export function osloEpoch(date: string, secs: number): number {
  let start = dayStart.get(date);
  if (start === undefined) {
    start = osloDayStart(date);
    if (dayStart.size > 16) dayStart.clear();
    dayStart.set(date, start);
  }
  return start + secs * 1000;
}

// The search for the day's noon formats dates, which is slow: once per day is enough.
const dayStart = new Map<string, number>();

function osloDayStart(date: string): number {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(4, 6)), d = Number(date.slice(6, 8));
  const noonAsUtc = Date.UTC(y, m - 1, d, 12);
  let noon = noonAsUtc;
  for (let i = 0; i < 3; i++) {
    const f = fields(noon);
    noon += noonAsUtc - Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  }
  return noon - 12 * 3_600_000;
}

/** The date before `date` (YYYYMMDD). */
export function previousDate(date: string): string {
  const t = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))) - 86_400_000;
  const d = new Date(t);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** "HH:MM:SS" (HH may pass 24) to seconds. */
export function parseGtfsTime(s: string): number {
  const [h, m, sec] = s.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(sec);
}
