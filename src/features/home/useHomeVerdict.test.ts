// src/features/home/useHomeVerdict.test.ts — the Home controller as a pure
// async function. Mocks ONLY the data/location/storage boundary; the domain
// engine (computeVerdict + scanWindows) runs for real. Complements the RNTL
// rendering tests in HomeScreen.test.tsx with direct view-model assertions.

import { act, renderHook, waitFor } from '@testing-library/react-native';

import type {
  AirQuality,
  Alert,
  DogProfile,
  WeatherSnapshot,
} from '../../domain/types';
import type { NwsForecast } from '../../data/nws';
import { ok, fail, type DataResult } from '../../data/result';
import type { LastVerdict, LocationResult } from '../../data';

import {
  loadHomeVerdict,
  useHomeVerdict,
  type HomeDeps,
} from './useHomeVerdict';

// The data barrel transitively imports cache.ts → AsyncStorage; load its mock so
// the module imports resolve (all data/storage deps are injected, not real here).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

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

function comfortableHours(count: number, airTempF: number): WeatherSnapshot[] {
  const base = Date.UTC(2999, 5, 21, 6, 0, 0);
  return Array.from({ length: count }, (_, i) => ({
    startTime: new Date(base + i * 3600_000).toISOString(),
    airTempF,
    relativeHumidity: 40,
    windSpeedMph: 3,
    skyCoverPct: 50,
    precipProbability: 0,
    isDaytime: false,
  }));
}

function forecast(hours: WeatherSnapshot[], alerts: Alert[] = []): NwsForecast {
  return {
    points: {
      gridId: 'MPX',
      gridX: 107,
      gridY: 71,
      forecastHourly: 'h',
      forecastGridData: 'g',
    },
    hourly: hours,
    alerts,
  };
}

function deps(over: {
  location?: LocationResult;
  profile?: DogProfile | null;
  forecastRes?: DataResult<NwsForecast>;
  aqiRes?: DataResult<AirQuality>;
  lastVerdict?: LastVerdict | null;
}): Partial<HomeDeps> {
  return {
    getCurrentLocation: async (): Promise<LocationResult> =>
      over.location ?? { ok: true, data: MPLS },
    loadProfile: async () =>
      over.profile === undefined ? HEALTHY_PROFILE : over.profile,
    fetchForecast: async () =>
      over.forecastRes ?? ok(forecast(comfortableHours(12, 60))),
    fetchAirQuality: async () => over.aqiRes ?? ok({ usAqi: 20 }),
    loadLastVerdict: async () => over.lastVerdict ?? null,
    saveLastVerdict: async () => {},
    now: () => new Date(Date.UTC(2999, 5, 21, 6, 0, 0)),
  };
}

describe('loadHomeVerdict', () => {
  it('AQI 175 + comfortable weather → success with a RED verdict (real engine)', async () => {
    const vm = await loadHomeVerdict(deps({ aqiRes: ok({ usAqi: 175 }) }));
    expect(vm.status).toBe('success');
    expect(vm.verdict?.level).toBe('red');
    expect(vm.verdict?.bindingSignal).toBe('airQuality');
  });

  it('comfortable weather + good air → success GREEN with windows', async () => {
    const vm = await loadHomeVerdict(deps({}));
    expect(vm.status).toBe('success');
    expect(vm.verdict?.level).toBe('green');
    expect(vm.windows?.length).toBeGreaterThan(0);
  });

  it('permission denied → permission-denied (no throw)', async () => {
    const vm = await loadHomeVerdict(
      deps({ location: { ok: false, reason: 'permission-denied' } }),
    );
    expect(vm.status).toBe('permission-denied');
  });

  it('no profile → needs-onboarding', async () => {
    const vm = await loadHomeVerdict(deps({ profile: null }));
    expect(vm.status).toBe('needs-onboarding');
  });

  it('data fails + cache present → stale with the cached level', async () => {
    const vm = await loadHomeVerdict(
      deps({
        forecastRes: fail('timeout'),
        lastVerdict: {
          verdict: 'yellow',
          fetchedAt: '2999-06-21T05:00:00.000Z',
          lat: MPLS.lat,
          lon: MPLS.lon,
        },
      }),
    );
    expect(vm.status).toBe('stale');
    expect(vm.lastVerdict?.verdict).toBe('yellow');
  });

  it('data fails + no cache → error', async () => {
    const vm = await loadHomeVerdict(
      deps({ forecastRes: fail('network-error'), lastVerdict: null }),
    );
    expect(vm.status).toBe('error');
  });

  it('persists the fresh verdict on success', async () => {
    const saved: LastVerdict[] = [];
    const vm = await loadHomeVerdict({
      ...deps({}),
      saveLastVerdict: async (v) => {
        saved.push(v);
      },
    });
    expect(vm.status).toBe('success');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ verdict: 'green', lat: MPLS.lat });
  });
});

/** A promise plus its resolver, so a test can decide WHEN a run finishes. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useHomeVerdict — last-write race', () => {
  it('a slow earlier run cannot clobber a fast later run (latest wins)', async () => {
    // The mount load() (run 1) gets a SLOW forecast whose data resolves to a RED
    // verdict (hot 95°F air at night → heat/pavement red). A user refresh()
    // (run 2) gets a FAST forecast resolving to GREEN (comfortable 60°F). We let
    // run 2 settle FIRST, then resolve run 1 — so the stale slow run finishes
    // last and, without the generation guard, would overwrite GREEN with RED.
    //
    // The forecast (which carries the differentiating air temp) is gated per run
    // by call order — deterministic with run start order — so the slow run truly
    // carries the RED inputs and the fast run carries the GREEN inputs. AQI stays
    // good for both, isolating the race to the forecast resolution ordering.
    const slow = deferred<DataResult<NwsForecast>>();
    let forecastCalls = 0;

    const seam: Partial<HomeDeps> = {
      getCurrentLocation: async (): Promise<LocationResult> => ({
        ok: true,
        data: MPLS,
      }),
      loadProfile: async () => HEALTHY_PROFILE,
      fetchForecast: async () => {
        forecastCalls += 1;
        // Run 1 (mount) → slow promise; run 2 (refresh) → resolves immediately
        // with comfortable (GREEN) weather.
        if (forecastCalls === 1) {
          return slow.promise;
        }
        return ok(forecast(comfortableHours(12, 60)));
      },
      fetchAirQuality: async () => ok({ usAqi: 20 }),
      loadLastVerdict: async () => null,
      saveLastVerdict: async () => {},
      now: () => new Date(Date.UTC(2999, 5, 21, 6, 0, 0)),
    };

    const { result } = renderHook(() => useHomeVerdict(seam));

    // Run 1 is in flight (awaiting the slow forecast); still loading.
    expect(result.current.model.status).toBe('loading');

    // Fire the user refresh → run 2 starts with the fast GREEN inputs.
    act(() => {
      result.current.refresh();
    });

    // Run 2 settles first → model is the fast GREEN verdict.
    await waitFor(() => expect(result.current.model.status).toBe('success'));
    expect(result.current.model.verdict?.level).toBe('green');

    // NOW the slow run 1 finally resolves (out of order) with the RED-driving hot
    // forecast. The run-id guard must drop it — never commit it over the newer
    // GREEN result.
    await act(async () => {
      slow.resolve(ok(forecast(comfortableHours(12, 95))));
      // Let run 1's awaited continuation chain flush.
      await Promise.resolve();
      await Promise.resolve();
    });

    // Final model still reflects the latest (fast) run, never the stale slow one.
    expect(result.current.model.status).toBe('success');
    expect(result.current.model.verdict?.level).toBe('green');
  });
});
