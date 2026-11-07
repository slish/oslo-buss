// The delay map: how late a bus is, as a color and as a summary. Pure functions, no three.js, so they can be tested.

/** The color of a bus we have no measured delay for: dimmed grey, neither green nor red. */
export const UNKNOWN_COLOR = '#6b7488';
/** Buses this much ahead of the timetable (seconds) get the early tone. */
export const EARLY_FROM = -60;
/** The delay (seconds) from which a bus counts as clearly late in the summary. */
export const LATE_LIMIT = 180;

// Color stops: seconds of delay -> color. Between two stops the color is mixed in RGB.
const STOPS: readonly (readonly [number, string])[] = [
  [-60, '#4da3ff'], // early: blue
  [0, '#3ddc84'],   // on time: green
  [60, '#3ddc84'],  // up to a minute late still counts as on time
  [150, '#ffd23f'], // 2-3 min: yellow
  [300, '#ff9a2e'], // 5 min: orange
  [600, '#ff3b30'], // 10+ min: red
];

const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

/** The color (#rrggbb) for a delay in seconds. Early buses are blue, 10+ minutes late is red. Without measured data (`live` false) it is grey. */
export function delayColor(delay: number, live: boolean): string {
  if (!live || !Number.isFinite(delay)) return UNKNOWN_COLOR;
  if (delay <= STOPS[0][0]) return STOPS[0][1];
  const last = STOPS[STOPS.length - 1];
  if (delay >= last[0]) return last[1];
  for (let i = 1; i < STOPS.length; i++) {
    const [d1, c1] = STOPS[i];
    if (delay > d1) continue;
    const [d0, c0] = STOPS[i - 1];
    const f = (delay - d0) / (d1 - d0), a = hex(c0), b = hex(c1);
    return '#' + a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('');
  }
  return last[1];
}

export interface DelaySummary {
  /** Buses with measured delay. */
  measured: number;
  /** All buses counted. */
  total: number;
  /** Measured buses at least `LATE_LIMIT` seconds late. */
  late: number;
  /** Mean delay in seconds over the measured buses, or null if none. */
  mean: number | null;
}

/** Summarizes buses by delay. Buses without measured delay count in `total` only. */
export function summarize(buses: Iterable<{ delay: number; live: boolean }>): DelaySummary {
  let total = 0, measured = 0, late = 0, sum = 0;
  for (const b of buses) {
    total++;
    if (!b.live) continue;
    measured++;
    sum += b.delay;
    if (b.delay >= LATE_LIMIT) late++;
  }
  return { measured, total, late, mean: measured ? sum / measured : null };
}

/** Delay in seconds as short Nynorsk text, e.g. "+4 min", "−2 min", "i rute". */
export function delayLabel(delay: number): string {
  if (delay >= 60) return `+${Math.round(delay / 60)} min`;
  if (delay <= -60) return `−${Math.round(-delay / 60)} min`;
  return 'i rute';
}
