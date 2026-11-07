// The map from Kartverket's open data (docs/KARTVERKET.md), drawn from the tiles in src/shared/tiles.ts.
// Behind ?kart=kartverket. Tiles are fetched and released around the camera; each tile becomes a few meshes.
// ?terreng=1 lifts roads and buildings onto the terrain model instead of drawing everything flat.
// Map data © Kartverket, CC BY 4.0.

import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, ShapeUtils, Vector2, Vector3,
  type Camera, type Material, type Object3D,
} from 'three';
import { decodeTile, TILE_SIZE, tileName, type Tile, type XY } from '../shared/tiles';
import { extrudeBlocks, type Block } from './basemap';
import { upsample2 } from '../shared/terrain';
import { rideColor, ASPHALT, GRAVEL, noise } from './terrainstyle';

const BASE = '/kartverket-tiles/';
const FINE = '/kartverket-tiles-fine/'; // terrain-only tiles at 10 m, fetched near the bus when riding (see build-fine-terrain.ts)
/** Typical widths in meters by road class (motorway ... residential, path, rail): the map has only the centre line. 0: no asphalt. */
const ROAD_WIDTH = [12, 8, 7, 6, 5, 2.4, 0];
const FINE_RADIUS = 600; // meters from the bus: tiles within this get the fine terrain
const FINE_KEEP = 1500; // ... and keep it until farther than this
/** Colours of the land cover classes (sea, water, farmland, marsh, forest, built, park): dim, the buses are the light. */
const AREA_COLORS = ['#0a1f44', '#0e2d5a', '#16231a', '#142a2a', '#0e2c1c', '#1c2438', '#12301f'];
/** Colour and opacity of the road classes (motorway ... residential, path, rail). */
const ROAD_STYLE = [
  { color: '#5b78c0', opacity: 0.95 }, { color: '#4a64a0', opacity: 0.9 }, { color: '#3f568c', opacity: 0.8 },
  { color: '#344a78', opacity: 0.7 }, { color: '#2b3d64', opacity: 0.55 }, { color: '#1c2a40', opacity: 0.4 }, { color: '#6a5a8c', opacity: 0.7 },
];
const POINT_SIZE = 8; // meters across: the register only has a point for most buildings
const FOUNDATION = 1.5; // meters the walls reach below the lowest ground (with ?terreng=1)
const NEAR = 6500; // from the camera, meters: buildings and small roads are drawn within this
const MAX_TILES = 90;
const MAX_FETCHES = 4;

interface Loaded {
  tile: Tile;
  group: Group;
  near: boolean;
  detail?: Object3D[];
  meshes: Object3D[];
  terrainMesh?: Mesh;
  /** The fine terrain (10 m, smoothed to 5 m), once it is there: heightAt reads it. */
  fine?: { n: number; step: number; heights: Float32Array };
  fineMesh?: Mesh;
  /** Asphalt laid on the fine terrain: while it is there the thin road lines of the tile are hidden. */
  asphalt?: Mesh;
  fineState?: 'loading' | 'ready';
}

export interface KartOptions { terrain: boolean }

export class KartverketMap {
  readonly group = new Group();
  private readonly index = new Set<string>();
  private readonly tiles = new Map<string, Loaded>();
  private readonly loading = new Set<string>();
  private readonly ready: Tile[] = [];
  private readonly materials: Material[] = [];
  private readonly areaMaterials = AREA_COLORS.map((c) => new MeshBasicMaterial({ color: c, depthTest: false, depthWrite: false, side: DoubleSide }));
  private readonly groundMaterial = new MeshBasicMaterial({ color: '#0b111c', depthTest: false, depthWrite: false, side: DoubleSide });
  private readonly roadMaterials = ROAD_STYLE.map((s) => new LineBasicMaterial({ color: s.color, transparent: true, opacity: s.opacity }));
  private checkedAt = 0;
  private ride = false;
  private readonly restyle: Loaded[] = [];
  private readonly fineReady: { l: Loaded; tile: Tile }[] = [];
  credit = '';
  /** Counts up whenever tiles come or go, for those who sample heightAt. */
  version = 0;
  stats = { loaded: 0, loading: 0, triangles: 0 };

