// Rain and snow: particles in a box around the camera, moved entirely in the vertex shader (the CPU does nothing per frame
// but set a few numbers). The box is fixed to the world, so that drops stay where they are when the camera moves.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Group, LineSegments, Points, ShaderMaterial, Vector3 } from 'three';

const RAIN = 9000, SNOW = 14000;

const common = /* glsl */ `
uniform vec3 uCenter; uniform float uBox, uTime, uDensity;
uniform vec2 uWind;
attribute vec4 seed;
vec3 place(vec3 fall) {
  vec3 drift = fall * uTime + vec3(uWind.x, 0.0, uWind.y) * uTime;
  return uCenter + (mod(seed.xyz * uBox + drift - uCenter, uBox) - 0.5 * uBox);
}`;

function rainMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uCenter: { value: new Vector3() }, uBox: { value: 150 }, uTime: { value: 0 }, uDensity: { value: 0 }, uWind: { value: [0, 0] }, uFall: { value: 9 }, uColor: { value: new Color('#9fb6d8') }, uAlpha: { value: 0.35 } },
    vertexShader: `${common}
uniform float uFall;
attribute float tail;
void main() {
  vec3 p = place(vec3(0.0, -uFall, 0.0));
  vec3 dir = normalize(vec3(uWind.x, -uFall, uWind.y));
  p -= dir * tail * (0.7 + uBox * 0.006);
  gl_Position = seed.w > uDensity ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: `uniform vec3 uColor; uniform float uAlpha;
void main() { gl_FragColor = vec4(uColor, uAlpha); }`,
  });
}

function snowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    uniforms: { uCenter: { value: new Vector3() }, uBox: { value: 150 }, uTime: { value: 0 }, uDensity: { value: 0 }, uWind: { value: [0, 0] }, uPixel: { value: 800 } },
    vertexShader: `${common}
uniform float uPixel;
void main() {
  vec3 p = place(vec3(0.0, -1.4 - seed.w * 0.8, 0.0));
  p.xz += vec2(sin(uTime * 0.9 + seed.x * 40.0), cos(uTime * 0.7 + seed.z * 40.0)) * 0.6; // the flakes sway
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(uPixel * (0.05 + uBox * 0.0006) / max(-mv.z, 0.1), 1.0, 7.0);
  gl_Position = seed.w > uDensity ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
}`,
    fragmentShader: `void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vec3(0.9, 0.93, 1.0), 0.55 * smoothstep(0.5, 0.15, d));
}`,
  });
}

export class Precip {
  readonly group = new Group();
  private readonly rain: LineSegments;
  private readonly snow: Points;
  private readonly rainMat = rainMaterial();
  private readonly snowMat = snowMaterial();

  constructor() {
    const seeds = (n: number) => { const a = new Float32Array(n * 4); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; };
    // Rain: two vertices for each drop (head and tail) with the same seed.
    const rs = seeds(RAIN), pairSeed = new Float32Array(RAIN * 2 * 4), tail = new Float32Array(RAIN * 2);
    for (let i = 0; i < RAIN; i++) { pairSeed.set(rs.subarray(i * 4, i * 4 + 4), i * 8); pairSeed.set(rs.subarray(i * 4, i * 4 + 4), i * 8 + 4); tail[i * 2 + 1] = 1; }
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(new Float32Array(RAIN * 2 * 3), 3));
    rg.setAttribute('seed', new BufferAttribute(pairSeed, 4));
    rg.setAttribute('tail', new BufferAttribute(tail, 1));
    this.rain = new LineSegments(rg, this.rainMat);
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(new Float32Array(SNOW * 3), 3));
    sg.setAttribute('seed', new BufferAttribute(seeds(SNOW), 4));
    this.snow = new Points(sg, this.snowMat);
    for (const o of [this.rain, this.snow]) { o.frustumCulled = false; o.renderOrder = 5; this.group.add(o); }
  }

  /** `precip` in mm an hour, `snow` 0 rain to 1 snow; `center` is the camera, `box` the size of the volume of drops in meters. */
  update(seconds: number, center: Vector3, box: number, precip: number, snow: number, wind: number, pixelsPerMeter: number): void {
    const density = Math.min(1, precip / 3.5);
    const drift: [number, number] = [wind * 0.5, -wind * 0.25];
    for (const [mat, d] of [[this.rainMat, density * (1 - snow)], [this.snowMat, Math.min(1, density * 1.6) * snow]] as const) {
      const u = mat.uniforms;
      (u.uCenter.value as Vector3).copy(center);
      u.uBox.value = box; u.uTime.value = seconds % 3600; u.uDensity.value = d; u.uWind.value = drift;
    }
    this.snowMat.uniforms.uPixel.value = pixelsPerMeter;
    this.rain.visible = density * (1 - snow) > 0.001;
    this.snow.visible = density * snow > 0.001;
  }
}
