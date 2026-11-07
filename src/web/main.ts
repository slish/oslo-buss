import { Color, GridHelper, Line, LineBasicMaterial, BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Scene, Vector3, WebGLRenderer, AdditiveBlending } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MapFile } from '../shared/map';
import { buildBuildings, buildRoads } from './basemap';
import { Glow } from './glow';
import { BusModels, BUS_LENGTH, modelness } from './busmodel';
import { BusStore, type Track } from './store';
import type { KartverketMap } from './kartverket';
import { colorOf, toX, toZ } from './world';

const BUS_SIZE = 420; // meters across on the ground
const STOP_SIZE = 70;
const FOV = 45;

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const legendEl = document.querySelector<HTMLUListElement>('#legend')!;
const infoEl = document.querySelector<HTMLElement>('#info')!;

const renderer = new WebGLRenderer({ canvas, antialias: true });
const scene = new Scene();
scene.background = new Color('#05070d');
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
const shapeLines: { position: Float32BufferAttribute }[] = [];
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
  shapeLines.push({ position });
  const material = new LineBasicMaterial({ color: colorOf(lineOfShape.get(id) ?? ''), transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, depthTest: false });
  const road = new Line(geometry, material);
  road.renderOrder = 1; // after the map, whatever the buildings in between: the lights show through
  scene.add(road);
}

const grid = new GridHelper(80_000, 80, '#16203a', '#0c1424');
grid.position.set((minX + maxX) / 2, -2, (minZ + maxZ) / 2);
scene.add(grid);

const stops = new Glow(Object.keys(file.stops).length, 2);
const stopColor = new Color('#7d8aa3');
const stopXZ = Object.values(file.stops).map(([, lat, lon]) => [toX(lon), toZ(lat)] as const);
const placeStops = (height: (x: number, z: number) => number) => {
  stops.clear();
  for (const [x, z] of stopXZ) stops.add(x, height(x, z), z, stopColor, STOP_SIZE, 0.55);
  stops.commit();
};
placeStops(() => 0);
stops.points.renderOrder = 2;
scene.add(stops.points);

const buses = new Glow(512, 9);
buses.points.renderOrder = 3;
scene.add(buses.points);
const busModels = new BusModels(scene);