  constructor(readonly options: KartOptions) {
    this.group.name = 'kartverket';
    this.materials.push(...this.areaMaterials, ...this.roadMaterials, this.groundMaterial);
  }

  async start(): Promise<void> {
    const r = await fetch(`${BASE}index.json`);
    if (!r.ok) throw new Error(`Fann ikkje ${BASE}index.json (${r.status}): køyr npm run kartverket:tiles`);
    const index = (await r.json()) as { tiles: Record<string, number>; credit: string };
    for (const name of Object.keys(index.tiles)) this.index.add(name);
    this.credit = index.credit;
  }

  /** Height of the terrain model at a scene point in meters; 0 where there is none or terrain is off. */
  heightAt(x: number, z: number): number {
    if (!this.options.terrain) return 0;
    const ix = Math.floor(x / TILE_SIZE), iz = Math.floor(z / TILE_SIZE);
    const loaded = this.tiles.get(tileName(ix, iz));
    const t = loaded?.fine ?? loaded?.tile.terrain;
    if (!t) return 0;
    const fx = Math.min(t.n - 1.0001, Math.max(0, (x - ix * TILE_SIZE) / t.step)), fz = Math.min(t.n - 1.0001, Math.max(0, (z - iz * TILE_SIZE) / t.step));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const h = (a: number, b: number) => t.heights[b * t.n + a];
    return ((h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - tz) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * tz) / 10;
  }

  /**
   * Seen from the seat of a bus the terrain gets another palette with variation and rock, and the tiles around the bus get the
   * fine terrain. Set it with true when the ride begins and false when it ends.
   */
  setRide(on: boolean): void {
    if (on === this.ride) return;
    this.ride = on;
    this.restyle.length = 0;
    for (const l of this.tiles.values()) {
      if (!on) this.dropFine(l);
      if (l.terrainMesh) this.restyle.push(l);
    }
  }

  private dropFine(l: Loaded): void {
    if (l.fineMesh) {
      l.group.remove(l.fineMesh);
      l.fineMesh.geometry.dispose();
      l.meshes.splice(l.meshes.indexOf(l.fineMesh), 1);
      l.fineMesh = undefined;
    }
    if (l.asphalt) {
      l.group.remove(l.asphalt);
      l.asphalt.geometry.dispose();
      l.meshes.splice(l.meshes.indexOf(l.asphalt), 1);
      l.asphalt = undefined;
      this.syncRoadLines(l);
    }
    if (l.fine) { l.fine = undefined; this.version++; }
    l.fineState = undefined;
    if (l.terrainMesh) l.terrainMesh.visible = true;
  }

  private async fetchFine(name: string, l: Loaded): Promise<void> {
    l.fineState = 'loading';
    try {
      const r = await fetch(FINE + name);
      if (!r.ok) throw new Error(String(r.status));
      this.fineReady.push({ l, tile: decodeTile(new Uint8Array(await r.arrayBuffer())) });
    } catch (e) {
      console.warn('Kunne ikkje laste fint terreng', name, e);
      l.fineState = 'ready'; // do not try again
    }
  }

  /** Builds the fine terrain of a tile: 10 m samples made smooth at 5 m, with the same land cover colours at 10 m. */
  private buildFine(l: Loaded, tile: Tile): void {
    const t = tile.terrain;
    if (!this.ride || !t || !this.tiles.has(tileName(l.tile.ix, l.tile.iz))) { l.fineState = undefined; return; }
    const heights = upsample2(t.heights, t.n);
    const n = 2 * t.n - 1, step = t.step / 2;
    l.fine = { n, step, heights };
    l.fineState = 'ready';
    const mesh = this.gridMesh(l.tile, n, step, heights, 2);
    l.group.add(mesh);
    l.meshes.push(mesh);
    l.fineMesh = mesh;
    if (l.terrainMesh) l.terrainMesh.visible = false;
    this.version++;
    const asphalt = this.asphaltMesh(l.tile);
    if (asphalt) { l.group.add(asphalt); l.meshes.push(asphalt); l.asphalt = asphalt; }
    this.syncRoadLines(l);
  }

