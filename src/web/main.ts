import { Color, FogExp2, GridHelper, Line, LineBasicMaterial, BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Scene, Vector3, WebGLRenderer, AdditiveBlending } from 'three';
import { MapCamera } from './mapcamera';
import type { MapFile } from '../shared/map';
import { buildBuildings, buildRoads } from './basemap';
import { Glow } from './glow';
import { BusModels, BUS_LENGTH, MAX_BUSES, modelness } from './busmodel';
import { BusStore, type Track } from './store';
import type { KartverketMap } from './kartverket';
import { colorOf, toX, toZ } from './world';
import { SkyDome } from './sky';
import { lightAt } from './daylight';
import { applyLight, applySnow, snowCover } from './mapshader';
import { WeatherFeed } from './weather';
import { Precip } from './precip';
import { delayColor, summarize } from './delay';
import { HourControl } from './hour';
import { Legend } from './legend';
import { InfoPanel } from './infopanel';
import { Picker } from './picking';

const BUS_SIZE = 420; // meters across on the ground
const STOP_SIZE = 70;
const FOV = 45;
const RIDE_FOV = 70; // from the seat: wide, like an eye, so that the road and the buildings along it are not squeezed

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;

const renderer = new WebGLRenderer({ canvas, antialias: true });
const scene = new Scene();
renderer.setClearColor('#05070d'); // the sky is drawn over it
const sky = new SkyDome();
scene.add(sky.mesh);
const camera = new PerspectiveCamera(FOV, 1, 50, 400_000);

const store = new BusStore();
try {
  await store.load();
} catch (e) {
  statusEl.textContent = e instanceof Error ? e.message : String(e);
  statusEl.classList.add('warn');
  throw e;
}
const file = store.timetable.file;

// ---- the roads of the lines and their stops ----
const LINE_OPACITY = file.lines.length > 15 ? 0.3 : 0.5; // many roads add up to white
const shapeLines: { position: Float32BufferAttribute; line: string | null }[] = [];
const lineMaterials = new Map<string, LineBasicMaterial[]>();
const roads: Line[] = []; // the colored roads of the lines
const lineOfShape = new Map<string, string>();
for (const p of file.patterns) lineOfShape.set(p.shape, file.lines[p.line].name);

