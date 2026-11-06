// Points of light: soft discs, added together so crowded places glow brighter. The size is in meters on the ground,
// so a bus is the same size as the street it is on whatever the zoom, but never smaller than `minPx` on the screen.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from 'three';

const vertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
uniform float uMinPx;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(uMinPx, aSize * uScale / -mv.z);
  vColor = aColor;
  vAlpha = aAlpha;
}`;

const fragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  if (d > 1.0) discard;
  float core = smoothstep(0.38, 0.0, d);
  float glow = pow(1.0 - d, 2.4);
  vec3 c = mix(vColor, vec3(1.0), core * 0.75);
  gl_FragColor = vec4(c * (glow * 0.85 + core) * vAlpha, 1.0);
}`;

export class Glow {
  readonly points: Points;
  private readonly position: BufferAttribute;
  private readonly color: BufferAttribute;
  private readonly size: BufferAttribute;
  private readonly alpha: BufferAttribute;
  private readonly material: ShaderMaterial;
  count = 0;

  constructor(readonly capacity: number, minPx: number) {
    const geometry = new BufferGeometry();
    this.position = new BufferAttribute(new Float32Array(capacity * 3), 3);
    this.color = new BufferAttribute(new Float32Array(capacity * 3), 3);
    this.size = new BufferAttribute(new Float32Array(capacity), 1);
    this.alpha = new BufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.position, this.color, this.size, this.alpha]) a.setUsage(35048 /* DynamicDrawUsage */);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('aColor', this.color);
    geometry.setAttribute('aSize', this.size);
    geometry.setAttribute('aAlpha', this.alpha);
    this.material = new ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending,
      uniforms: { uScale: { value: 1000 }, uMinPx: { value: minPx } },
    });
    this.points = new Points(geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** Call when the canvas or the camera's field of view changes: pixels per meter at one meter's distance. */
  setScale(pixelsPerMeterAtOne: number, pixelRatio: number, minPx: number): void {
    this.material.uniforms.uScale.value = pixelsPerMeterAtOne;
    this.material.uniforms.uMinPx.value = minPx * pixelRatio;
  }

  clear(): void { this.count = 0; }

  add(x: number, y: number, z: number, color: Color, size: number, alpha: number): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.position.setXYZ(i, x, y, z);
    this.color.setXYZ(i, color.r, color.g, color.b);
    this.size.setX(i, size);
    this.alpha.setX(i, alpha);
  }

  /** Sends what was added to the graphics card. */
  commit(): void {
    this.points.geometry.setDrawRange(0, this.count);
    for (const a of [this.position, this.color, this.size, this.alpha]) a.needsUpdate = true;
  }
}
