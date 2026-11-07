// The sky: one quad over the whole screen that is drawn first, where every pixel looks up its own direction in the world and
// is coloured from it: the gradient of the hour, the glow of the sun, the moon with its phase, stars and a few clouds.

import { Camera, Color, Matrix4, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import type { Light } from './daylight';

const vertexShader = /* glsl */ `
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
varying vec3 vDir;
void main() {
  gl_Position = vec4(position.xy, 1.0, 1.0);
  vec4 p = uInvProjection * vec4(position.xy, 1.0, 1.0);
  vDir = (uCameraWorld * vec4(p.xyz / p.w, 0.0)).xyz;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uTop, uHorizon, uSun, uMoon, uSunColor;
uniform float uStars, uCloud, uTime, uMoonPhase, uSunPower, uNight;
varying vec3 vDir;

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(vec3(i, 1.0)), b = hash(vec3(i + vec2(1, 0), 1.0)), c = hash(vec3(i + vec2(0, 1), 1.0)), d = hash(vec3(i + vec2(1, 1), 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 11.0; a *= 0.5; } return s; }

void main() {
  vec3 dir = normalize(vDir);
  float up = dir.y;
  // Gradient: the horizon is pale and the zenith deep; under the horizon it darkens to the ground.
  vec3 col = mix(uHorizon, uTop, pow(clamp(up, 0.0, 1.0), 0.45));
  vec3 ground = uHorizon * 0.18;
  col = mix(col, ground, smoothstep(0.0, -0.12, up));

  // The sun: a glow that warms the horizon on its side, and the disc.
  float cs = max(dot(dir, uSun), 0.0);
  col += uSunColor * (pow(cs, 24.0) * 0.35 + pow(cs, 400.0) * 1.2) * uSunPower * smoothstep(-0.15, 0.05, up);
  col += uSunColor * smoothstep(0.9995, 0.9999, cs) * 3.0 * step(-0.02, up) * (1.0 - 0.8 * uCloud);

  // Stars: a point in some cells of a grid on the sphere, twinkling a little.
  if (uStars > 0.0 && up > 0.0) {
    vec3 p = dir * 140.0;
    vec3 id = floor(p);
    float h = hash(id);
    vec3 centre = id + 0.5 + (vec3(hash(id + 3.1), hash(id + 7.7), hash(id + 1.3)) - 0.5) * 0.6;
    float star = step(0.992, h) * smoothstep(0.35, 0.0, length(p - centre));
    star *= 0.6 + 0.4 * sin(uTime * (1.0 + h * 5.0) + h * 40.0);
    col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.0, 0.15, up) * (0.5 + 1.5 * hash(id + 9.0));
  }

  // The moon: a disc whose lit side follows the phase.
  float md = dot(dir, uMoon);
  float radius = 0.038;
  if (md > 0.99 && uMoon.y > -0.05) {
    vec3 right = normalize(cross(uMoon, vec3(0.0, 1.0, 0.0)));
    vec3 upv = cross(right, uMoon);
    vec2 q = vec2(dot(dir, right), dot(dir, upv)) / radius;
    float r2 = dot(q, q);
    if (r2 < 1.0) {
      vec3 n = vec3(q, sqrt(1.0 - r2));
      float a = 6.2831853 * uMoonPhase;
      vec3 l = vec3(sin(a), 0.0, -cos(a));
      float lit = smoothstep(-0.03, 0.06, dot(n, l));
      float maria = 0.78 + 0.22 * noise(q * 3.0 + 4.0);
      vec3 moon = vec3(0.93, 0.92, 0.85) * maria * (0.04 + 0.96 * lit);
      col = mix(col, moon, smoothstep(1.0, 0.92, r2) * (1.0 - 0.7 * uCloud) * smoothstep(0.0, 0.6, uNight));
    }
  }
  col += vec3(0.5, 0.55, 0.7) * pow(max(md, 0.0), 220.0) * 0.25 * step(-0.05, uMoon.y) * uNight;

  // Clouds: noise on a plane high above, brighter on the side of the sun, dark at night. More of them when the sky is overcast.
  if (up > 0.02) {
    vec2 uv = dir.xz / (up + 0.18) * 0.9 + vec2(uTime * 0.004, uTime * 0.0015);
    float n = fbm(uv * 1.4);
    float cover = mix(0.62, 0.12, uCloud);
    float cl = smoothstep(cover, cover + 0.28, n) * smoothstep(0.02, 0.3, up);
    vec3 lit = mix(uHorizon, vec3(1.0), 0.4) * (0.35 + 0.9 * uSunPower) + uSunColor * pow(cs, 6.0) * 0.5 * uSunPower;
    vec3 cloudCol = mix(uTop * 0.8 + 0.03, lit, 0.25 + 0.65 * uSunPower) * mix(1.0, 0.6, uCloud);
    col = mix(col, cloudCol, cl * (0.35 + 0.55 * uCloud));
  }

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class SkyDome {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private readonly invProjection = new Matrix4();

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader, fragmentShader, depthTest: false, depthWrite: false,
      uniforms: {
        uInvProjection: { value: this.invProjection }, uCameraWorld: { value: new Matrix4() },
        uTop: { value: new Color() }, uHorizon: { value: new Color() }, uSun: { value: new Vector3(0, 1, 0) }, uMoon: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color() }, uStars: { value: 0 }, uCloud: { value: 0 }, uTime: { value: 0 }, uMoonPhase: { value: 0.5 }, uSunPower: { value: 1 }, uNight: { value: 0 },
      },
    });
    this.mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  update(camera: Camera, light: Light, cloud: number, seconds: number): void {
    const u = this.material.uniforms;
    this.invProjection.copy((camera as unknown as { projectionMatrixInverse: Matrix4 }).projectionMatrixInverse);
    (u.uCameraWorld.value as Matrix4).copy(camera.matrixWorld);
    (u.uTop.value as Color).copy(light.skyTop);
    (u.uHorizon.value as Color).copy(light.skyHorizon);
    (u.uSun.value as Vector3).set(...light.sunDir);
    (u.uMoon.value as Vector3).set(...light.moonDir);
    (u.uSunColor.value as Color).copy(light.sunLight);
    u.uStars.value = light.stars;
    u.uCloud.value = cloud;
    u.uTime.value = seconds;
    u.uMoonPhase.value = light.moonPhase;
    u.uSunPower.value = Math.max(0.05, light.sunPower);
    u.uNight.value = Math.min(1, Math.max(0, 1 - light.sunPower * 2));
  }
}
