// The panel that tells about what was clicked: a bus, a stop (the next departures) or a line.

import { linesAt, lineInfo, nextDepartures } from '../shared/departures';
import { delayLabel, summarize } from './delay';
import type { BusStore } from './store';
import { colorOf } from './world';

export interface Selection { bus: string | null; stop: string | null; line: string | null }

function delayText(delay: number): { text: string; cls: string } {
  if (delay >= 60) return { text: `${Math.round(delay / 60)} min sein`, cls: 'late' };
  if (delay <= -60) return { text: `${Math.round(-delay / 60)} min tidleg`, cls: 'early' };
  return { text: 'i rute', cls: '' };
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });

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

export class InfoPanel {
  private readonly el = document.querySelector<HTMLElement>('#info')!;

  /** `onRide` is called with the bus to sit on, or null to get off. */
  constructor(private readonly store: BusStore, private readonly delayMode: boolean, private readonly onRide: (id: string | null) => void) {}

  /** Shows the stop, else the line, else the bus; hides the panel when none of them is there. `riding` is the bus we sit on, if any. */
  show(sel: Selection, riding: string | null): void {
    if (sel.stop) return this.stop(sel.stop);
    if (sel.line) return this.line(sel.line);
    const track = sel.bus ? this.store.tracks.get(sel.bus) : undefined;
    if (!track) { this.el.hidden = true; return; }
    this.bus(track.bus, riding === track.bus.id);
  }

  private stop(id: string): void {
    const { store, el } = this;
    el.hidden = false;
    el.replaceChildren();
    add(el, 'head', '').append(part('to', store.timetable.file.stops[id][0]));
    add(el, 'row', 'Haldeplass · linjer: ' + (linesAt(store.timetable, id).join(', ') || 'ingen'));
    const delays = new Map([...store.tracks.values()].map((t) => [t.bus.id, t.bus.delay] as const));
    const departures = nextDepartures(store.timetable, id, Date.now(), delays, 6);
    if (!departures.length) add(el, 'row', 'Ingen avgangar dei neste timane.');
    for (const d of departures) {
      const row = add(el, 'row dep', '');
      row.append(part('time', clock(d.at)), ' ', part('line', d.line, colorOf(d.line)), ' mot ' + d.headsign);
      if (d.delay !== null && Math.abs(d.delay) >= 60) row.append(part(d.delay > 0 ? 'late' : 'early', ' (' + delayText(d.delay).text + ')'));
    }
    add(el, 'row source', 'Berre linjene i kartet. Tider etter rutetabell, med forseinking for bussar vi ser på vegen.');
  }

  private line(name: string): void {
    const { store, el } = this;
    const info = lineInfo(store.timetable, name, Date.now());
    if (!info) { el.hidden = true; return; }
    el.hidden = false;
    el.replaceChildren();
    add(el, 'head', '').append(part('badge', name, colorOf(name)), part('to', info.long));
    add(el, 'row', 'Mot ' + info.headsigns.join(' og '));
    const running = [...store.tracks.values()].filter((t) => !t.leaving && t.bus.line === name);
    add(el, 'row', running.length + ' bussar på vegen no');
    if (this.delayMode) {
      const s = summarize(running.map((t) => t.bus));
      add(el, 'row', s.mean === null ? 'Gjennomsnittleg forseinking: ingen sanntidsdata' : `Gjennomsnittleg forseinking: ${delayLabel(s.mean)} (${s.measured} av ${s.total} bussar målt)`);
    }
    add(el, 'row', info.trips ? 'I dag: ' + info.trips + ' turar, første ' + clock(info.first!) + ', siste framme ' + clock(info.last!) : 'Ingen turar i dag');
    add(el, 'row', 'Neste time: ' + info.nextHour + ' avgangar');
  }

  private bus(b: { id: string; line: string; headsign: string; next: string; atStop: boolean; delay: number; live: boolean }, riding: boolean): void {
    const { el } = this;
    const d = delayText(b.delay);
    el.hidden = false;
    el.innerHTML = `
    <div class="head"><span class="badge" style="color:${colorOf(b.line)}"></span><span class="to"></span></div>
    <div class="row"><b class="where"></b></div>
    <div class="row">Forseinking: <b class="delay ${d.cls}"></b></div>
    <div class="row source"></div>
    <button id="ride" type="button"></button>`;
    const rideButton = el.querySelector<HTMLButtonElement>('#ride')!;
    rideButton.textContent = riding ? 'Gå av bussen' : 'Sitt på bussen';
    rideButton.addEventListener('click', () => this.onRide(riding ? null : b.id));
    el.querySelector('.badge')!.textContent = b.line;
    el.querySelector('.to')!.textContent = `mot ${b.headsign}`;
    el.querySelector('.where')!.textContent = `${b.atStop ? 'Ved' : 'På veg til'} ${b.next}`;
    el.querySelector('.delay')!.textContent = d.text;
    el.querySelector('.source')!.textContent = b.live ? 'Forseinking frå Entur sanntid, posisjon berekna etter rutetabell' : 'Etter rutetabell (ingen sanntidsdata)';
  }
}
