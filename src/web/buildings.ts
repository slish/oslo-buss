// Buildings as blocks: one mesh with the walls (shaded by the way they face, with windows) and the roofs. The outlines come from the map tiles.

import { BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, ShapeUtils, Vector2 } from 'three';
import { across, roofHeight, roofParts, type RoofPlan } from '../shared/roof';
import { daylit } from './mapshader';

/** Light from the south-west: walls turned toward it are brighter. Directions are in the scene's x (east) and z (south). */
const SUN = { x: -0.55, z: 0.83 };

/** A building to extrude: an open ring in scene meters, a height, and the height of the ground it stands on. */
export interface Block {
  ring: [number, number][]; height: number; base?: number;
  /** A convex quad: the roof needs no triangulation. */
  quad?: boolean;
  /** A pitched roof; `height` is then the height of its top, and the eaves are lower. Without it the roof is flat. */
  roof?: RoofPlan | null;
}

/** One mesh with every building: walls shaded by the way they face, roofs lighter the taller the building is. */
export function extrudeBlocks(blocks: Block[]): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  /** Per vertex: the distance along the wall from the start of the ring (small numbers, so the windows do not swim), 1 for a wall and 0 for a roof, and a number for the building. */
  const wall: number[] = [];
  const indices: number[] = [];
  let seed = 0;
  const base = new Color('#22345c'), roofBase = new Color('#3b4a68'), tmp = new Color();

  const vertex = (x: number, y: number, z: number, c: Color, k: number, along = 0, isWall = 0) => {
    positions.push(x, y, z);
    wall.push(along, isWall, seed);
    colors.push(c.r * k, c.g * k, c.b * k);
    return positions.length / 3 - 1;
  };

  for (const blk of blocks) {
    const ring = blk.ring, y0 = blk.base ?? 0, height = blk.height, plan = blk.roof ?? null;
    const y1 = y0 + height - (plan?.rise ?? 0); // the eaves; the flat roof is at this height too
    const n = ring.length;
    if (n < 3) continue;
    // Signed area tells which way the ring runs, so that "outward" is known for every wall.
    let area = 0;
    for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
    const sign = area >= 0 ? 1 : -1;
    const tall = Math.min(1, height / 60);
    seed = (seed + 1) % 4096;
    let walked = 0;

    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = (sign * dz) / len, nz = (-sign * dx) / len;
      const shade = 0.5 + 0.5 * Math.max(0, nx * SUN.x + nz * SUN.z) + 0.1 * tall;
      tmp.copy(base);
      const wall4 = (x0: number, z0: number, h0: number, x1: number, z1: number, h1: number, s0: number, s1: number) => {
        const a = vertex(x0, y0, z0, tmp, shade * 0.55, s0, 1);
        const b2 = vertex(x1, y0, z1, tmp, shade * 0.55, s1, 1);
        const c = vertex(x1, y1 + h1, z1, tmp, shade, s1, 1);
        const d = vertex(x0, y1 + h0, z0, tmp, shade, s0, 1);
        indices.push(a, b2, c, a, c, d);
      };
      // The top of the wall follows the roof; a wall that crosses the ridge gets a point there (the gable).
      const hp = plan ? roofHeight(plan, p[0], p[1]) : 0, hq = plan ? roofHeight(plan, q[0], q[1]) : 0;
      const up = plan ? across(plan, p[0], p[1]) : 0, uq = plan ? across(plan, q[0], q[1]) : 0;
      if (plan?.kind === 'gabled' && up * uq < 0) {
        const f = up / (up - uq), mx = p[0] + f * dx, mz = p[1] + f * dz;
        wall4(p[0], p[1], hp, mx, mz, plan.rise, walked, walked + f * len);
        wall4(mx, mz, plan.rise, q[0], q[1], hq, walked + f * len, walked + len);
      } else wall4(p[0], p[1], hp, q[0], q[1], hq, walked, walked + len);
      walked += len;
    }

    if (plan) {
      // Each flat piece of the roof is cut at the ridge and the hips, so that those lines are made of vertices.
      for (const part of roofParts(ring, plan)) {
        if (part.ring.length < 3) continue;
        const sun = Math.max(0, part.nx * SUN.x + part.nz * SUN.z);
        const first = positions.length / 3;
        tmp.copy(roofBase);
        for (const pt of part.ring) vertex(pt[0], y1 + roofHeight(plan, pt[0], pt[1]), pt[1], tmp, 0.6 + 0.85 * sun + 0.3 * tall);
        for (const t of ShapeUtils.triangulateShape(part.ring.map((pt) => new Vector2(pt[0], pt[1])), [])) indices.push(first + t[0], first + t[1], first + t[2]);
      }
      continue;
    }
    const triangles = blk.quad ? [[0, 1, 2], [0, 2, 3]] : ShapeUtils.triangulateShape(ring.map((p) => new Vector2(p[0], p[1])), []);
    tmp.copy(roofBase);
    const first = positions.length / 3;
    for (const p of ring) vertex(p[0], y1, p[1], tmp, 0.9 + 0.5 * tall);
    for (const t of triangles) indices.push(first + t[0], first + t[1], first + t[2]);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setAttribute('wall', new BufferAttribute(new Float32Array(wall), 3));
  geometry.setIndex(new BufferAttribute(positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1));
  const mesh = new Mesh(geometry, daylit(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }), 'walls'));
  mesh.frustumCulled = false;
  return mesh;
}
