// The weather of the moment, from MET Norway's forecast for the place (locationforecast 2.0, compact): only the few numbers
// the sky needs. Data from MET Norway under CC BY 4.0 and NLOD 2.0.

export interface Weather {
  /** The time the numbers are for (ms since 1970). */
  at: number;
  /** Cloud cover, 0 clear to 1 overcast. */
  cloud: number;
  /** Rain or snow in mm of water an hour. */
  precip: number;
  /** Air temperature in degrees Celsius, wind in m/s. */
  temp: number; wind: number;
  symbol: string;
}

interface Series { time: string; data: { instant?: { details?: Record<string, number> }; next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } }; next_6_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } } } }

export const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=59.9139&lon=10.7522';
/** MET asks for a name of the application and where to reach its maker on every request. */
export const MET_USER_AGENT = 'slish-oslo-buss github.com/slish/oslo-buss';

/** The entry of the forecast that `now` falls in, reduced to a Weather; null if the answer is not what we expect. */
export function reduceForecast(json: unknown, now: number): Weather | null {
  const series = (json as { properties?: { timeseries?: Series[] } })?.properties?.timeseries;
  if (!Array.isArray(series) || !series.length) return null;
  let pick = series[0];
  for (const s of series) { if (Date.parse(s.time) <= now) pick = s; else break; }
  const d = pick.data?.instant?.details;
  if (!d) return null;
  const hour = pick.data.next_1_hours, six = pick.data.next_6_hours;
  const precip = hour?.details?.precipitation_amount ?? (six?.details?.precipitation_amount !== undefined ? six.details.precipitation_amount / 6 : 0);
  return {
    at: Date.parse(pick.time),
    cloud: Math.min(1, Math.max(0, (d.cloud_area_fraction ?? 0) / 100)),
    precip: Math.max(0, precip),
    temp: d.air_temperature ?? 0,
    wind: d.wind_speed ?? 0,
    symbol: hour?.summary?.symbol_code ?? six?.summary?.symbol_code ?? '',
  };
}
