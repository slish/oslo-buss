// The map is drawn without lights (vertex colours made once), so the hour reaches it through a patch of the shader of each material:
// one colour that all of it is multiplied by (the tint), windows in the walls of the buildings, and snow. The light itself
// (what the tint is at what hour) is in daylight.ts.

import { Color, Material, MeshBasicMaterial } from 'three';
import type { Light } from './daylight';

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

/** Meters from floor to floor in the windows of the walls. Measured on buildings of known floors: the heights in the data give about 4 m a floor, so 3.2 gave a fourth too many. */
export const FLOOR_HEIGHT = 4;

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
  // Walls get windows: a grid of 3 m by a floor high (FLOOR_HEIGHT) cells, some of them lit when it is dark. The position along the wall comes from the
  // building (a small number), not from the world, so that the pattern stays still when the camera moves.
  if (vWall.y > 0.5 && uWindows > 0.0) {
    vec2 g = vec2(vWall.x / 3.0, vHeight / ${FLOOR_HEIGHT.toFixed(1)});
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
