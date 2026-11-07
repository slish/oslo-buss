import { describe, expect, it } from 'vitest';
import { MAX_DISTANCE, MIN_DISTANCE, cameraPosition, zoomAbout } from '../src/web/mapcamera';

const view = { x: 100, z: -200, distance: 1000, yaw: 0.7, elevation: 0.9 };

describe('zoomAbout', () => {
  it('keeps the distance from the camera to the zoomed point in proportion', () => {
    const p = { x: 400, z: 300 };
    const before = cameraPosition(view, 0);
    const after = cameraPosition(zoomAbout(view, p.x, p.z, 0.5), 0);
    // The whole rig is scaled about the point on the ground, so the camera ends up half as far from it.
    expect(Math.hypot(after.x - p.x, after.y, after.z - p.z)).toBeCloseTo(0.5 * Math.hypot(before.x - p.x, before.y, before.z - p.z), 6);
  });

  it('can always go on zooming in: the focus moves, so there is no fixed target to run out of', () => {
    let v = view;
    for (let i = 0; i < 40; i++) v = zoomAbout(v, 500, 500, 0.7);
    expect(v.distance).toBe(MIN_DISTANCE);
    expect(Math.hypot(v.x - 500, v.z - 500)).toBeLessThan(5);
  });

  it('zooms back out after being all the way in, to the same limits', () => {
    let v = view;
    for (let i = 0; i < 40; i++) v = zoomAbout(v, 500, 500, 0.7);
    for (let i = 0; i < 80; i++) v = zoomAbout(v, 500, 500, 1.5);
    expect(v.distance).toBe(MAX_DISTANCE);
    v = zoomAbout(v, 500, 500, 0.5);
    expect(v.distance).toBeCloseTo(MAX_DISTANCE / 2, 6);
  });
});
