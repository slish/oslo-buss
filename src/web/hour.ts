// The hour the sky shows: the clock by default; ?tid=22:30 or the slider shows another hour of today, and "No" goes back to the clock.

import { osloEpoch, osloTime } from '../shared/time';

export class HourControl {
  private chosen: number | null = null; // ms since 1970 of the chosen hour, or null for the clock
  private readonly slider = document.querySelector<HTMLInputElement>('#tid')!;
  private readonly text = document.querySelector<HTMLElement>('#tid-text')!;
  private readonly now = document.querySelector<HTMLButtonElement>('#tid-now')!;

  constructor(param: string | null) {
    this.slider.addEventListener('input', () => this.set(Number(this.slider.value)));
    this.now.addEventListener('click', () => this.set(null));
    const m = /^(\d{1,2}):(\d{2})$/.exec(param ?? '');
    if (m) this.set(Number(m[1]) * 60 + Number(m[2]));
    else this.show();
    setInterval(() => { if (this.chosen === null) this.show(); }, 30_000);
  }

  /** The time to light the world for, ms since 1970. */
  time(): number { return this.chosen ?? Date.now(); }

  private set(minutes: number | null): void {
    this.chosen = minutes === null ? null : osloEpoch(osloTime(Date.now()).date, minutes * 60);
    if (minutes !== null) this.slider.value = String(minutes);
    this.show();
  }

  private show(): void {
    const minutes = Math.floor(osloTime(this.time()).secs / 60);
    if (this.chosen === null) this.slider.value = String(minutes);
    this.text.textContent = String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
    this.now.hidden = this.chosen === null;
  }
}
