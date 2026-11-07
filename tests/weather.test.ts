import { describe, expect, it } from 'vitest';
import { reduceForecast } from '../src/shared/weather';

const forecast = {
  properties: {
    timeseries: [
      { time: '2026-11-07T15:00:00Z', data: { instant: { details: { cloud_area_fraction: 60.7, air_temperature: 1.4, wind_speed: 0.4 } }, next_1_hours: { summary: { symbol_code: 'partlycloudy_night' }, details: { precipitation_amount: 0 } } } },
      { time: '2026-11-07T16:00:00Z', data: { instant: { details: { cloud_area_fraction: 100, air_temperature: -2, wind_speed: 3 } }, next_1_hours: { summary: { symbol_code: 'snow' }, details: { precipitation_amount: 1.2 } } } },
      { time: '2026-11-07T17:00:00Z', data: { instant: { details: { cloud_area_fraction: 10 } }, next_6_hours: { details: { precipitation_amount: 3 } } } },
    ],
  },
};

describe('reduceForecast', () => {
  it('picks the hour that now falls in', () => {
    const w = reduceForecast(forecast, Date.parse('2026-11-07T16:20:00Z'))!;
    expect(w).toMatchObject({ cloud: 1, precip: 1.2, temp: -2, wind: 3, symbol: 'snow' });
    expect(reduceForecast(forecast, Date.parse('2026-11-07T15:10:00Z'))!.cloud).toBeCloseTo(0.607);
  });
  it('falls back to the first entry before the forecast starts, and to six-hour rain', () => {
    expect(reduceForecast(forecast, 0)!.at).toBe(Date.parse('2026-11-07T15:00:00Z'));
    expect(reduceForecast(forecast, Date.parse('2026-11-07T17:30:00Z'))!.precip).toBeCloseTo(0.5);
  });
  it('gives null for an answer it does not understand', () => {
    expect(reduceForecast({}, 0)).toBeNull();
    expect(reduceForecast({ properties: { timeseries: [] } }, 0)).toBeNull();
  });
});
