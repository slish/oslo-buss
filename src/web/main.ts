import { Color, FogExp2, GridHelper, Line, LineBasicMaterial, BufferGeometry, Float32BufferAttribute, PerspectiveCamera, Scene, Vector3, WebGLRenderer, AdditiveBlending } from 'three';
import { MapCamera } from './mapcamera';
import type { MapFile } from '../shared/map';
import { buildBuildings, buildRoads } from './basemap';
import { Glow } from './glow';
import { BusModels, BUS_LENGTH, modelness } from './busmodel';
import { BusStore, type Track } from './store';
import type { KartverketMap } from './kartverket';
import { colorOf, toX, toZ } from './world';
import { linesAt, lineInfo, nextDepartures } from '../shared/departures';
import { osloEpoch, osloTime } from '../shared/time';
import { SkyDome } from './sky';
import { applyLight, lightAt } from './daylight';
import { WeatherFeed } from './weather';
import { Precip } from './precip';

const BUS_SIZE = 420; // meters across on the ground
const STOP_SIZE = 70;
const FOV = 45;
const RIDE_FOV = 70; // from the seat: wide, like an eye, so that the road and the buildings along it are not squeezed

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const legendEl = document.querySelector<HTMLUListElement>('#legend')!;
const infoEl = document.querySelector<HTMLElement>('#info')!;

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
const shapeLines: { position: Float32BufferAttribute }[] = [];
const lineMaterials = new Map<string, LineBasicMaterial[]>();
const shapeIds: string[] = [];
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
  shapeLines.push({ position });
  shapeIds.push(id);
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
const buses = new Glow(512, 9);
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
flag('#opt-terreng', useTerrain, (p) => { if (useTerrain) p.delete('terreng'); else { p.set('kart', 'kartverket'); p.set('terreng', '1'); } });
document.querySelector<HTMLElement>('#credit-kartverket')!.hidden = !useKart;
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
// The sky follows the clock; ?tid=22:30 or the slider shows another hour of today. "No" lets it follow the clock again.
let skyTime: number | null = null;
const tidEl = document.querySelector<HTMLInputElement>('#tid')!;
const tidText = document.querySelector<HTMLElement>('#tid-text')!;
const tidNow = document.querySelector<HTMLButtonElement>('#tid-now')!;
function setHour(minutes: number | null): void {
  skyTime = minutes === null ? null : osloEpoch(osloTime(Date.now()).date, minutes * 60);
  showHour();
}
function showHour(): void {
  const t = osloTime(skyTime ?? Date.now());
  const minutes = Math.floor(t.secs / 60);
  if (skyTime === null) tidEl.value = String(minutes);
  tidText.textContent = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  tidNow.hidden = skyTime === null;
}
tidEl.addEventListener('input', () => setHour(Number(tidEl.value)));
tidNow.addEventListener('click', () => setHour(null));
{
  const m = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(location.search).get('tid') ?? '');
  if (m) { tidEl.value = String(Number(m[1]) * 60 + Number(m[2])); setHour(Number(tidEl.value)); } else showHour();
}
setInterval(() => { if (skyTime === null) showHour(); }, 30_000);
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
  const riding = controls.riding;
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
// The list of lines can be folded away; on a phone it starts folded, so it does not cover the map.
const legendBody = document.querySelector<HTMLElement>('#legend-body')!;
const legendToggle = document.querySelector<HTMLButtonElement>('#legend-toggle')!;
function foldLegend(fold: boolean): void {
  legendBody.hidden = fold;
  legendToggle.setAttribute('aria-expanded', String(!fold));
  legendToggle.querySelector('.arrow')!.textContent = fold ? '▸' : '▾';
}
legendToggle.addEventListener('click', () => foldLegend(!legendBody.hidden));
foldLegend(window.matchMedia('(max-width: 560px)').matches);
document.querySelector('#legend-count')!.textContent = '(' + file.lines.length + ')';
const hiddenLines = new Set<string>();
const legendItems = new Map<string, HTMLLIElement>();
function applyLineVisibility(): void {
  for (const [name, li] of legendItems) li.classList.toggle('off', hiddenLines.has(name));
  for (const [name, materials] of lineMaterials) for (const material of materials) material.visible = !hiddenLines.has(name);
  if (selected && hiddenLines.has(store.tracks.get(selected)?.bus.line ?? '')) choose({});
}
document.querySelector('#lines-all')!.addEventListener('click', () => { hiddenLines.clear(); applyLineVisibility(); });
document.querySelector('#lines-none')!.addEventListener('click', () => { for (const l of file.lines) hiddenLines.add(l.name); applyLineVisibility(); });
for (const line of [...file.lines].sort((a, b) => parseInt(a.name) - parseInt(b.name) || a.name.localeCompare(b.name))) {
  const li = document.createElement('li');
  li.title = 'Klikk for å skjule eller vise linja';
  li.addEventListener('click', () => { if (hiddenLines.has(line.name)) hiddenLines.delete(line.name); else hiddenLines.add(line.name); applyLineVisibility(); });
  legendItems.set(line.name, li);
  li.style.color = colorOf(line.name);
  li.innerHTML = `<span class="dot"></span><span class="name"></span><span class="long"></span>`;
  li.querySelector('.name')!.textContent = line.name;
  li.querySelector('.long')!.textContent = line.long;
  legendEl.append(li);
}

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
  for (const road of roads) road.visible = !id; // from the seat the colored lines and the glowing stops are only noise
  stops.points.visible = mark.points.visible = !id;
  kart?.setRide(!!id);
  if (!id) controls.follow(null);
  showInfo();
}
addEventListener('keydown', (e) => { if (e.key === 'Escape' && riding) ride(null); });
const screen = new Vector3();
function busAt(clientX: number, clientY: number): Track | null {
  let best: Track | null = null, bestD = 18; // pixels
  for (const t of store.tracks.values()) {
    if (t.leaving || hiddenLines.has(t.bus.line)) continue;
    screen.set(t.x, (kart?.heightAt(t.x, t.z) ?? 0) + 3, t.z).project(camera);
    if (screen.z > 1) continue;
    const d = Math.hypot((screen.x * 0.5 + 0.5) * window.innerWidth - clientX, (-screen.y * 0.5 + 0.5) * window.innerHeight - clientY);
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}
const stopHeight = (x: number, z: number) => (kart?.heightAt(x, z) ?? 0) + 3;
function stopAt(clientX: number, clientY: number): string | null {
  let best: string | null = null, bestD = 16;
  stopXZ.forEach(([x, z], i) => {
    screen.set(x, stopHeight(x, z), z).project(camera);
    if (screen.z > 1) return;
    const d = Math.hypot((screen.x * 0.5 + 0.5) * window.innerWidth - clientX, (-screen.y * 0.5 + 0.5) * window.innerHeight - clientY);
    if (d < bestD) { best = stopIds[i]; bestD = d; }
  });
  return best;
}
/** The line whose road passes nearest the pointer on the screen. Only on a click: it projects every point of every road. */
function lineAt(clientX: number, clientY: number): string | null {
  let best: string | null = null, bestD = 10;
  shapeLines.forEach(({ position }, s) => {
    let px = 0, py = 0, ok = false;
    for (let i = 0; i < position.count; i++) {
      screen.set(position.getX(i), position.getY(i), position.getZ(i)).project(camera);
      const x = (screen.x * 0.5 + 0.5) * window.innerWidth, y = (-screen.y * 0.5 + 0.5) * window.innerHeight, behind = screen.z > 1;
      if (ok && !behind) {
        const dx = x - px, dy = y - py, len2 = dx * dx + dy * dy;
        const f = len2 > 0 ? Math.max(0, Math.min(1, ((clientX - px) * dx + (clientY - py) * dy) / len2)) : 0;
        const d = Math.hypot(clientX - (px + f * dx), clientY - (py + f * dy));
        if (d < bestD) { bestD = d; best = lineOfShape.get(shapeIds[s]) ?? null; }
      }
      px = x; py = y; ok = !behind;
    }
  });
  return best;
}
let down: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (riding || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
  const bus = busAt(e.clientX, e.clientY);
  if (bus) return choose({ bus: bus.bus.id });
  const stop = stopAt(e.clientX, e.clientY);
  if (stop) return choose({ stop });
  const line = lineAt(e.clientX, e.clientY);
  choose(line ? { line } : {});
});
canvas.addEventListener('pointermove', (e) => { canvas.style.cursor = busAt(e.clientX, e.clientY) || stopAt(e.clientX, e.clientY) ? 'pointer' : 'grab'; });

