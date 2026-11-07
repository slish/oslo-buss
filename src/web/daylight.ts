// The light of the hour: from the time of the day (and the cloud) the colours of the sky and the tint that the map is lit with,
// and the shader patch that puts the tint on the map's materials. The map is drawn without lights (vertex colours made once),
// so the hour reaches it as one colour that all of it is multiplied by, and one number for how many windows are lit.

import { Color, Material, MeshBasicMaterial } from 'three';
import { moonAt, sunAt, direction } from '../shared/sun';
import { ORIGIN } from './world';

export interface Light {
  /** Unit vectors toward the sun and the moon in the scene (x east, y up, z south), and altitudes in degrees. */
  sunDir: [number, number, number]; moonDir: [number, number, number]; sunAlt: number; moonAlt: number;
  moonFraction: number; moonPhase: number;
  skyTop: Color; skyHorizon: Color;
  /** What the map is multiplied by: 1 is the colours as they were drawn. */
  tint: Color;
  stars: number; windows: number;
  /** The light on the models of the buses. */
  ambient: Color; sunLight: Color; sunPower: number;
}

interface Key { alt: number; top: string; hor: string; tint: [number, number, number]; windows: number; stars: number }
// Keyed on the height of the sun in degrees: deep night, nautical and civil twilight, sunset, golden hour, day.
const KEYS: Key[] = [
  { alt: -18, top: '#01030a', hor: '#060b18', tint: [0.95, 1.05, 1.4], windows: 1, stars: 1 },
  { alt: -12, top: '#040a1e', hor: '#12183a', tint: [1.0, 1.1, 1.5], windows: 1, stars: 0.9 },
  { alt: -6, top: '#0f1d48', hor: '#4a3b6a', tint: [1.2, 1.25, 1.6], windows: 1, stars: 0.35 },
  { alt: -1, top: '#27407a', hor: '#e0824f', tint: [1.8, 1.45, 1.25], windows: 0.75, stars: 0 },
  { alt: 4, top: '#3a66a8', hor: '#f2b27a', tint: [2.7, 2.15, 1.5], windows: 0.3, stars: 0 },
  { alt: 12, top: '#4a82c4', hor: '#aecbe6', tint: [3.5, 3.2, 1.9], windows: 0, stars: 0 },
  { alt: 40, top: '#3f78c0', hor: '#b5d2ec', tint: [3.9, 3.6, 2.1], windows: 0, stars: 0 },
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The light at `time` (ms since 1970); `cloud` 0 to 1 greys the sky and takes the sun out of the day. */
export function lightAt(time: number, cloud = 0, lat = ORIGIN.lat, lon = ORIGIN.lon): Light {
  const sun = sunAt(time, lat, lon), moon = moonAt(time, lat, lon);
  const alt = (sun.altitude * 180) / Math.PI;
  let i = 0;
  while (i < KEYS.length - 2 && alt > KEYS[i + 1].alt) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (alt - a.alt) / (b.alt - a.alt)));
  const skyTop = new Color(a.top).lerp(new Color(b.top), t), skyHorizon = new Color(a.hor).lerp(new Color(b.hor), t);
  const tint = new Color(mix(a.tint[0], b.tint[0], t), mix(a.tint[1], b.tint[1], t), mix(a.tint[2], b.tint[2], t));
  const day = smooth(-4, 8, alt);
  // Cloud: the day gets duller and greyer, the night less starry.
  const grey = new Color().setScalar(0.35 * (0.3 + 0.7 * day));
  skyTop.lerp(grey, cloud * 0.7); skyHorizon.lerp(grey.clone().multiplyScalar(1.4), cloud * 0.6);
  tint.multiplyScalar(1 - 0.3 * cloud * day);
  // The moon lights the night a little, the more the fuller it is and the higher it stands.
  const moonAlt = (moon.altitude * 180) / Math.PI;
  const moonLight = moon.fraction * smooth(0, 25, moonAlt) * (1 - day);
  tint.add(new Color(0.1, 0.12, 0.2).multiplyScalar(moonLight * (1 - 0.6 * cloud)));
  const sunPower = smooth(-2, 10, alt) * (1 - 0.6 * cloud);
  const sunLight = new Color().lerpColors(new Color('#ff9a55'), new Color('#fff4e0'), smooth(0, 15, alt));
  const ambient = new Color(0.35, 0.4, 0.6).lerp(new Color(1.2, 1.2, 1.25), day).add(new Color(0.05, 0.06, 0.1).multiplyScalar(moonLight));
  return {
    sunDir: direction(sun), moonDir: direction(moon), sunAlt: alt, moonAlt, moonFraction: moon.fraction, moonPhase: moon.phase,
    skyTop, skyHorizon, tint, stars: mix(a.stars, b.stars, t) * (1 - 0.8 * cloud), windows: mix(a.windows, b.windows, t), ambient, sunLight, sunPower,
  };
}

