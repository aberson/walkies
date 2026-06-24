// src/app/index.test.tsx — the Home ROUTE (Step 5). Verifies the expo-router
// index route renders the real HomeScreen and reaches a view-model state without
// crashing. The route passes NO deps, so the data/location/storage MODULES are
// mocked here (the domain engine stays real). The deep verdict-level + state
// matrix lives in features/home/HomeScreen.test.tsx.
//
// TWO production-caller regression guards, both driving the route's DEFAULT
// useHomeVerdict() (no deps prop) so the real default dependency wiring runs:
//   1. permission-denied — the early short-circuit branch.
//   2. success — the FULL pipeline (location → profile → forecast → AQI → the
//      real domain engine → persist), settling at a terminal SUCCESS render.
//      This is the path whose infinite-load loop previously regressed; the
//      early short-circuit alone could pass while the full path looped.
//
// MODULE-level mocks (not the deps prop): the data/location/storage *modules*
// are mocked so the route's default `useHomeVerdict()` resolves them. The domain
// engine (src/domain) is NEVER mocked — a SUCCESS render with a verdict card
// proves the real computeVerdict/scanWindows ran end-to-end through the route.

import { render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import type { DogProfile } from '../domain/types';
import type { LocationResult } from '../data/location';

import Home from './index';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const MPLS = { lat: 44.96, lon: -93.27 };

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

// The mocked forecast uses a far-future, pre-dawn period so the controller's
// "now" picker selects the first hour and the sun is below the horizon
// (sunFactor 0 → pavement == air temp), keeping the GREEN verdict deterministic.

// ---------------------------------------------------------------------------
// MODULE mocks for the data/location/storage boundary. Real submodule helpers
// + types are preserved via requireActual; only the IO entry points are stubbed.
// The domain engine is untouched (never mocked).
// ---------------------------------------------------------------------------

const mockGetCurrentLocation = jest.fn<Promise<LocationResult>, []>(
  async () => ({ ok: true, data: MPLS }),
);

jest.mock('../data/location', () => ({
  ...jest.requireActual('../data/location'),
  getCurrentLocation: () => mockGetCurrentLocation(),
}));

jest.mock('../data/nws', () => {
  const actual = jest.requireActual('../data/nws');
  const { ok } = jest.requireActual('../data/result');
  return {
    ...actual,
    fetchForecast: jest.fn(async () =>
      ok({
        points: {
          gridId: 'MPX',
          gridX: 107,
          gridY: 71,
          forecastHourly: 'https://example/hourly',
          forecastGridData: 'https://example/grid',
        },
        hourly: Array.from({ length: 12 }, (_, i) => ({
          startTime: new Date(
            Date.UTC(2999, 5, 21, 6, 0, 0) + i * 3600_000,
          ).toISOString(),
          airTempF: 60,
          relativeHumidity: 40,
          windSpeedMph: 3,
          skyCoverPct: 50,
          precipProbability: 0,
          isDaytime: false,
        })),
        alerts: [],
      }),
    ),
  };
});

jest.mock('../data/airQuality', () => {
  const actual = jest.requireActual('../data/airQuality');
  const { ok } = jest.requireActual('../data/result');
  return {
    ...actual,
    fetchAirQuality: jest.fn(async () => ok({ usAqi: 20 })),
  };
});

jest.mock('../data/cache', () => ({
  ...jest.requireActual('../data/cache'),
  loadLastVerdict: jest.fn(async () => null),
  saveLastVerdict: jest.fn(async () => {}),
}));

jest.mock('../storage/profile', () => ({
  ...jest.requireActual('../storage/profile'),
  loadProfile: jest.fn(async () => HEALTHY_PROFILE),
}));

describe('Home route — production caller (default useHomeVerdict)', () => {
  beforeEach(() => {
    // Reset call history + default to a granted fix; the permission-denied test
    // overrides the resolution for its single call.
    mockGetCurrentLocation.mockReset();
    mockGetCurrentLocation.mockResolvedValue({ ok: true, data: MPLS });
  });

  it('renders the verdict screen and reaches the permission-denied state', async () => {
    mockGetCurrentLocation.mockResolvedValueOnce({
      ok: false,
      reason: 'permission-denied',
    });
    render(<Home />);
    expect(await screen.findByTestId('home-permission-denied')).toBeTruthy();
  });

  it('runs the FULL pipeline to a SUCCESS verdict and settles (no load loop)', async () => {
    // Comfortable weather + good air with a stored profile → the real engine
    // resolves GREEN. Reaching a verdict card proves the whole pipeline ran ONCE
    // and settled at a terminal state — not an infinite re-load loop.
    render(<Home />);

    // Settles at success (the verdict card is the terminal success render).
    expect(await screen.findByTestId('verdict-card-green')).toBeTruthy();
    // The seven-second note + windows strip confirm the full success view, and
    // its presence means useHomeVerdict committed exactly the settled model.
    expect(screen.getByTestId('seven-second-note')).toBeTruthy();

    // Prove it SETTLED: location is fetched exactly once for the single mount
    // load (no re-trigger loop). Give any spurious re-run a chance to fire.
    await waitFor(() =>
      expect(mockGetCurrentLocation).toHaveBeenCalledTimes(1),
    );
    expect(mockGetCurrentLocation).toHaveBeenCalledTimes(1);
  });
});
