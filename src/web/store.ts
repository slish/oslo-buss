// The browser's copy of the buses. The relay answers every 15 s with where each bus is, how fast it goes and where it
// stops; between answers the bus keeps moving along its road, and a new answer only pulls it gently to where it really is.

import type { Bus } from '../shared/position';
import { placeOnShape } from '../shared/position';
import type { BusAnswer } from '../relay/buses';
import { Timetable, type Shape, type TimetableFile } from '../shared/timetable';
import { toX, toZ } from './world';

const POLL_MS = 15_000;

export interface Track {
  bus: Bus;
  shape: Shape;
  /** Meters along the road as shown, which follows the predicted value smoothly. */
  shown: number;
  x: number;
  z: number;
  bearing: number;
  /** 0 to 1: buses fade in when they appear and out when they leave. */
  alpha: number;
  leaving: boolean;
}

export class BusStore {
  readonly tracks = new Map<string, Track>();
  timetable!: Timetable;
  /** Server time of the last answer, and server time minus our clock, both ms. */
  answerAt = 0;
  skew = 0;
  updatedAt = 0;
  stale = false;
  error: string | null = null;
  onChange: () => void = () => {};

  async load(): Promise<void> {
    const response = await fetch('/data/timetable.json');
    if (!response.ok) throw new Error(`Fann ikkje tidstabellen (${response.status}). Køyr npm run timetable.`);
    this.timetable = new Timetable((await response.json()) as TimetableFile);
  }

  start(): void {
    const poll = async () => {
      try {
        const sent = Date.now();
        const response = await fetch('/feeds/buses');
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? `Relay ${response.status}`);
        this.accept(body as BusAnswer, (sent + Date.now()) / 2);
        this.error = null;
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      }
      this.onChange();
    };
    void poll();
    setInterval(poll, POLL_MS);
  }

  private accept(answer: BusAnswer, receivedAt: number): void {
    this.answerAt = answer.at;
    this.skew = answer.at - receivedAt;
    this.updatedAt = answer.updatedAt;
    this.stale = answer.stale;
    const seen = new Set<string>();
    for (const bus of answer.buses) {
      const shape = this.timetable.shapes.get(bus.shape);
      if (!shape) continue;
      seen.add(bus.id);
      const t = this.tracks.get(bus.id);
      if (t) { t.bus = bus; t.shape = shape; t.leaving = false; }
      else this.tracks.set(bus.id, { bus, shape, shown: this.predict(bus, answer.at), x: 0, z: 0, bearing: bus.bearing, alpha: 0, leaving: false });
    }
    for (const [id, t] of this.tracks) if (!seen.has(id)) t.leaving = true;
  }

  /** Where along the road the bus should be now, from its last answer. It stops at the next stop, if not before. */
  private predict(bus: Bus, answerAt: number): number {
    const serverNow = Date.now() + this.skew;
    const d = bus.dist + bus.speed * Math.max(0, (serverNow - answerAt) / 1000);
    return Math.min(d, Math.max(bus.until, bus.dist));
  }

  /** Moves every bus on by `dt` seconds. */
  tick(dt: number): void {
    const follow = 1 - Math.exp(-dt * 2.5);
    const fade = dt / 0.6;
    for (const [id, t] of this.tracks) {
      t.shown += (this.predict(t.bus, this.answerAt) - t.shown) * follow;
      const place = placeOnShape(t.shape, t.shown);
      t.x = toX(place.lon);
      t.z = toZ(place.lat);
      // Heading from the road 10 m behind to 10 m ahead, so a corner is turned over some 20 m of road, not in one frame; then eased a little in time.
      const back = placeOnShape(t.shape, t.shown - 10), ahead = placeOnShape(t.shape, t.shown + 10);
      const dx = toX(ahead.lon) - toX(back.lon), dz = toZ(ahead.lat) - toZ(back.lat);
      const target = Math.hypot(dx, dz) > 1 ? (Math.atan2(dx, -dz) * 180) / Math.PI : place.bearing;
      const turn = ((target - t.bearing + 540) % 360) - 180; // the short way round
      t.bearing = (t.bearing + turn * (1 - Math.exp(-dt * 6)) + 360) % 360;
      t.alpha = t.leaving ? t.alpha - fade : Math.min(1, t.alpha + fade);
      if (t.leaving && t.alpha <= 0) this.tracks.delete(id);
    }
  }
}