  /** The thin lines of the roads show only where there is no asphalt. */
  private syncRoadLines(l: Loaded): void {
    for (const o of l.meshes) if (o.userData.road) o.visible = !l.asphalt;
  }

  /** Call every frame: it decides by itself when to fetch, build and release. */
  update(camera: Camera, target: Vector3, now: number): void {
    // One built tile per frame, so that panning does not stall.
    const t = this.ready.shift();
    if (t) this.build(t, camera);
    else {
      const f = this.fineReady.shift();
      if (f) this.buildFine(f.l, f.tile);
      else {
        const r = this.restyle.shift();
        if (r && this.tiles.get(tileName(r.tile.ix, r.tile.iz)) === r && r.terrainMesh) {
          const old = r.terrainMesh, visible = old.visible;
          r.group.remove(old); old.geometry.dispose(); r.meshes.splice(r.meshes.indexOf(old), 1);
          r.terrainMesh = this.terrainMesh(r.tile) as Mesh;
          r.terrainMesh.visible = visible;
          r.group.add(r.terrainMesh); r.meshes.push(r.terrainMesh);
        }
      }
    }
    if (this.ride) {
      let loading = 0;
      for (const l of this.tiles.values()) if (l.fineState === 'loading') loading++;
      for (const [name, l] of this.tiles) {
        const d = Math.hypot((l.tile.ix + 0.5) * TILE_SIZE - target.x, (l.tile.iz + 0.5) * TILE_SIZE - target.z) - TILE_SIZE * 0.5; // about the distance to the edge of the tile
        if (d > FINE_KEEP && (l.fine || l.fineMesh)) this.dropFine(l);
        else if (d < FINE_RADIUS && !l.fineState && l.tile.terrain && loading < 2) { loading++; void this.fetchFine(name, l); }
      }
    }
    if (now - this.checkedAt < 250) return;
    this.checkedAt = now;

    const dist = camera.position.distanceTo(target);
    const radius = Math.min(16000, Math.max(5000, dist * 2.2));
    const wanted: { name: string; ix: number; iz: number; d: number }[] = [];
    const reach = Math.ceil(radius / TILE_SIZE) + 1;
    const cx = Math.floor(target.x / TILE_SIZE), cz = Math.floor(target.z / TILE_SIZE);
    for (let ix = cx - reach; ix <= cx + reach; ix++) for (let iz = cz - reach; iz <= cz + reach; iz++) {
      const name = tileName(ix, iz);
      if (!this.index.has(name)) continue;
      const d = Math.hypot((ix + 0.5) * TILE_SIZE - target.x, (iz + 0.5) * TILE_SIZE - target.z) - TILE_SIZE * 0.7;
      if (d < radius) wanted.push({ name, ix, iz, d });
    }
    wanted.sort((a, b) => a.d - b.d);
    wanted.length = Math.min(wanted.length, MAX_TILES);
    const keep = new Set(wanted.map((w) => w.name));

    for (const [name, l] of this.tiles) {
      const dx = (l.tile.ix + 0.5) * TILE_SIZE - target.x, dz = (l.tile.iz + 0.5) * TILE_SIZE - target.z;
      if (!keep.has(name) && Math.hypot(dx, dz) > radius + TILE_SIZE) this.release(name, l);
    }
    for (const w of wanted) {
      if (this.loading.size >= MAX_FETCHES) break;
      if (!this.tiles.has(w.name) && !this.loading.has(w.name)) void this.fetchTile(w.name);
    }
    // Detail (buildings, small roads) only for the tiles near the camera.
    for (const l of this.tiles.values()) {
      const near = this.nearCamera(l.tile, camera);
      if (near !== l.near) this.setDetail(l, near);
    }
    this.stats.loaded = this.tiles.size;
    this.stats.loading = this.loading.size;
  }

  private nearCamera(tile: Tile, camera: Camera): boolean {
    const cx = (tile.ix + 0.5) * TILE_SIZE, cz = (tile.iz + 0.5) * TILE_SIZE;
    const p = camera.position;
    return Math.hypot(p.x - cx, p.y, p.z - cz) - TILE_SIZE * 0.7 < NEAR;
  }