let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const [id, shape] of store.timetable.shapes) {
  const points: number[] = [];
  for (let i = 0; i < shape.lat.length; i++) {
    const x = toX(shape.lon[i]), z = toZ(shape.lat[i]);
    points.push(x, 0, z);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const geometry = new BufferGeometry();
  const position = new Float32BufferAttribute(points, 3);
  geometry.setAttribute('position', position);
  shapeLines.push({ position, line: lineOfShape.get(id) ?? null });
  const material = new LineBasicMaterial({ color: colorOf(lineOfShape.get(id) ?? ''), transparent: true, opacity: LINE_OPACITY, blending: AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
  const lineName = lineOfShape.get(id) ?? '';
  lineMaterials.set(lineName, [...(lineMaterials.get(lineName) ?? []), material]);
  const road = new Line(geometry, material);
  roads.push(road);
  road.renderOrder = 1; // after the map, whatever the buildings in between: the lights show through
  scene.add(road);
}

const grid = new GridHelper(80_000, 80, '#16203a', '#0c1424');
grid.position.set((minX + maxX) / 2, -2, (minZ + maxZ) / 2);
scene.add(grid);

const stops = new Glow(Object.keys(file.stops).length, 2);
const stopColor = new Color('#7d8aa3');
const stopIds = Object.keys(file.stops);
const stopXZ = Object.values(file.stops).map(([, lat, lon]) => [toX(lon), toZ(lat)] as const);
const placeStops = (height: (x: number, z: number) => number) => {
  stops.clear();
  for (const [x, z] of stopXZ) stops.add(x, height(x, z), z, stopColor, STOP_SIZE, 0.55);
  stops.commit();
};
placeStops(() => 0);
stops.points.renderOrder = 2;
scene.add(stops.points);

const mark = new Glow(1, 7); // a halo on the chosen stop
mark.points.renderOrder = 2;
scene.add(mark.points);
const buses = new Glow(MAX_BUSES, 9);
buses.points.renderOrder = 3;
scene.add(buses.points);
const busModels = new BusModels(scene);

// ---- the map under it all: roads and buildings from OpenStreetMap, loaded once the lights are on ----
// ?kart=kartverket draws Kartverket's tiles instead (see docs/KARTVERKET.md); &terreng=1 follows the terrain. The buttons set the flags.
const params = new URLSearchParams(location.search);
const useKart = params.get('kart') === 'kartverket';
const useTerrain = useKart && params.get('terreng') === '1';
function flag(button: string, pressed: boolean, change: (p: URLSearchParams) => void): void {
  const el = document.querySelector<HTMLButtonElement>(button)!;
  el.setAttribute('aria-pressed', String(pressed));
  el.addEventListener('click', () => { const p = new URLSearchParams(location.search); change(p); location.search = p.toString(); });
}
flag('#opt-kart', useKart, (p) => { if (useKart) { p.delete('kart'); p.delete('terreng'); } else p.set('kart', 'kartverket'); });
const delayMode = params.get('forseinking') === '1'; // ?forseinking=1: buses and roads are colored by how late they are
flag('#opt-forseinking', delayMode, (p) => { if (delayMode) p.delete('forseinking'); else p.set('forseinking', '1'); });
flag('#opt-terreng', useTerrain, (p) => { if (useTerrain) p.delete('terreng'); else { p.set('kart', 'kartverket'); p.set('terreng', '1'); } });
document.querySelector<HTMLElement>('#credit-kartverket')!.hidden = !useKart;
document.querySelector<HTMLElement>('#delay-key')!.hidden = !delayMode;
let kart: KartverketMap | undefined;
if (useKart) {
  void (async () => {
    try {
      const { KartverketMap } = await import('./kartverket');
      const k = new KartverketMap({ terrain: useTerrain });
      await k.start();
      scene.add(k.group);
      scene.remove(grid);
      kart = k;
      if (import.meta.env.DEV) Object.assign((window as unknown as { __oslo: object }).__oslo, { kart: k });
    } catch (e) {
      console.warn('Kunne ikkje laste Kartverket-fliser', e);
      statusEl.textContent = e instanceof Error ? e.message : String(e);
      statusEl.classList.add('warn');
    }
  })();
} else void (async () => {
  try {
    const response = await fetch('/data/map.json');
    if (!response.ok) return; // the map is optional: without it the lines and buses still show
    const map = (await response.json()) as MapFile;
    scene.add(buildRoads(map), buildBuildings(map));
    scene.remove(grid);
  } catch (e) {
    console.warn('Kunne ikkje laste kartet', e);
  }
})();

// ---- the hour ----
// The sky follows the clock; ?tid=22:30 or the slider shows another hour of today (hour.ts).
const hour = new HourControl(new URLSearchParams(location.search).get('tid'));
// The weather: cloud covers the sky and dulls the light, rain and snow fall around the camera, and the far hills fade into the haze.
const weather = new WeatherFeed(new URLSearchParams(location.search).get('vaer'));
const precip = new Precip();
scene.add(precip.group);
scene.fog = new FogExp2('#05070d', 0.00001);
const boxCenter = new Vector3();

// ---- camera ----
const center = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
const span = Math.max(maxX - minX, maxZ - minZ);
const controls = new MapCamera(camera, canvas, {
  x: center.x, z: center.z, distance: Math.hypot(span * 0.95, span * 0.75), yaw: 0, elevation: Math.atan2(span * 0.95, span * 0.75),
});
controls.setGround((x, z) => kart?.heightAt(x, z) ?? 0);
controls.update(1);
// For looking at the scene from the console while developing: window.__oslo.camera, .controls, .toX, .toZ.
if (import.meta.env.DEV) Object.assign(window, { __oslo: { camera, controls, toX, toZ, store } });

/** Keeps the camera and its target above the ground (the terrain with ?terreng=1), and near/far in proportion to the distance, so that nothing is clipped close up. */
let nearNow = 0, farNow = 0;
let stopShrink = 1; // the markers of the stops are 70 m discs: close up they shrink with the distance, so they do not cover the street
function keepAbove(): void {
  // Seen from the seat there is no distance to a target (controls.distance is stale then): near is at arm's length so that
  // the road and the buildings beside it are not cut away, far is a few kilometers.
  const riding = controls.firstPerson; // on a seat or on foot: the same wide eye
  const dist = riding ? 40 : controls.distance;
  const fov = riding ? RIDE_FOV : FOV;
  let projection = false;
  if (camera.fov !== fov) {
    camera.fov = Math.abs(camera.fov - fov) < 0.2 ? fov : camera.fov + (fov - camera.fov) * 0.2;
    projection = true;
  }
  const shrink = Math.min(1, Math.max(0.06, dist / 2500));
  if (Math.abs(shrink - stopShrink) > 0.01) { stopShrink = shrink; resize(); }
  const near = riding ? 0.3 : Math.min(100, Math.max(0.5, dist * 0.01)), far = riding ? 25_000 : Math.min(400_000, Math.max(20_000, dist * 8));
  if (Math.abs(near / nearNow - 1) > 0.03 || Math.abs(far / farNow - 1) > 0.03) {
    nearNow = camera.near = near; farNow = camera.far = far;
    projection = true;
  }
  if (projection) camera.updateProjectionMatrix();
}

function resize(): void {
  const ratio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const pixelsPerMeter = (window.innerHeight * ratio) / (2 * Math.tan((camera.fov * Math.PI) / 360));
  buses.setScale(pixelsPerMeter, ratio, 9);
  stops.setScale(pixelsPerMeter * stopShrink, ratio, 2);
}
window.addEventListener('resize', resize);
resize();

// ---- legend ----
function applyLineVisibility(): void {
  for (const [name, materials] of lineMaterials) for (const material of materials) material.visible = !legend.isHidden(name);
  if (selected && legend.isHidden(store.tracks.get(selected)?.bus.line ?? '')) choose({});
}
const legend = new Legend(file.lines, applyLineVisibility);

// ---- picking: the bus nearest the pointer on the screen ----
let selected: string | null = null; // a bus
let pickedStop: string | null = null;
let pickedLine: string | null = null;
function highlightLine(): void {
  for (const [name, materials] of lineMaterials) for (const material of materials) material.opacity = pickedLine === null ? LINE_OPACITY : name === pickedLine ? 1 : 0.18;
}
function choose(what: { bus?: string; stop?: string; line?: string }): void {
  selected = what.bus ?? null; pickedStop = what.stop ?? null; pickedLine = what.line ?? null;
  highlightLine();
  showInfo();
}
let riding: string | null = null; // the id of the bus we sit on
function ride(id: string | null): void {
  riding = id;
  if (id) controls.stopWalking();
  for (const road of roads) road.visible = !id; // from the seat the colored lines and the glowing stops are only noise
  stops.points.visible = mark.points.visible = !id;
  kart?.setRide(!!id);
  if (!id) controls.follow(null);
  showInfo();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && riding) ride(null); });
// ---- walking: on foot on the ground, 1.7 m over the terrain (see walk.ts) ----
const walkButton = document.querySelector<HTMLButtonElement>('#opt-gaa')!;
const walkHint = document.querySelector<HTMLElement>('#walk-hint')!;
let lastPointer: { x: number; y: number } | null = null;
let walls = true; // buildings stop the walker; B turns it off
let walkShown = false;
/** Steps down where the pointer is (or at the focus of the map if there is no pointer on it). */
function walkAt(at?: { x: number; y: number } | null): void {
  if (riding) return;
  const p = at ? controls.pickGround(at.x, at.y) : null;
  controls.startWalking(p?.x ?? controls.target.x, p?.z ?? controls.target.z);
}
/** The map and the lights follow the walking state, whoever ended it (the Esc of the pointer lock, a bus ride, the button). */
function syncWalk(): void {
  const w = controls.walking;
  if (w === walkShown) return;
  walkShown = w;
  for (const road of roads) road.visible = !w && !riding;
  stops.points.visible = mark.points.visible = !w && !riding;
  kart?.setRide(w || !!riding);
  walkHint.hidden = !w;
  walkButton.setAttribute('aria-pressed', String(w));
  if (w) choose({});
}
controls.setBlocked((x, z) => walls && !!kart?.insideBuilding(x, z));
walkButton.addEventListener('click', () => { walkButton.blur(); if (controls.walking) controls.stopWalking(); else walkAt(null); });
canvas.addEventListener('pointermove', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('dblclick', (e) => { if (e.altKey) walkAt({ x: e.clientX, y: e.clientY }); }); // plain double click still zooms
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'g' || e.key === 'G') { if (controls.walking) controls.stopWalking(); else walkAt(lastPointer); }
  else if (e.key === 'Enter' && !controls.walking) walkAt(lastPointer);
  else if (e.key === 'Escape' && controls.walking) controls.stopWalking();
  else if ((e.key === 'b' || e.key === 'B') && controls.walking) { walls = !walls; walkHint.dataset.walls = String(walls); }
});
const stopList = stopIds.map((id, i) => ({ id, x: stopXZ[i][0], z: stopXZ[i][1] }));
const ground = (x: number, z: number) => kart?.heightAt(x, z) ?? 0;
const picker = new Picker({ camera, store, ground, hidden: (line) => legend.isHidden(line), stops: stopList, roads: shapeLines });
const stopHeight = (x: number, z: number) => ground(x, z) + Picker.LIFT;
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (riding || controls.walking || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const bus = picker.bus(e.clientX, e.clientY);
  if (bus) return choose({ bus: bus.bus.id });
  const stop = picker.stop(e.clientX, e.clientY);
  if (stop) return choose({ stop });
  const line = picker.line(e.clientX, e.clientY);
  choose(line ? { line } : {});
});
let hoverCheck = 0;
let hoverDirty = false; // the pointer has moved since the last look
canvas.addEventListener('pointermove', () => { hoverDirty = true; });
/** The hand over something that can be clicked; looked up at most every 80 ms, since it projects every bus and stop. */
function updateCursor(now: number): void {
  if (!hoverDirty || !lastPointer || now - hoverCheck < 80) return;
  hoverCheck = now;
  hoverDirty = false;
  canvas.style.cursor = picker.bus(lastPointer.x, lastPointer.y) || picker.stop(lastPointer.x, lastPointer.y) ? 'pointer' : 'grab';
}