function delayText(delay: number): { text: string; cls: string } {
  if (delay >= 60) return { text: `${Math.round(delay / 60)} min sein`, cls: 'late' };
  if (delay <= -60) return { text: `${Math.round(-delay / 60)} min tidleg`, cls: 'early' };
  return { text: 'i rute', cls: '' };
}

function clock(ms: number): string { return new Date(ms).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }); }
function add(parent: HTMLElement, cls: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = cls; el.textContent = text;
  parent.append(el);
  return el;
}
function part(cls: string, text: string, color?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = cls; el.textContent = text;
  if (color) el.style.color = color;
  return el;
}
function showStopInfo(id: string): void {
  infoEl.hidden = false;
  infoEl.replaceChildren();
  add(infoEl, 'head', '').append(part('to', file.stops[id][0]));
  add(infoEl, 'row', 'Haldeplass · linjer: ' + (linesAt(store.timetable, id).join(', ') || 'ingen'));
  const delays = new Map([...store.tracks.values()].map((t) => [t.bus.id, t.bus.delay] as const));
  const departures = nextDepartures(store.timetable, id, Date.now(), delays, 6);
  if (!departures.length) add(infoEl, 'row', 'Ingen avgangar dei neste timane.');
  for (const d of departures) {
    const row = add(infoEl, 'row dep', '');
    row.append(part('time', clock(d.at)), ' ', part('line', d.line, colorOf(d.line)), ' mot ' + d.headsign);
    if (d.delay !== null && Math.abs(d.delay) >= 60) row.append(part(d.delay > 0 ? 'late' : 'early', ' (' + delayText(d.delay).text + ')'));
  }
  add(infoEl, 'row source', 'Berre linjene i kartet. Tider etter rutetabell, med forseinking for bussar vi ser på vegen.');
}
function showLineInfo(name: string): void {
  const info = lineInfo(store.timetable, name, Date.now());
  if (!info) { infoEl.hidden = true; return; }
  infoEl.hidden = false;
  infoEl.replaceChildren();
  add(infoEl, 'head', '').append(part('badge', name, colorOf(name)), part('to', info.long));
  add(infoEl, 'row', 'Mot ' + info.headsigns.join(' og '));
  const running = [...store.tracks.values()].filter((t) => !t.leaving && t.bus.line === name).length;
  add(infoEl, 'row', running + ' bussar på vegen no');
  add(infoEl, 'row', info.trips ? 'I dag: ' + info.trips + ' turar, første ' + clock(info.first!) + ', siste framme ' + clock(info.last!) : 'Ingen turar i dag');
  add(infoEl, 'row', 'Neste time: ' + info.nextHour + ' avgangar');
}