// ---- the map under it all: roads and buildings from OpenStreetMap, loaded once the lights are on ----
// ?kart=kartverket draws Kartverket's tiles instead (dev server only, see docs/KARTVERKET.md); &terreng=1 follows the terrain.
const params = new URLSearchParams(location.search);
let kart: KartverketMap | undefined;
if (params.get('kart') === 'kartverket') {
  void (async () => {
    try {
      const { KartverketMap } = await import('./kartverket');
      const k = new KartverketMap({ terrain: params.get('terreng') === '1' });
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

// ---- camera ----
const center = new Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
const span = Math.max(maxX - minX, maxZ - minZ);
camera.position.set(center.x, span * 0.95, center.z + span * 0.75);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(center);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495; // almost down to the horizon
controls.minDistance = 20; // close to the ground, where the buses are models
controls.zoomToCursor = true;
controls.maxDistance = 120_000;
controls.update();
// For looking at the scene from the console while developing: window.__oslo.camera, .controls, .toX, .toZ.
if (import.meta.env.DEV) Object.assign(window, { __oslo: { camera, controls, toX, toZ, store } });

/** Keeps the camera and its target above the ground (the terrain with ?terreng=1), and near/far in proportion to the distance, so that nothing is clipped close up. */
let nearNow = 0, farNow = 0;
let stopShrink = 1; // the markers of the stops are 70 m discs: close up they shrink with the distance, so they do not cover the street
function keepAbove(): void {
  const ground = (x: number, z: number) => kart?.heightAt(x, z) ?? 0;
  const lift = Math.max(0, ground(controls.target.x, controls.target.z) - controls.target.y);
  if (lift > 0) { controls.target.y += lift; camera.position.y += lift; }
  const low = ground(camera.position.x, camera.position.z) + 2.5 - camera.position.y;
  if (low > 0) camera.position.y += low;
  const dist = camera.position.distanceTo(controls.target);
  const shrink = Math.min(1, Math.max(0.06, dist / 2500));
  if (Math.abs(shrink - stopShrink) > 0.01) { stopShrink = shrink; resize(); }
  const near = Math.min(100, Math.max(0.5, dist * 0.01)), far = Math.min(400_000, Math.max(20_000, dist * 8));
  if (Math.abs(near / nearNow - 1) > 0.03 || Math.abs(far / farNow - 1) > 0.03) {
    nearNow = camera.near = near; farNow = camera.far = far;
    camera.updateProjectionMatrix();
  }
}

function resize(): void {
  const ratio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(ratio);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  const pixelsPerMeter = (window.innerHeight * ratio) / (2 * Math.tan((FOV * Math.PI) / 360));
  buses.setScale(pixelsPerMeter, ratio, 9);
  stops.setScale(pixelsPerMeter * stopShrink, ratio, 2);
}
window.addEventListener('resize', resize);
resize();

// ---- legend ----
for (const line of file.lines) {
  const li = document.createElement('li');
  li.style.color = colorOf(line.name);
  li.innerHTML = `<span class="dot"></span><span class="name"></span><span class="long"></span>`;
  li.querySelector('.name')!.textContent = line.name;
  li.querySelector('.long')!.textContent = line.long;
  legendEl.append(li);
}

// ---- picking: the bus nearest the pointer on the screen ----
let selected: string | null = null;
const screen = new Vector3();
function busAt(clientX: number, clientY: number): Track | null {
  let best: Track | null = null, bestD = 18; // pixels
  for (const t of store.tracks.values()) {
    if (t.leaving) continue;
    screen.set(t.x, (kart?.heightAt(t.x, t.z) ?? 0) + 3, t.z).project(camera);
    if (screen.z > 1) continue;
    const d = Math.hypot((screen.x * 0.5 + 0.5) * window.innerWidth - clientX, (-screen.y * 0.5 + 0.5) * window.innerHeight - clientY);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  selected = busAt(e.clientX, e.clientY)?.bus.id ?? null;
  showInfo();
});
canvas.addEventListener('pointermove', (e) => { canvas.style.cursor = busAt(e.clientX, e.clientY) ? 'pointer' : 'grab'; });

function delayText(delay: number): { text: string; cls: string } {
  if (delay >= 60) return { text: `${Math.round(delay / 60)} min sein`, cls: 'late' };
  if (delay <= -60) return { text: `${Math.round(-delay / 60)} min tidleg`, cls: 'early' };
  return { text: 'i rute', cls: '' };
}

function showInfo(): void {
  const t = selected ? store.tracks.get(selected) : undefined;
  if (!t) { selected = null; infoEl.hidden = true; return; }
  const b = t.bus, d = delayText(b.delay);
  infoEl.hidden = false;
  infoEl.innerHTML = `
    <div class="head"><span class="badge" style="color:${colorOf(b.line)}"></span><span class="to"></span></div>
    <div class="row"><b class="where"></b></div>
    <div class="row">Forseinking: <b class="delay ${d.cls}"></b></div>
    <div class="row source"></div>`;
  infoEl.querySelector('.badge')!.textContent = b.line;
  infoEl.querySelector('.to')!.textContent = `mot ${b.headsign}`;
  infoEl.querySelector('.where')!.textContent = `${b.atStop ? 'Ved' : 'På veg til'} ${b.next}`;
  infoEl.querySelector('.delay')!.textContent = d.text;
  infoEl.querySelector('.source')!.textContent = b.live ? 'Sanntid frå Entur' : 'Etter rutetabell (ingen sanntidsdata)';
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
  if (selected) showInfo();
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
  for (const t of store.tracks.values()) {
    tmp.set(colorOf(t.bus.line));
    const chosen = t.bus.id === selected;
    const ground = kart?.heightAt(t.x, t.z) ?? 0;
    // Close to the camera the light gives way to the model of the bus, smoothly; the chosen bus keeps a small halo.
    const m = modelness(Math.hypot(camera.position.x - t.x, camera.position.y - ground, camera.position.z - t.z));
    const alpha = t.alpha * (t.bus.live ? 1 : 0.5);
    const size = (chosen ? BUS_SIZE * 1.8 : BUS_SIZE) * (1 - 0.92 * m);
    buses.add(t.x, 6 + ground, t.z, tmp, chosen ? Math.max(size, 30) : size, alpha * (1 - (chosen ? 0.7 : 0.85) * m));
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
  controls.update();
  kart?.update(camera, controls.target, now);
  liftLines();
  keepAbove();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
