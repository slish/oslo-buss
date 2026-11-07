// The map under the buses: roads as thin lines, buildings as dark blocks. Map data © OpenStreetMap contributors, ODbL.

import { BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, ShapeUtils, Vector2 } from 'three';
import { decodePoints, type MapFile } from '../shared/map';

/** Colour and opacity of each road class, from the big roads to the small streets. */
const ROAD_STYLE: { color: string; opacity: number }[] = [
  { color: '#4a64a0', opacity: 0.9 },
  { color: '#3f568c', opacity: 0.8 },
  { color: '#344a78', opacity: 0.7 },
  { color: '#2b3d64', opacity: 0.6 },
  { color: '#202f50', opacity: 0.5 },
];

export function buildRoads(map: MapFile): Group {
  const group = new Group();
  const perClass: number[][] = ROAD_STYLE.map(() => []);
  for (const road of map.roads) {
    const cls = road[0];
    const pts = decodePoints(road, 1);
    const out = perClass[cls] ?? perClass[perClass.length - 1];
    for (let i = 0; i + 1 < pts.length; i++) out.push(pts[i][0], -1, pts[i][1], pts[i + 1][0], -1, pts[i + 1][1]);
  }
  perClass.forEach((positions, cls) => {
    if (!positions.length) return;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    const lines = new LineSegments(geometry, new LineBasicMaterial({ color: ROAD_STYLE[cls].color, transparent: true, opacity: ROAD_STYLE[cls].opacity }));
    lines.frustumCulled = false;
    group.add(lines);
  });
  return group;
}

/** Light from the south-west: walls turned toward it are brighter. Directions are in the scene's x (east) and z (south). */
const SUN = { x: -0.55, z: 0.83 };

/** A building to extrude: an open ring in scene meters, a height, and the height of the ground it stands on. */
export interface Block { ring: [number, number][]; height: number; base?: number; /** A convex quad: the roof needs no triangulation. */ quad?: boolean }

/** One mesh with every building: walls shaded by the way they face, roofs lighter the taller the building is. */
export function buildBuildings(map: MapFile): Mesh {
  return extrudeBlocks(map.buildings.map((b) => ({ height: b[0] / 10, ring: decodePoints(b, 1) })));
}

export function extrudeBlocks(blocks: Block[]): Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const base = new Color('#22345c'), roofBase = new Color('#2d4474'), tmp = new Color();

  const vertex = (x: number, y: number, z: number, c: Color, k: number) => {
    positions.push(x, y, z);
    colors.push(c.r * k, c.g * k, c.b * k);
    return positions.length / 3 - 1;
  };

  for (const blk of blocks) {
    const ring = blk.ring, y0 = blk.base ?? 0, y1 = y0 + blk.height, height = blk.height;
    const n = ring.length;
    if (n < 3) continue;
    // Signed area tells which way the ring runs, so that "outward" is known for every wall.
    let area = 0;
    for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
    const sign = area >= 0 ? 1 : -1;
    const tall = Math.min(1, height / 60);

    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n];
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = (sign * dz) / len, nz = (-sign * dx) / len;
      const shade = 0.5 + 0.5 * Math.max(0, nx * SUN.x + nz * SUN.z) + 0.1 * tall;
      tmp.copy(base);
      const a = vertex(p[0], y0, p[1], tmp, shade * 0.55);
      const b2 = vertex(q[0], y0, q[1], tmp, shade * 0.55);
      const c = vertex(q[0], y1, q[1], tmp, shade);
      const d = vertex(p[0], y1, p[1], tmp, shade);
      indices.push(a, b2, c, a, c, d);
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
  geometry.setIndex(new BufferAttribute(positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices), 1));
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: 2 /* DoubleSide */ }));
  mesh.frustumCulled = false;
  return mesh;
}
