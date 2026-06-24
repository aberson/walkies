// src/features/home/HomeScreen.test.tsx — Home verdict screen tests.
//
// CRITICAL (code-quality.md: "new components require an integration test through
// the production caller"; Step 5 done-when "reaches the real domain engine"):
// these tests render the REAL HomeScreen via its production controller
// (useHomeVerdict) and mock ONLY the data/location/storage boundary. The domain
// engine (computeVerdict + scanWindows) is NEVER stubbed — so a RED assertion
// from AQI 175 proves the real engine was reached end-to-end, not a stub.

import {
  render,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react-native';
import React from 'react';

import type {
  AirQuality,
  Alert,
  DogProfile,
  WeatherSnapshot,
} from '../../domain/types';
import type { NwsForecast } from '../../data/nws';
import { ok, fail, type DataResult } from '../../data/result';
import type { LastVerdict, LocationResult } from '../../data';

import type { HomeDeps } from './useHomeVerdict';

import HomeScreen from './HomeScreen';

// The controller imports the data barrel, which transitively imports cache.ts →
// AsyncStorage. The data/storage boundary is fully mocked via deps, but the
// module import still needs AsyncStorage's bundled jest mock to load.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// expo-router's Link wraps a child; render it transparently so onboarding shows.
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// ---------------------------------------------------------------------------
// Fixtures — the data/location/storage BOUNDARY. The domain engine is real.
// ---------------------------------------------------------------------------

const MPLS = { lat: 44.96, lon: -93.27 };

/** A healthy adult mixed-breed: no vulnerability offsets (Appendix D baseline). */
const HEALTHY_PROFILE: DogProfile = {
  name: 'Biscuit',
  breed: 'custom',
  brachycephalic: false,
  ageMonths: 36,
  size: 'medium',
  bodyCondition: 'ideal',
  coat: 'medium',
  darkCoat: false,
  conditions: ['none'],
  schemaVersion: 1,
};

/**
 * Build an hourly forecast of `count` identical comfortable periods at midnight
 * UTC (sun below the horizon → sunFactor 0 → pavement == air temp), so pavement
 * never escalates and only the AQI/heat we set drives the verdict.
 */
function comfortableHours(
  count: number,
  airTempF: number,
  relativeHumidity = 40,
): WeatherSnapshot[] {
  const hours: WeatherSnapshot[] = [];
  // A far-future date so the "now" picker always selects the first period.
  const base = Date.UTC(2999, 5, 21, 6, 0, 0); // 06:00 UTC ~ pre-dawn Mpls
  for (let i = 0; i < count; i++) {
    hours.push({
      startTime: new Date(base + i * 3600_000).toISOString(),
      airTempF,
      relativeHumidity,
      windSpeedMph: 3,
      skyCoverPct: 50,
      precipProbability: 0,
      isDaytime: false,
    });
  }
  return hours;
}

function forecast(hours: WeatherSnapshot[], alerts: Alert[] = []): NwsForecast {
  return {
    points: {
      gridId: 'MPX',
      gridX: 107,
      gridY: 71,
      forecastHourly: 'https://example/hourly',
      forecastGridData: 'https://example/grid',
    },
    hourly: hours,
    alerts,
  };
}

/** A fully-mocked, granted, profiled, deterministic dep set. Domain stays real. */
function makeDeps(over: {
  location?: LocationResult;
  profile?: DogProfile | null;
  forecastRes?: DataResult<NwsForecast>;
  aqiRes?: DataResult<AirQuality>;
  lastVerdict?: LastVerdict | null;
}): Partial<HomeDeps> {
  const saved: LastVerdict[] = [];
  return {
    getCurrentLocation: jest.fn(
      async (): Promise<LocationResult> =>
        over.location ?? { ok: true, data: MPLS },
    ),
    loadProfile: jest.fn(async () =>
      over.profile === undefined ? HEALTHY_PROFILE : over.profile,
    ),
    fetchForecast: jest.fn(
      async () => over.forecastRes ?? ok(forecast(comfortableHours(12, 60))),
    ),
    fetchAirQuality: jest.fn(async () => over.aqiRes ?? ok({ usAqi: 20 })),
    loadLastVerdict: jest.fn(async () => over.lastVerdict ?? null),
    saveLastVerdict: jest.fn(async (v: LastVerdict) => {
      saved.push(v);
    }),
    // Pin "now" to the first forecast period so pickNowSnapshot is deterministic.
    now: () => new Date(Date.UTC(2999, 5, 21, 6, 0, 0)),
  };
}

// ---------------------------------------------------------------------------
// THE integration test: real engine reached end-to-end (AQI 175 → RED).
// ---------------------------------------------------------------------------

describe('HomeScreen — domain engine reached through the production caller', () => {
  it('renders RED for comfortable weather but AQI 175 (proves real computeVerdict ran)', async () => {
    const deps = makeDeps({
      forecastRes: ok(forecast(comfortableHours(12, 60))),
      aqiRes: ok({ usAqi: 175 }),
    });

    render(<HomeScreen deps={deps} />);

    // The card testID encodes the level the REAL engine produced. If the screen
    // used a stub, comfortable weather would have rendered green — only the real
    // "most restrictive signal wins" engine maps AQI 175 → red.
    const card = await screen.findByTestId('verdict-card-red');
    expect(card).toBeTruthy();
    // And the fresh verdict was persisted.
    expect(deps.saveLastVerdict).toHaveBeenCalledWith(
      expect.objectContaining({ verdict: 'red', lat: MPLS.lat, lon: MPLS.lon }),
    );
  });
});

// ---------------------------------------------------------------------------
// GREEN / YELLOW / RED rendered from inputs the REAL engine maps to each level.
// ---------------------------------------------------------------------------

describe('HomeScreen — green / yellow / red', () => {
  it('GREEN: comfortable weather + good air', async () => {
    const deps = makeDeps({
      forecastRes: ok(forecast(comfortableHours(12, 60))),
      aqiRes: ok({ usAqi: 20 }),
    });
    render(<HomeScreen deps={deps} />);
    expect(await screen.findByTestId('verdict-card-green')).toBeTruthy();
  });

  it('YELLOW: moderate air quality (AQI 120) for a healthy dog', async () => {
    const deps = makeDeps({
      forecastRes: ok(forecast(comfortableHours(12, 60))),
      aqiRes: ok({ usAqi: 120 }),
    });
    render(<HomeScreen deps={deps} />);
    expect(await screen.findByTestId('verdict-card-yellow')).toBeTruthy();
  });

  it('RED: a severe thunderstorm alert forces unsafe', async () => {
    const storm: Alert = {
      event: 'Severe Thunderstorm Warning',
      severity: 'Severe',
      headline: 'Severe thunderstorms until 8 PM',
      onset: null,
      ends: null,
    };
    const deps = makeDeps({
      forecastRes: ok(forecast(comfortableHours(12, 60), [storm])),
      aqiRes: ok({ usAqi: 20 }),
    });
    render(<HomeScreen deps={deps} />);
    expect(await screen.findByTestId('verdict-card-red')).toBeTruthy();
    // The alert is surfaced in its own row (text also appears in the verdict
    // reason, so assert at least one occurrence).
    expect(screen.getByTestId('home-alerts')).toBeTruthy();
    expect(
      (await screen.findAllByText(/Severe Thunderstorm Warning/)).length,
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Degradation states.
// ---------------------------------------------------------------------------

describe('HomeScreen — degradation states', () => {
  it('stale: data fails but a cached verdict exists → stale badge + last level', async () => {
    const deps = makeDeps({
      forecastRes: fail('timeout'),
      lastVerdict: {
        verdict: 'yellow',
        fetchedAt: '2999-06-21T05:00:00.000Z',
        lat: MPLS.lat,
        lon: MPLS.lon,
      },
    });
    render(<HomeScreen deps={deps} />);
    expect(await screen.findByTestId('home-stale')).toBeTruthy();
    expect(screen.getByTestId('stale-badge')).toBeTruthy();
    // The cached yellow level is shown via the RiskBadge.
    expect(screen.getByTestId('risk-badge-yellow')).toBeTruthy();
  });

  it('error: data fails AND no cache → friendly error, no crash', async () => {
    const deps = makeDeps({
      forecastRes: fail('network-error'),
      lastVerdict: null,
    });
    render(<HomeScreen deps={deps} />);
    expect(await screen.findByTestId('home-error')).toBeTruthy();
    expect(screen.getByTestId('error-retry')).toBeTruthy();
  });

  it('permission-denied: location denied → permission UI, no crash', async () => {
    const deps = makeDeps({
      location: { ok: false, reason: 'permission-denied' },
    });
    render(<HomeScreen deps={deps} />);
    expect(await screen.findByTestId('home-permission-denied')).toBeTruthy();
    expect(screen.getByTestId('permission-retry')).toBeTruthy();
  });

  it('needs-onboarding: no stored profile → prompt to create one', async () => {
    const deps = makeDeps({ profile: null });
    render(<HomeScreen deps={deps} />);
    expect(await screen.findByTestId('home-needs-onboarding')).toBeTruthy();
    expect(screen.getByTestId('onboarding-link')).toBeTruthy();
  });

  it('AQI fetch failing alone does NOT block the verdict (soft signal)', async () => {
    const deps = makeDeps({
      forecastRes: ok(forecast(comfortableHours(12, 60))),
      aqiRes: fail('timeout'),
    });
    render(<HomeScreen deps={deps} />);
    // AQI dropped → comfortable weather still renders green, not error/stale.
    expect(await screen.findByTestId('verdict-card-green')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Screen content + behaviour.
// ---------------------------------------------------------------------------

describe('HomeScreen — content & refresh', () => {
  it('always shows the 7-second-test note on a successful verdict', async () => {
    const deps = makeDeps({
      forecastRes: ok(forecast(comfortableHours(12, 60))),
      aqiRes: ok({ usAqi: 20 }),
    });
    render(<HomeScreen deps={deps} />);
    await screen.findByTestId('verdict-card-green');
    expect(screen.getByTestId('seven-second-note')).toBeTruthy();
  });

  it('shows "good all day" when the headline is green and the whole day is walkable', async () => {
    const deps = makeDeps({
      forecastRes: ok(forecast(comfortableHours(12, 60))),
      aqiRes: ok({ usAqi: 20 }),
    });
    render(<HomeScreen deps={deps} />);
    await screen.findByTestId('verdict-card-green');
    expect(screen.getByTestId('window-good-all-day')).toBeTruthy();
  });

  it('refresh re-runs the pipeline (getCurrentLocation called again)', async () => {
    // Drive refresh through the permission-denied retry button (an explicit
    // refresh() caller). Location stays denied, so the screen re-renders the same
    // state but getCurrentLocation is invoked a second time.
    const deps = makeDeps({
      location: { ok: false, reason: 'permission-denied' },
    });
    render(<HomeScreen deps={deps} />);
    await screen.findByTestId('home-permission-denied');
    expect(deps.getCurrentLocation).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('permission-retry'));
    await waitFor(() =>
      expect(deps.getCurrentLocation).toHaveBeenCalledTimes(2),
    );
  });
});
