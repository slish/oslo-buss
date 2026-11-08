import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT, RUN_SPEED, WALK_SPEED, lookBy, lookDirection, slide, startWalk, stepWalk } from '../src/web/walk';
import { footprintOf, insideAny, pointInRing } from '../src/shared/geom';
import type { Ground, WalkState } from '../src/web/walk';

const flat = () => 0;
const walkFor = (s: WalkState, seconds: number, input: { forward: number; strafe: number; run: boolean }, ground: Ground = flat, blocked?: (x: number, z: number) => boolean) => {
  for (let i = 0; i < seconds * 60; i++) s = stepWalk(s, input, 1 / 60, ground, blocked);
  return s;
};
const forward = { forward: 1, strafe: 0, run: false };

describe('stepWalk', () => {
  it('starts with the eyes 1.7 m over the ground', () => {
    expect(startWalk(0, 0, 0, () => 42).eyeY).toBeCloseTo(42 + EYE_HEIGHT);
  });

  it('walks north (negative z) at about 2 m/s when facing north', () => {
    const s = walkFor(startWalk(0, 0, 0, flat), 10, forward);
    expect(Math.abs(s.x)).toBeLessThan(1e-9);
    expect(-s.z / 10).toBeGreaterThan(WALK_SPEED * 0.9);
    expect(-s.z / 10).toBeLessThanOrEqual(WALK_SPEED);
  });

  it('runs at about 8 m/s', () => {
    const s = walkFor(startWalk(0, 0, 0, flat), 10, { ...forward, run: true });
    expect(-s.z / 10).toBeGreaterThan(RUN_SPEED * 0.9);
    expect(-s.z / 10).toBeLessThanOrEqual(RUN_SPEED);
  });

  it('goes the way it looks: east when yaw is a quarter turn, and strafes to the right', () => {
    const east = walkFor(startWalk(0, 0, Math.PI / 2, flat), 5, forward);
    expect(east.x).toBeGreaterThan(5);
    expect(Math.abs(east.z)).toBeLessThan(1e-6);
    const right = walkFor(startWalk(0, 0, 0, flat), 5, { forward: 0, strafe: 1, run: false });
    expect(right.x).toBeGreaterThan(5);
  });

  it('is no faster diagonally', () => {
    const s = walkFor(startWalk(0, 0, 0, flat), 10, { forward: 1, strafe: 1, run: false });
    expect(Math.hypot(s.x, s.z) / 10).toBeLessThanOrEqual(WALK_SPEED);
  });

  it('stops within a moment when the keys are let go', () => {
    let s = walkFor(startWalk(0, 0, 0, flat), 2, forward);
    s = walkFor(s, 1, { forward: 0, strafe: 0, run: false });
    const z = s.z;
    s = walkFor(s, 1, { forward: 0, strafe: 0, run: false });
    expect(s.z).toBeCloseTo(z, 3);
  });

  it('follows the ground up a slope without jumping', () => {
    const slope = (_x: number, z: number) => -z * 0.2; // rises toward the north
    let s = startWalk(0, 0, 0, slope);
    let last = s.eyeY, maxJump = 0;
    for (let i = 0; i < 600; i++) {
      s = stepWalk(s, forward, 1 / 60, slope);
      maxJump = Math.max(maxJump, Math.abs(s.eyeY - last));
      last = s.eyeY;
    }
    expect(maxJump).toBeLessThan(0.05);
    expect(s.eyeY).toBeGreaterThan(slope(s.x, s.z) + EYE_HEIGHT - 0.3);
    expect(s.eyeY).toBeLessThan(slope(s.x, s.z) + EYE_HEIGHT + 0.01);
  });

  it('smooths a step in the ground and settles at eye height', () => {
    const stair = (_x: number, z: number) => (z < -1 ? 1 : 0);
    let s = startWalk(0, 0, 0, stair);
    s = stepWalk(s, forward, 1 / 60, stair);
    const first = s.eyeY;
    s = walkFor(s, 3, { forward: 0, strafe: 0, run: false }, stair);
    expect(first).toBeLessThan(stair(0, -2) + EYE_HEIGHT);
    s = walkFor({ ...s, z: -5 }, 3, { forward: 0, strafe: 0, run: false }, stair);
    expect(s.eyeY).toBeCloseTo(1 + EYE_HEIGHT, 2);
  });

  it('is not shaken by one very slow frame', () => {
    const s = stepWalk({ ...startWalk(0, 0, 0, flat), vz: -WALK_SPEED }, forward, 5, flat);
    expect(-s.z).toBeLessThan(0.25 * RUN_SPEED);
  });
});

describe('lookBy', () => {
  it('turns right for a pointer moved right, and keeps the pitch short of the poles', () => {
    const s = startWalk(0, 0, 0, flat);
    expect(lookBy(s, 100, 0).yaw).toBeGreaterThan(0);
    expect(lookBy(s, 0, -100000).pitch).toBeLessThan(Math.PI / 2);
    expect(lookBy(s, 0, 100000).pitch).toBeGreaterThan(-Math.PI / 2);
    expect(lookBy(s, 0, -100).pitch).toBeGreaterThan(0); // up with the mouse up
  });

  it('keeps the yaw within a turn', () => {
    let s = startWalk(0, 0, 0, flat);
    for (let i = 0; i < 100; i++) s = lookBy(s, 500, 0);
    expect(Math.abs(s.yaw)).toBeLessThanOrEqual(Math.PI);
  });

  it('looks along a unit vector that faces north at yaw 0', () => {
    const [x, y, z] = lookDirection(startWalk(0, 0, 0, flat));
    expect(x).toBeCloseTo(0); expect(y).toBeCloseTo(0); expect(z).toBeCloseTo(-1);
  });
});

describe('buildings', () => {
  const square = [[10, -5], [20, -5], [20, 5], [10, 5]] as [number, number][];
  const blocked = (x: number, z: number) => insideAny(x, z, [footprintOf(square)]);

  it('knows inside from outside', () => {
    expect(pointInRing(15, 0, square)).toBe(true);
    expect(pointInRing(25, 0, square)).toBe(false);
    expect(pointInRing(15, 9, square)).toBe(false);
  });

  it('does not walk through a wall, and stops at it', () => {
    const s = walkFor(startWalk(0, 0, Math.PI / 2, flat), 20, forward, flat, blocked);
    expect(s.x).toBeLessThan(10);
    expect(s.x).toBeGreaterThan(9);
  });

  it('slides along a wall when walking at it on a slant', () => {
    const longWall = (x: number, z: number) => insideAny(x, z, [footprintOf([[10, -50], [20, -50], [20, 50], [10, 50]])]);
    const s = walkFor(startWalk(0, 0, Math.PI / 2 + 0.5, flat), 12, forward, flat, longWall);
    expect(s.x).toBeLessThan(10);
    expect(Math.abs(s.z)).toBeGreaterThan(3); // went on along the wall
  });

  it('lets someone who starts inside a building walk out of it', () => {
    const s = walkFor(startWalk(15, 0, Math.PI / 2, flat), 10, forward, flat, blocked);
    expect(s.x).toBeGreaterThan(21);
  });

  it('slide keeps the old place when blocked in both axes', () => {
    expect(slide(9.5, 0, 12, 0, blocked)).toEqual([9.5, 0]);
    expect(slide(0, 0, 3, 3, undefined)).toEqual([3, 3]);
  });
});