  private async fetchTile(name: string): Promise<void> {
    this.loading.add(name);
    try {
      const r = await fetch(BASE + name);
      if (!r.ok) throw new Error(String(r.status));
      this.ready.push(decodeTile(new Uint8Array(await r.arrayBuffer())));
    } catch (e) {
      console.warn('Kunne ikkje laste flis', name, e);
      this.index.delete(name); // do not try again
    } finally {
      this.loading.delete(name);
    }
  }

  private release(name: string, l: Loaded): void {
    this.group.remove(l.group);
    for (const o of l.meshes) (o as Mesh).geometry?.dispose();
    this.tiles.delete(name);
    this.version++;
  }

  private build(tile: Tile, camera: Camera): void {
    const name = tileName(tile.ix, tile.iz);
    if (this.tiles.has(name)) return;
    const l: Loaded = { tile, group: new Group(), near: false, meshes: [] };
    this.version++;
    this.tiles.set(name, l); // the terrain of this tile is needed for heightAt before the rest is built
    const add = (o: Object3D) => { l.group.add(o); l.meshes.push(o); return o; };

    if (this.options.terrain && tile.terrain) { l.terrainMesh = this.terrainMesh(tile) as Mesh; add(l.terrainMesh); }
    else for (const m of this.areaMeshes(tile)) add(m);
    for (const m of this.roadMeshes(tile, false)) add(m);
    this.group.add(l.group);
    this.setDetail(l, this.nearCamera(tile, camera));
  }

  private setDetail(l: Loaded, near: boolean): void {
    l.near = near;
    for (const o of l.detail ?? []) { l.group.remove(o); l.meshes.splice(l.meshes.indexOf(o), 1); (o as Mesh).geometry?.dispose(); }
    l.detail = undefined;
    if (!near) return;
    const detail: Object3D[] = [...this.roadMeshes(l.tile, true)];
    const b = this.buildingMesh(l.tile);
    if (b) detail.push(b);
    for (const o of detail) { l.group.add(o); l.meshes.push(o); }
    l.detail = detail;
    this.syncRoadLines(l);
  }