const panel = new InfoPanel(store, delayMode, (id) => ride(id));
function showInfo(): void {
  if (selected && !store.tracks.has(selected)) selected = null;
  panel.show({ bus: selected, stop: pickedStop, line: pickedLine }, riding);
}

function showStatus(): void {
  const live = [...store.tracks.values()].filter((t) => !t.leaving).length;
  if (store.error && !store.tracks.size) { statusEl.textContent = store.error; statusEl.classList.add('warn'); return; }
  const time = store.updatedAt ? new Date(store.updatedAt).toLocaleTimeString('nb-NO') : '–';
  const warn = Boolean(store.error) || store.stale;
  statusEl.classList.toggle('warn', warn);
  statusEl.textContent = store.stale
    ? `${live} bussar etter rutetabell, Entur svarar ikkje`
    : store.error ? `${live} bussar, mista kontakt med tenaren`
    : `${live} bussar på veg · sanntid ${time}`;
  if (delayMode) showDelays();
  if (selected || pickedStop || pickedLine) showInfo();
}
/** Delay mode: the summary in the panel, and each road in the color of the mean delay of its buses (grey without measured data). */
function showDelays(): void {
  const active = [...store.tracks.values()].filter((t) => !t.leaving).map((t) => t.bus);
  const s = summarize(active);
  document.querySelector('#delay-summary')!.textContent = s.measured
    ? `${s.late} av ${s.measured} bussar er over 3 min forseinka` + (s.measured < s.total ? ` (${s.total - s.measured} utan sanntid)` : '')
    : 'Ingen bussar med sanntidsdata';
  const perLine = new Map<string, { delay: number; live: boolean }[]>();
  for (const b of active) perLine.set(b.line, [...(perLine.get(b.line) ?? []), b]);
  for (const [name, materials] of lineMaterials) {
    const mean = summarize(perLine.get(name) ?? []).mean;
    const color = delayColor(mean ?? 0, mean !== null);
    for (const material of materials) material.color.set(color);
  }
}
store.onChange = showStatus;
store.start();