function showInfo(): void {
  if (pickedStop) return showStopInfo(pickedStop);
  if (pickedLine) return showLineInfo(pickedLine);
  const t = selected ? store.tracks.get(selected) : undefined;
  if (!t) { selected = null; infoEl.hidden = true; return; }
  const b = t.bus, d = delayText(b.delay);
  infoEl.hidden = false;
  infoEl.innerHTML = `
    <div class="head"><span class="badge" style="color:${colorOf(b.line)}"></span><span class="to"></span></div>
    <div class="row"><b class="where"></b></div>
    <div class="row">Forseinking: <b class="delay ${d.cls}"></b></div>
    <div class="row source"></div>
    <button id="ride" type="button"></button>`;
  const rideButton = infoEl.querySelector<HTMLButtonElement>('#ride')!;
  rideButton.textContent = riding === b.id ? 'Gå av bussen' : 'Sitt på bussen';
  rideButton.addEventListener('click', () => ride(riding === b.id ? null : b.id));
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
  if (selected || pickedStop || pickedLine) showInfo();
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
    if (hiddenLines.has(t.bus.line)) continue;
    tmp.set(colorOf(t.bus.line));
    const chosen = t.bus.id === selected;
    const ground = kart?.heightAt(t.x, t.z) ?? 0;
    // Close to the camera the light gives way to the model of the bus, smoothly; the chosen bus keeps a small halo.
    const m = modelness(Math.hypot(camera.position.x - t.x, camera.position.y - ground, camera.position.z - t.z));
    const alpha = t.alpha * (t.bus.live ? 1 : 0.5);
    const size = (chosen ? BUS_SIZE * 1.8 : BUS_SIZE) * (1 - 0.92 * m);
    if (!riding) buses.add(t.x, 6 + ground, t.z, tmp, chosen ? Math.max(size, 30) : size, alpha * (1 - (chosen ? 0.7 : 0.85) * m)); // from the seat the other buses do not glow, only the models close by show
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
  kart?.update(camera, controls.target, now);
  liftLines();
  keepAbove();
  weather.ease(dt);
  const cloud = weather.gloom;
  const light = lightAt(skyTime ?? Date.now(), cloud);
  applyLight(light);
  (scene.fog as FogExp2).color.copy(light.skyHorizon);
  (scene.fog as FogExp2).density = 0.00001 + 0.00002 * cloud + 0.00007 * Math.min(1, weather.precip / 2);
  {
    // The drops fall in a box that follows the camera: close around the seat, and over the middle of what is looked at otherwise.
    const riding = controls.riding;
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
