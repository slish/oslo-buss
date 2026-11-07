// The weather in the page: fetched from /feeds/weather every half hour and eased toward, so that a new number does not make the
// sky jump. ?vaer=klart|sky|regn|sno|kulde sets a weather by hand, to look at it when the real one is dull.

import type { Weather } from '../shared/weather';

const HAND: Record<string, Pick<Weather, 'cloud' | 'precip' | 'temp' | 'wind'>> = {
  klart: { cloud: 0, precip: 0, temp: 8, wind: 1 },
  sky: { cloud: 0.8, precip: 0, temp: 6, wind: 3 },
  regn: { cloud: 1, precip: 3, temp: 8, wind: 5 },
  sno: { cloud: 1, precip: 2.5, temp: -3, wind: 2 },
  kulde: { cloud: 0.15, precip: 0, temp: -12, wind: 1 },
};

export class WeatherFeed {
  /** What the sky is drawn with now: they move toward the target. */
  cloud = 0.25; precip = 0; temp = 5; wind = 1;
  private target: Pick<Weather, 'cloud' | 'precip' | 'temp' | 'wind'> | null = null;
  /** The credit line wants to know whether any weather has been read. */
  loaded = false;

  constructor(hand: string | null) {
    if (hand && HAND[hand]) {
      this.target = HAND[hand];
      this.loaded = true;
      Object.assign(this, HAND[hand]); // by hand it starts there
    } else {
      void this.load();
      setInterval(() => void this.load(), 30 * 60_000);
    }
  }

  private async load(): Promise<void> {
    try {
      const response = await fetch('/feeds/weather');
      if (!response.ok) return;
      this.target = (await response.json()) as Weather;
      this.loaded = true;
    } catch {
      // No weather is fine: the sky stays as it was.
    }
  }

  /** Rain or snow: by the temperature, with a stretch of sleet where both fall. 0 is all rain, 1 all snow. */
  get snow(): number { return Math.min(1, Math.max(0, (2.5 - this.temp) / 3)); }
  /** How cloudy the sky looks: rain makes it heavier than the cover says. */
  get gloom(): number { return Math.min(1, this.cloud + 0.35 * Math.min(1, this.precip)); }

  ease(dt: number): void {
    const t = this.target;
    if (!t) return;
    const k = 1 - Math.exp(-dt / 8); // about eight seconds
    this.cloud += (t.cloud - this.cloud) * k;
    this.precip += (t.precip - this.precip) * k;
    this.temp += (t.temp - this.temp) * k;
    this.wind += (t.wind - this.wind) * k;
  }
}