// ---- the loop ----
const tmp = new Color();
let last = performance.now();
let liftedAt = -1;
/** With ?terreng=1 the lines of the buses follow the terrain too, as the tiles come in. */
function liftLines(): void {
  if (!kart || !kart.options.terrain || kart.version === liftedAt) return;
  liftedAt = kart.version;
  placeStops((x, z) => kart!.heightAt(x, z) + 3);
  for (const { position } of shapeLines) {
    for (let i = 0; i < position.count; i++) position.setY(i, kart.heightAt(position.getX(i), position.getZ(i)) + 3);
    position.needsUpdate = true;
  }
}
function frame(now: number): void {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  store.tick(dt);
  buses.clear();
  busModels.clear();
  let ridden: Track | undefined;
  for (const t of store.tracks.values()) {
    if (t.bus.id === riding) { ridden = t; continue; } // from the seat the bus itself is not drawn
    if (legend.isHidden(t.bus.line)) continue;
    tmp.set(delayMode ? delayColor(t.bus.delay, t.bus.live) : colorOf(t.bus.line));
    const chosen = t.bus.id === selected;
    const ground = kart?.heightAt(t.x, t.z) ?? 0;
    // Close to the camera the light gives way to the model of the bus, smoothly; the chosen bus keeps a small halo.
    const m = modelness(Math.hypot(camera.position.x - t.x, camera.position.y - ground, camera.position.z - t.z));
    const alpha = t.alpha * (t.bus.live ? 1 : 0.5);
    const size = (chosen ? BUS_SIZE * 1.8 : BUS_SIZE) * (1 - 0.92 * m);
    if (!riding && !controls.walking) buses.add(t.x, 6 + ground, t.z, tmp, chosen ? Math.max(size, 30) : size, alpha * (1 - (chosen ? 0.7 : 0.85) * m)); // from the seat or on foot the other buses do not glow, only the models close by show
    if (m > 0) {
      let pitch = 0;
      if (kart?.options.terrain) {
        const b = (t.bearing * Math.PI) / 180, hx = Math.sin(b) * BUS_LENGTH / 2, hz = -Math.cos(b) * BUS_LENGTH / 2;
        pitch = Math.atan2(kart.heightAt(t.x + hx, t.z + hz) - kart.heightAt(t.x - hx, t.z - hz), BUS_LENGTH);
      }
      busModels.add(t.x, ground + 0.2, t.z, t.bearing, pitch, tmp, m * Math.max(0.2, t.alpha), chosen ? 1.5 : 0.9);
    }
  }
  busModels.commit();
  buses.commit();
  mark.clear();
  if (pickedStop) {
    const [, lat, lon] = file.stops[pickedStop], x = toX(lon), z = toZ(lat);
    mark.add(x, stopHeight(x, z), z, tmp.set('#ffffff'), STOP_SIZE * 1.6 * Math.max(0.06, Math.min(1, controls.distance / 2500)), 1);
  }
  mark.commit();
  if (riding) {
    if (!ridden || ridden.leaving) ride(null);
    else controls.follow({ x: ridden.x, y: kart?.heightAt(ridden.x, ridden.z) ?? 0, z: ridden.z, bearing: ridden.bearing });
  }
  controls.update(dt);
  syncWalk();
  updateCursor(now);
  kart?.update(camera, controls.target, now);
  liftLines();
  keepAbove();
  weather.ease(dt);
  const cloud = weather.gloom;
  const light = lightAt(hour.time(), cloud);
  applyLight(light);
  applySnow(snowCover(weather.temp));
  (scene.fog as FogExp2).color.copy(light.skyHorizon);
  (scene.fog as FogExp2).density = 0.00001 + 0.00002 * cloud + 0.00007 * Math.min(1, weather.precip / 2);
  {
    // The drops fall in a box that follows the camera: close around the seat, and over the middle of what is looked at otherwise.
    const riding = controls.firstPerson;
    const box = riding ? 70 : Math.min(900, Math.max(100, controls.distance * 1.3));
    boxCenter.copy(camera.position);
    if (!riding) boxCenter.lerp(controls.target, 0.5);
    precip.update(now / 1000, boxCenter, box, weather.precip, weather.snow, weather.wind, (window.innerHeight * Math.min(window.devicePixelRatio, 2)) / (2 * Math.tan((camera.fov * Math.PI) / 360)));
  }
  busModels.setLight(light.ambient, light.sunLight, light.sunPower, light.sunDir);
  camera.updateMatrixWorld();
  sky.update(camera, light, cloud, now / 1000);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