/** The values the shaders of the map read every frame, set once per frame by `apply`. */
export const tintUniform = { value: new Color(1, 1, 1) };
export const windowsUniform = { value: 0 };
/** How much of the ground is snow: 0 none, 1 all (see snowCover). */
export const snowUniform = { value: 0 };

export function applyLight(light: Light): void {
  tintUniform.value.copy(light.tint);
  windowsUniform.value = light.windows;
}

/** Snow on the ground from the temperature: almost none just below freezing, all white at -10 degrees. */
export function snowCover(temperature: number): number {
  return Math.min(1, Math.max(0, -temperature / 10));
}
export function applySnow(cover: number): void {
  snowUniform.value = cover;
}

/** How much of each land cover class takes snow (sea, water, farmland, marsh, forest, built, park): water none, forest and streets less. */
export const SNOW_BY_CLASS = [0, 0, 1, 0.9, 0.75, 0.8, 0.9];

/**
 * What a surface of the map is: `ground` (one colour all over, or a polygon), `terrain` (a vertex colour mesh with a `snowK` attribute
 * for how much snow each vertex takes) or `walls` (the buildings: windows in the walls, snow on the roofs).
 */
export type Surface = 'ground' | 'terrain' | 'walls';

/** Puts the hour's tint and the snow on a material of the map. `snow` is how much of the snow the surface takes (a road is ploughed). */
export function daylit<T extends MeshBasicMaterial>(material: T, surface: Surface = 'ground', snow = 1): T {
  patch(material, surface, snow);
  return material;
}
/** The thin lines of the map: only the tint, since they have no area to snow on. */
export function daylitLine<T extends Material & { color: Color }>(material: T): T {
  patch(material, 'line', 0);
  return material;
}

function patch(material: Material, mode: Surface | 'line', snow: number): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTint = tintUniform;
    shader.uniforms.uWindows = windowsUniform;
    shader.uniforms.uSnow = snowUniform;
    shader.uniforms.uSnowK = { value: snow };
    if (mode === 'walls') {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 wall;\nvarying vec3 vWall;\nvarying float vHeight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = wall;\nvHeight = (modelMatrix * vec4(transformed, 1.0)).y;');
    } else if (mode === 'terrain') {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float snowK;\nvarying float vSnowK;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSnowK = snowK;');
    }
    const snowK = mode === 'walls' ? 'vWall.y > 0.5 ? 0.06 * uSnowK : uSnowK' : mode === 'terrain' ? 'vSnowK * uSnowK' : 'uSnowK';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uTint;
uniform float uWindows, uSnow, uSnowK;${mode === 'walls' ? `
varying vec3 vWall;
varying float vHeight;
float hash3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }` : ''}${mode === 'terrain' ? '\nvarying float vSnowK;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= uTint;
{
  // Snow: the surface goes toward a white that follows the light of the hour (a little shade of the ground stays in it).
  float k = uSnow * (${snowK});
  if (k > 0.0) {
    float lum = dot(uTint, vec3(0.3333));
    vec3 snowColor = vec3(0.80, 0.86, 0.97) * clamp(lum * 0.3, 0.3, 0.95);
    float shade = dot(diffuseColor.rgb, vec3(0.3333)) / max(lum, 0.1);
    snowColor *= clamp(0.8 + shade * 1.5, 0.8, 1.15);
    diffuseColor.rgb = mix(diffuseColor.rgb, snowColor, k);
  }
}${mode === 'walls' ? `
{
  // Walls get windows: a grid of 3 m by 3.2 m cells, some of them lit when it is dark. The position along the wall comes from the
  // building (a small number), not from the world, so that the pattern stays still when the camera moves.
  if (vWall.y > 0.5 && uWindows > 0.0) {
    vec2 g = vec2(vWall.x / 3.0, vHeight / 3.2);
    vec2 cell = floor(g), f = fract(g), fw = fwidth(g) + 1e-4;
    // Soft edges (one pixel wide), and far away, where a window is smaller than a pixel, the average of the pattern instead.
    float ax = smoothstep(0.2, 0.2 + fw.x, f.x) * (1.0 - smoothstep(0.8, 0.8 + fw.x, f.x));
    float ay = smoothstep(0.25, 0.25 + fw.y, f.y) * (1.0 - smoothstep(0.75, 0.75 + fw.y, f.y));
    float fade = 1.0 - smoothstep(0.3, 0.8, max(fw.x, fw.y));
    float lit = step(1.0 - 0.45 * uWindows, hash3(vec3(cell, floor(vWall.z + 0.5))));
    float warm = hash3(vec3(cell.yx, 7.0 + floor(vWall.z + 0.5)));
    vec3 glow = mix(vec3(1.0, 0.74, 0.38), vec3(0.95, 0.9, 0.7), warm);
    float on = mix(0.3 * 0.45 * uWindows, ax * ay * lit, fade);
    diffuseColor.rgb = mix(diffuseColor.rgb, glow * 1.4, on * uWindows);
  }
}` : ''}`);
  };
  material.customProgramCacheKey = () => 'daylit-' + mode;
}
