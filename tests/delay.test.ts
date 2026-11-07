import { describe, expect, it } from 'vitest';
import { LATE_LIMIT, UNKNOWN_COLOR, delayColor, delayLabel, summarize } from '../src/web/delay';

describe('delayColor', () => {
  it('is green on time and a little late, blue when early, red at 10+ min', () => {
    expect(delayColor(0, true)).toBe('#3ddc84');
    expect(delayColor(45, true)).toBe('#3ddc84');
    expect(delayColor(-120, true)).toBe('#4da3ff');
    expect(delayColor(600, true)).toBe('#ff3b30');
    expect(delayColor(3600, true)).toBe('#ff3b30');
  });
  it('goes through yellow at 2-3 min and orange at 5 min', () => {
    expect(delayColor(150, true)).toBe('#ffd23f');
    expect(delayColor(300, true)).toBe('#ff9a2e');
  });
  it('mixes between the stops', () => {
    expect(delayColor(105, true)).not.toBe('#3ddc84');
    expect(delayColor(105, true)).not.toBe('#ffd23f');
    expect(delayColor(105, true)).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('is grey without measured data, whatever the delay', () => {
    expect(delayColor(0, false)).toBe(UNKNOWN_COLOR);
    expect(delayColor(900, false)).toBe(UNKNOWN_COLOR);
    expect(delayColor(NaN, true)).toBe(UNKNOWN_COLOR);
  });
});

describe('summarize', () => {
  it('counts late buses among the measured only', () => {
    const s = summarize([
      { delay: 0, live: true }, { delay: LATE_LIMIT, live: true }, { delay: 600, live: true },
      { delay: 900, live: false },
    ]);
    expect(s).toEqual({ measured: 3, total: 4, late: 2, mean: 600 / 3 + LATE_LIMIT / 3 });
  });
  it('has no mean without measured buses', () => {
    expect(summarize([{ delay: 5, live: false }]).mean).toBeNull();
    expect(summarize([]).total).toBe(0);
  });
});

describe('delayLabel', () => {
  it('writes minutes, early and on time', () => {
    expect(delayLabel(250)).toBe('+4 min');
    expect(delayLabel(-130)).toBe('−2 min');
    expect(delayLabel(30)).toBe('i rute');
  });
});
