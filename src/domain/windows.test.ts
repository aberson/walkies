import { scanWindows } from './windows';
import type {
  AirQuality,
  DogProfile,
  GeoPoint,
  WeatherSnapshot,
} from './types';

function dog(overrides: Partial<DogProfile> = {}): DogProfile {
  return {
    name: 'Test',
    breed: 'Mixed breed',
    brachycephalic: false,
    ageMonths: 36,
    size: 'medium',
    bodyCondition: 'ideal',
    coat: 'short',
    darkCoat: false,
    conditions: ['none'],
    schemaVersion: 1,
    ...overrides,
  };
}

// Night-time location/times so sunFactor ≈ 0 and pavement = air temp; this lets
// us drive the verdict purely via air temperature for a deterministic series.
const LOCATION: GeoPoint = { lat: 37.7, lon: -97.3 };
const noAqi: AirQuality = { usAqi: null };

function hourAt(hourUTC: number, airTempF: number): WeatherSnapshot {
  return {
    // Use UTC small-hours (local night) so the sun is down → sunFactor 0.
    startTime: new Date(Date.UTC(2025, 5, 21, hourUTC, 0, 0)).toISOString(),
    airTempF,
    relativeHumidity: 30,
    windSpeedMph: 5,
    skyCoverPct: 0,
    precipProbability: 0,
    isDaytime: false,
  };
}

describe('scanWindows', () => {
  it('returns contiguous green/yellow runs split by red hours', () => {
    // Series (air temp °F), all at night (no sun, no AQI):
    //   green, green, RED(hot), RED(hot), green, green
    // Use very hot air to trigger the heat backstop (airTemp+RH>=150) → red.
    const hours: WeatherSnapshot[] = [
      hourAt(6, 65), // green
      hourAt(7, 66), // green
      hourAt(8, 130), // red (130+30=160 backstop, HI very high)
      hourAt(9, 128), // red
      hourAt(10, 64), // green
      hourAt(11, 63), // green
    ];

    const { hourlyVerdicts, windows } = scanWindows({
      hours,
      airQuality: noAqi,
      alerts: [],
      profile: dog(),
      location: LOCATION,
    });

    expect(hourlyVerdicts).toHaveLength(6);
    expect(hourlyVerdicts[2].level).toBe('red');
    expect(hourlyVerdicts[3].level).toBe('red');

    // Two windows: [0..1] and [4..5].
    expect(windows).toHaveLength(2);
    expect(windows[0].startIndex).toBe(0);
    expect(windows[0].endIndex).toBe(1);
    expect(windows[1].startIndex).toBe(4);
    expect(windows[1].endIndex).toBe(5);
  });

  it('a yellow hour inside a run makes the whole window yellow', () => {
    const hours: WeatherSnapshot[] = [
      hourAt(6, 65), // green
      hourAt(7, 28), // yellow for a small/short-coat dog (cold)
      hourAt(8, 65), // green
    ];
    const { windows } = scanWindows({
      hours,
      airQuality: noAqi,
      alerts: [],
      profile: dog({ size: 'small', coat: 'short' }),
      location: LOCATION,
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].level).toBe('yellow');
    expect(windows[0].startIndex).toBe(0);
    expect(windows[0].endIndex).toBe(2);
  });

  it('caps the scan at 12 hours', () => {
    const hours: WeatherSnapshot[] = Array.from({ length: 18 }, (_, i) =>
      hourAt((i % 24) + 1, 65),
    );
    const { hourlyVerdicts } = scanWindows({
      hours,
      airQuality: noAqi,
      alerts: [],
      profile: dog(),
      location: LOCATION,
    });
    expect(hourlyVerdicts).toHaveLength(12);
  });

  it('returns no windows when every hour is red', () => {
    const hours: WeatherSnapshot[] = [
      hourAt(6, 130),
      hourAt(7, 131),
      hourAt(8, 132),
    ];
    const { windows } = scanWindows({
      hours,
      airQuality: noAqi,
      alerts: [],
      profile: dog(),
      location: LOCATION,
    });
    expect(windows).toHaveLength(0);
  });

  it('each window carries a human start label', () => {
    const hours: WeatherSnapshot[] = [hourAt(6, 65), hourAt(7, 65)];
    const { windows } = scanWindows({
      hours,
      airQuality: noAqi,
      alerts: [],
      profile: dog(),
      location: LOCATION,
    });
    expect(windows[0].label).toMatch(/after /i);
  });

  it('an invalid startTime yields a FINITE pavementTempF — no NaN in the Verdict', () => {
    // A malformed startTime would make sunFactor NaN if unguarded, flowing into
    // pavementTempF: NaN. Guarded, sunFactor falls back to 0 (no sun) and the
    // surface temperature stays finite.
    const hours: WeatherSnapshot[] = [
      { ...hourAt(6, 80), startTime: 'not-a-date' },
    ];
    const { hourlyVerdicts } = scanWindows({
      hours,
      airQuality: noAqi,
      alerts: [],
      profile: dog(),
      location: LOCATION,
    });
    expect(hourlyVerdicts).toHaveLength(1);
    expect(Number.isFinite(hourlyVerdicts[0].pavementTempF)).toBe(true);
    // sunFactor 0 → pavement equals air temp (no NaN, no spurious heat gain).
    expect(hourlyVerdicts[0].pavementTempF).toBeCloseTo(80, 5);
  });
});
