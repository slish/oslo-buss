import { describe, expect, it } from 'vitest';
import { linesAt, lineInfo, nextDepartures } from '../src/shared/departures';
import { osloEpoch } from '../src/shared/time';
import { Timetable, type TimetableFile } from '../src/shared/timetable';

const file: TimetableFile = {
  version: 1, generated: '', lines: [{ id: 'RUT:Line:9', name: '9', long: 'A - C' }],
  stops: { A: ['A', 59.9, 10.7], B: ['B', 59.91, 10.7], C: ['C', 59.92, 10.7] },
  shapes: {},
  patterns: [{ line: 0, direction: 0, headsign: 'C', shape: 'S', stops: ['A', 'B', 'C'], seq: [1, 2, 3], dist: [0, 1112, 2224], arr: [0, 300, 600], dep: [0, 360, 600] }],
  services: [['20261106']],
  // Trips leaving A at 10:00, 10:20 and 11:00.
  trips: [['t1', 0, 10 * 3600, 0], ['t2', 0, 10 * 3600 + 1200, 0], ['t3', 0, 11 * 3600, 0]],
};
const tt = new Timetable(file);
const at = (secs: number) => osloEpoch('20261106', secs);

describe('departures', () => {
  it('lists the next departures from a stop, soonest first, with the stop-specific time', () => {
    const d = nextDepartures(tt, 'B', at(10 * 3600 + 400), new Map());
    expect(d.map((x) => x.at)).toEqual([at(10 * 3600 + 1200 + 360), at(11 * 3600 + 360)]); // t1 left B at 10:06
    expect(d[0].delay).toBeNull();
    expect(d[0].headsign).toBe('C');
  });

  it('adds the delay of a trip that is on the road', () => {
    const delays = new Map([['t2-20261106', 120]]);
    const [first] = nextDepartures(tt, 'B', at(10 * 3600 + 400), delays);
    expect(first.at).toBe(at(10 * 3600 + 1200 + 360 + 120));
    expect(first.scheduled).toBe(at(10 * 3600 + 1200 + 360));
    expect(first.delay).toBe(120);
  });

  it('has no departures from the last stop, and nothing for an unknown stop', () => {
    expect(nextDepartures(tt, 'C', at(9 * 3600), new Map())).toEqual([]);
    expect(nextDepartures(tt, 'X', at(9 * 3600), new Map())).toEqual([]);
  });

  it('knows which lines call at a stop', () => {
    expect(linesAt(tt, 'B')).toEqual(['9']);
    expect(linesAt(tt, 'X')).toEqual([]);
  });

  it('summarizes a line: trips today, first and last, and the next hour', () => {
    const info = lineInfo(tt, '9', at(10 * 3600 + 600))!;
    expect(info.trips).toBe(3);
    expect(info.first).toBe(at(10 * 3600));
    expect(info.last).toBe(at(11 * 3600 + 600));
    expect(info.nextHour).toBe(2); // 10:20 and 11:00 start within the hour
    expect(info.headsigns).toEqual(['C']);
    expect(lineInfo(tt, 'nope', 0)).toBeNull();
  });
});