  /** Land cover as flat triangles, drawn first and in class order without depth, so that nothing fights. */
  private areaMeshes(tile: Tile): Object3D[] {
    const out: Object3D[] = [];
    // Under all of it a quiet ground colour: the land that N50 has no class for (airfields, bare rock) is then not a hole.
    const ox = tile.ix * TILE_SIZE, oz = tile.iz * TILE_SIZE;
    const ground = new BufferGeometry();
    ground.setAttribute('position', new BufferAttribute(new Float32Array([ox, -2, oz, ox + TILE_SIZE, -2, oz, ox + TILE_SIZE, -2, oz + TILE_SIZE, ox, -2, oz + TILE_SIZE]), 3));
    ground.setIndex([0, 1, 2, 0, 2, 3]);
    const base = new Mesh(ground, this.groundMaterial);
    base.renderOrder = -20;
    out.push(base);
    const per: { pos: number[]; idx: number[] }[] = AREA_COLORS.map(() => ({ pos: [], idx: [] }));
    for (const a of tile.areas) {
      const g = per[a.cls];
      if (!g) continue;
      for (const poly of polygons(a.rings)) {
        const outer = poly[0], holes = poly.slice(1);
        const tris = ShapeUtils.triangulateShape(outer.map((p) => new Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new Vector2(p[0], p[1]))));
        const flat = [outer, ...holes].flat();
        const first = g.pos.length / 3;
        for (const p of flat) g.pos.push(p[0], -2, p[1]);
        for (const t of tris) g.idx.push(first + t[0], first + t[1], first + t[2]);
      }
    }
    per.forEach((g, cls) => {
      if (!g.idx.length) return;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(g.pos), 3));
      geometry.setIndex(new BufferAttribute(g.pos.length / 3 > 65535 ? new Uint32Array(g.idx) : new Uint16Array(g.idx), 1));
      const mesh = new Mesh(geometry, this.areaMaterials[cls]);
      mesh.renderOrder = -10 + cls;
      out.push(mesh);
    });
    return out;
  }

  /**
   * The roads of a tile as ribbons of asphalt laid on the terrain: each centre line gets the width of its class, a point every
   * few meters with the ground height under both edges, and a hair of lift so it does not fight with the ground.
   */
  private asphaltMesh(tile: Tile): Mesh | undefined {
    const pos: number[] = [], col: number[] = [], idx: number[] = [];
    const color = new Color();
    const STEP = 4, LIFT = 0.12;
    for (const r of tile.roads) {
      const width = ROAD_WIDTH[r.cls] ?? 0;
      if (width <= 0 || r.points.length < 2) continue;
      // Points along the line, no farther apart than STEP, so that the ribbon follows the terrain.
      const pts: XY[] = [r.points[0]];
      for (let i = 1; i < r.points.length; i++) {
        const p = r.points[i - 1], q = r.points[i], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const parts = Math.max(1, Math.ceil(len / STEP));
        for (let k = 1; k <= parts; k++) pts.push([p[0] + ((q[0] - p[0]) * k) / parts, p[1] + ((q[1] - p[1]) * k) / parts]);
      }
      const base = pos.length / 3;
      const half = width / 2, paint = r.cls === 5 ? GRAVEL : ASPHALT;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1];
        const len = Math.hypot(tx, tz) || 1;
        tx /= len; tz /= len;
        const nx = -tz, nz = tx, [x, z] = pts[i];
        const shade = 0.88 + 0.24 * noise(x / 9, z / 9);
        color.copy(paint).multiplyScalar(shade);
        for (const side of [1, -1]) {
          const ex = x + nx * half * side, ez = z + nz * half * side;
          pos.push(ex, this.heightAt(ex, ez) + LIFT, ez);
          col.push(color.r, color.g, color.b);
        }
        if (i > 0) { const k = base + i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
      }
    }
    if (!idx.length) return undefined;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    geometry.setIndex(new BufferAttribute(new Uint32Array(idx), 1));
    const mesh = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    mesh.frustumCulled = true;
    return mesh;
  }

  private roadMeshes(tile: Tile, small: boolean): Object3D[] {
    const per: number[][] = ROAD_STYLE.map(() => []);
    const lift = this.options.terrain ? 1 : -1;
    for (const r of tile.roads) {
      // The big roads belong to the far view, the small ones and the paths are added with the detail.
      if ((r.cls >= 4 && r.cls !== 6) !== small) continue;
      const out = per[r.cls];
      if (!out) continue;
      for (let i = 0; i + 1 < r.points.length; i++) {
        const p = r.points[i], q = r.points[i + 1];
        out.push(p[0], this.heightAt(p[0], p[1]) + lift, p[1], q[0], this.heightAt(q[0], q[1]) + lift, q[1]);
      }
    }
    const meshes: Object3D[] = [];
    per.forEach((positions, cls) => {
      if (!positions.length) return;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
      const lines = new LineSegments(geometry, this.roadMaterials[cls]);
      lines.userData.road = true;
      meshes.push(lines);
    });
    return meshes;
  }

  /**
   * A building on a slope: the walls start below the lowest ground under the footprint (and a little deeper still, as a
   * foundation), so that from close up there is never a gap under the uphill side. The roof stays `height` above the highest
   * ground, so the downhill wall is the taller one, as in life.
   */
  private onGround(ring: [number, number][], height: number): Block {
    const first = ring[0];
    if (!this.options.terrain) return { ring, height, base: this.heightAt(first[0], first[1]) };
    let low = Infinity, high = -Infinity;
    const step = Math.max(1, Math.floor(ring.length / 12));
    for (let i = 0; i < ring.length; i += step) {
      const g = this.heightAt(ring[i][0], ring[i][1]);
      low = Math.min(low, g); high = Math.max(high, g);
    }
    const base = low - FOUNDATION;
    return { ring, height: high + height - base, base };
  }

  private buildingMesh(tile: Tile): Object3D | undefined {
    const blocks: Block[] = [];
    for (const b of tile.buildings) {
      blocks.push(this.onGround(b.ring, b.height / 10));
    }
    const h = POINT_SIZE / 2;
    for (const p of tile.points) {
      blocks.push({ ...this.onGround([[p.x - h, p.z - h], [p.x + h, p.z - h], [p.x + h, p.z + h], [p.x - h, p.z + h]], p.height / 10), quad: true });
    }
    if (!blocks.length) return undefined;
    const mesh = extrudeBlocks(blocks);
    mesh.frustumCulled = true; // a tile is a bounding sphere: the tiles behind the camera cost nothing
    return mesh;
  }

  /** The terrain model as a shaded mesh; areas are painted into its vertex colours. */
  private terrainMesh(tile: Tile): Object3D {
    const t = tile.terrain!;
    return this.gridMesh(tile, t.n, t.step, t.heights, 1);
  }

  /**
   * A mesh over a height grid (decimeters, n x n, `step` meters apart) of one tile. `colorEvery` is how many grid steps share one
   * land cover lookup: the lookup is the slow part, the rest is cheap.
   */
  private gridMesh(tile: Tile, n: number, step: number, heights: ArrayLike<number>, colorEvery: number): Mesh {
    const ox = tile.ix * TILE_SIZE, oz = tile.iz * TILE_SIZE;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
    const color = new Color();
    const clsGrid = new Int8Array(Math.ceil(n / colorEvery) * Math.ceil(n / colorEvery));
    const cn = Math.ceil(n / colorEvery);
    const clsAt = (i: number, j: number) => {
      const ci = Math.floor(i / colorEvery), cj = Math.floor(j / colorEvery), k = cj * cn + ci;
      if (!clsGrid[k]) {
        // Edge samples are asked a hair inside the tile: the clipped land cover has no certain answer exactly on the border.
        const x = Math.min(ox + TILE_SIZE - 0.05, Math.max(ox + 0.05, ox + ci * colorEvery * step)), z = Math.min(oz + TILE_SIZE - 0.05, Math.max(oz + 0.05, oz + cj * colorEvery * step));
        clsGrid[k] = areaClassAt(tile, x, z) + 2; // 0 = not looked up yet; stored as class + 2, so "none" (-1) is 1
      }
      return clsGrid[k] - 2;
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, h = heights[k] / 10;
      const x = ox + i * step, z = oz + j * step;
      pos.set([x, h, z], k * 3);
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
      // Slopes in meters per meter, one-sided at the edge of the tile, so that the tiles agree on the shade of their shared edge.
      const dx = (heights[j * n + i1] - heights[j * n + i0]) / 10 / ((i1 - i0) * step);
      const dz = (heights[j1 * n + i] - heights[j0 * n + i]) / 10 / ((j1 - j0) * step);
      // Light from the south-west: the same side as the walls.
      const shade = Math.min(1.6, Math.max(0.4, 1 + (dx * 0.55 - dz * 0.83) * 2.2));
      const cls = clsAt(i, j);
      if (this.ride) rideColor(color, cls, Math.hypot(dx, dz), x, z);
      else color.set(cls < 0 ? '#0c1220' : AREA_COLORS[cls]);
      color.multiplyScalar(shade);
      col.set([color.r, color.g, color.b], k * 3);
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    let q = 0;
    for (let j = 0; j + 1 < n; j++) for (let i = 0; i + 1 < n; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(pos, 3));
    geometry.setAttribute('color', new BufferAttribute(col, 3));
    geometry.setIndex(new BufferAttribute(idx, 1));
    return new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }));
  }
}

/** Splits an area's rings into polygons: outer rings with the rings inside them as holes. */
function polygons(rings: XY[][]): XY[][][] {
  const sign = (r: XY[]) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a >= 0 ? 1 : -1; };
  if (!rings.length) return [];
  const s0 = sign(rings[0]);
  const out: XY[][][] = [];
  for (const r of rings) {
    if (r.length < 3) continue;
    if (sign(r) === s0 || !out.length) out.push([r]);
    else out[out.length - 1].push(r);
  }
  return out;
}

function inside(x: number, z: number, r: XY[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i], b = r[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** The land cover class at a point (the topmost wins), or -1 where nothing covers it. */
function areaClassAt(tile: Tile, x: number, z: number): number {
  let cls = -1;
  for (const a of tile.areas) {
    if (a.cls < cls) continue;
    let n = 0;
    for (const r of a.rings) if (inside(x, z, r)) n++;
    if (n % 2 === 1) cls = a.cls;
  }
  return cls;
}
