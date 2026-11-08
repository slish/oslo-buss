// Buses seen from close by: a small low-poly 3D bus per bus, one InstancedMesh for all of them. Far away the buses are
// points of light (glow.ts); between NEAR_FAR and NEAR_NEAR meters from the camera the light fades and the bus fades in.

import {
  AmbientLight, BoxGeometry, BufferAttribute, Color, DirectionalLight, Euler, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Scene, Vector3,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Beyond this distance from the camera (meters) a bus is only light; closer than NEAR_NEAR it is only a bus. */
export const NEAR_FAR = 2500;
export const NEAR_NEAR = 1000;
export const BUS_LENGTH = 12;
/** Room for this many buses at once, as lights and as models. The rush hour of all 97 lines is some hundreds; a bus past the limit is simply not drawn. */
export const MAX_BUSES = 2048;

/** 0 far away, 1 close: how much of the bus is the model. Smooth. */
export function modelness(distance: number): number {
  const t = Math.min(1, Math.max(0, (NEAR_FAR - distance) / (NEAR_FAR - NEAR_NEAR)));
  return t * t * (3 - 2 * t);
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, shade: number): BoxGeometry {
  const g = new BoxGeometry(w, h, d);
  g.translate(x, y, z);
  const colors = new Float32Array(g.attributes.position.count * 3).fill(shade);
  g.setAttribute('color', new BufferAttribute(colors, 3));
  return g;
}

/** About 12 x 3 x 2.5 m, the length along x: body, a darker band of windows, a lighter roof and four wheels. Vertex colours are shades of the line colour. */
function busGeometry(): BufferGeometry {
  const parts = [
    box(12, 2.2, 2.5, 0, 1.1, 0, 1), // body
    box(11.4, 0.8, 2.56, 0, 1.75, 0, 0.22), // windows, a hair wider than the body
    box(11.6, 0.35, 2.3, 0, 2.38, 0, 1.25), // roof
    box(0.1, 0.5, 2.0, 6.0, 1.5, 0, 0.18), // windscreen
    ...[-3.8, 3.4].flatMap((x) => [-1, 1].map((side) => box(1.1, 0.9, 0.35, x, 0.45, side * 1.2, 0.12))), // wheels
  ];
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

export class BusModels {
  readonly mesh: InstancedMesh;
  private readonly matrix = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly euler = new Euler();
  private readonly scale = new Vector3();
  private readonly pos = new Vector3();
  private readonly shade = new Color();

  constructor(scene: Scene, readonly capacity = MAX_BUSES) {
    const material = new MeshLambertMaterial({ vertexColors: true });
    this.mesh = new InstancedMesh(busGeometry(), material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
    // Light only for the buses: every other material in the scene ignores it.
    scene.add(this.ambient, this.sun);
  }

  private readonly ambient = new AmbientLight('#ffffff', 1.3);
  private readonly sun = new DirectionalLight('#ffffff', 2.2);

  /** The light of the hour: the colour and strength of the sky and the sun, and where the sun is. */
  setLight(ambient: Color, sunColor: Color, sunPower: number, dir: [number, number, number]): void {
    this.ambient.color.copy(ambient);
    this.ambient.intensity = 1;
    this.sun.color.copy(sunColor);
    this.sun.intensity = 2.4 * sunPower;
    this.sun.position.set(dir[0], Math.max(0.15, dir[1]), dir[2]);
  }

  clear(): void { this.mesh.count = 0; }

  /** Adds a bus at (x, y, z), heading `bearing` degrees (compass), tilted `pitch` radians uphill, grown to `fade` (0 to 1) of full size. */
  add(x: number, y: number, z: number, bearing: number, pitch: number, color: Color, fade: number, bright: number): void {
    if (this.mesh.count >= this.capacity) return;
    const b = (bearing * Math.PI) / 180;
    // The scene's x is east and z south, so a bus heading `b` moves along (sin b, -cos b); its long axis is x.
    const yaw = Math.atan2(Math.cos(b), Math.sin(b));
    this.euler.set(0, yaw, pitch, 'YZX');
    this.quat.setFromEuler(this.euler);
    this.scale.setScalar(Math.max(0.05, fade));
    this.pos.set(x, y, z);
    this.matrix.compose(this.pos, this.quat, this.scale);
    const i = this.mesh.count++;
    this.mesh.setMatrixAt(i, this.matrix);
    this.mesh.setColorAt(i, this.shade.copy(color).multiplyScalar(bright));
  }

  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
