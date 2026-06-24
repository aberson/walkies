// src/features/home/useHomeVerdict.ts — the Home controller (plan §5).
//
// ORCHESTRATES the real pipeline: location → profile → live data (NWS + AQI +
// alerts) → the PURE domain engine (computeVerdict + scanWindows). This is the
// one place location/data/storage and the domain core are composed; the UI
// components stay presentational.
//
// Degradation contract (plan §9):
//   - location permission denied/unavailable → 'permission-denied'
//   - no stored profile                       → 'needs-onboarding'
//   - hard data failure WITH a cached verdict → 'stale' (last known level + badge)
//   - hard data failure WITHOUT a cache       → 'error'
//   - success                                 → 'success' (and persist last verdict)
//
// The domain core is NEVER stubbed: loadHomeVerdict calls the real computeVerdict
// and scanWindows. Tests mock only the data/location/storage boundary (the deps
// below), proving the real engine is reached end-to-end.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchAirQuality as realFetchAirQuality,
  fetchForecast as realFetchForecast,
  getCurrentLocation as realGetCurrentLocation,
  loadLastVerdict as realLoadLastVerdict,
  saveLastVerdict as realSaveLastVerdict,
  type DataResult,
  type LastVerdict,
  type LocationResult,
} from '../../data';
import {
  computeVerdict,
  scanWindows,
  sunFactor as computeSunFactor,
} from '../../domain';
import type {
  AirQuality,
  Alert,
  DogProfile,
  GeoPoint,
  Settings,
  Verdict,
  WeatherSnapshot,
} from '../../domain/types';
import type { WalkWindow } from '../../domain/windows';
import type { NwsForecast } from '../../data/nws';
import {
  loadProfile as realLoadProfile,
  loadSettings as realLoadSettings,
} from '../../storage';

/** Discriminated view-model status the Home screen renders. */
export type HomeStatus =
  | 'loading'
  | 'success'
  | 'stale'
  | 'error'
  | 'permission-denied'
  | 'needs-onboarding';

/** The immutable snapshot the Home screen renders for each status. */
export interface HomeViewModel {
  status: HomeStatus;
  /** Fresh headline verdict — present only on 'success'. */
  verdict?: Verdict;
  /** Best-windows-today — present only on 'success'. */
  windows?: WalkWindow[];
  /** Active NWS alerts — present on 'success'. */
  alerts?: Alert[];
  /** The dog's name (for the headline greeting), when a profile is loaded. */
  dogName?: string;
  /**
   * The user's chosen display temperature unit (Settings, Step 7). Present on
   * 'success' so the verdict card can render the pavement temp in °F/°C. Defaults
   * to 'F' when settings are unreadable.
   */
  temperatureUnit?: Settings['temperatureUnit'];
  /** ISO time the rendered data was computed/fetched. */
  fetchedAt?: string;
  /**
   * The last-known cached verdict — present only on 'stale'. Persisted cache
   * stores just the level + timestamp (plan §3.1), so a stale render shows the
   * level chip + "showing last known" badge, not the full reasons/pavement.
   */
  lastVerdict?: LastVerdict;
  /**
   * Why we are showing 'permission-denied' or 'error'. Lets the UI tailor copy
   * (e.g. "location off" vs "device couldn't get a fix").
   */
  reason?: string;
}

/** Injectable dependency seam — defaults to the real data/storage/domain stack. */
export interface HomeDeps {
  getCurrentLocation: () => Promise<LocationResult>;
  loadProfile: () => Promise<DogProfile | null>;
  /** Load the user's display Settings (units). Never throws (defaults on failure). */
  loadSettings: () => Promise<Settings>;
  fetchForecast: (lat: number, lon: number) => Promise<DataResult<NwsForecast>>;
  fetchAirQuality: (
    lat: number,
    lon: number,
  ) => Promise<DataResult<AirQuality>>;
  loadLastVerdict: () => Promise<LastVerdict | null>;
  saveLastVerdict: (value: LastVerdict) => Promise<void>;
  /** Clock seam so tests can pin "now"; defaults to Date.now via new Date(). */
  now: () => Date;
}

const defaultDeps: HomeDeps = {
  getCurrentLocation: realGetCurrentLocation,
  loadProfile: realLoadProfile,
  loadSettings: realLoadSettings,
  fetchForecast: realFetchForecast,
  fetchAirQuality: realFetchAirQuality,
  loadLastVerdict: realLoadLastVerdict,
  saveLastVerdict: realSaveLastVerdict,
  now: () => new Date(),
};

/**
 * Pick the "now" weather snapshot from the hourly forecast: the first period
 * whose end has not yet passed, falling back to the first period. The data layer
 * returns chronological hourly snapshots; the first is effectively "this hour".
 */
function pickNowSnapshot(
  hours: WeatherSnapshot[],
  now: Date,
): WeatherSnapshot | null {
  if (hours.length === 0) {
    return null;
  }
  const nowMs = now.getTime();
  // Prefer the first period that has not already ended (startTime + ~1h).
  for (const hour of hours) {
    const startMs = Date.parse(hour.startTime);
    if (!Number.isNaN(startMs) && startMs + 60 * 60 * 1000 > nowMs) {
      return hour;
    }
  }
  return hours[0];
}

/** Stale view-model from a cached verdict (data failed but a cache exists). */
function staleFrom(
  cache: LastVerdict,
  dogName: string | undefined,
  reason: string,
): HomeViewModel {
  return {
    status: 'stale',
    lastVerdict: cache,
    fetchedAt: cache.fetchedAt,
    dogName,
    reason,
  };
}

/**
 * Run the full Home pipeline once and return the resolved view-model. Pure of
 * React — a plain async function over the injected deps so it is trivially
 * testable. Never throws: every failure maps to a view-model status.
 */
export async function loadHomeVerdict(
  overrides: Partial<HomeDeps> = {},
): Promise<HomeViewModel> {
  const deps: HomeDeps = { ...defaultDeps, ...overrides };

  // 1. Location (permission + fix). A denial/unavailable surfaces, never throws.
  const loc = await deps.getCurrentLocation();
  if (!loc.ok) {
    return {
      status: 'permission-denied',
      reason: loc.reason,
    };
  }
  const point: GeoPoint = loc.data;

  // 2. Stored profile. None → onboarding required (link to /profile).
  const profile = await deps.loadProfile();
  if (profile === null) {
    return { status: 'needs-onboarding' };
  }
  const dogName = profile.name.trim() || undefined;

  // 2b. Display settings (units). A soft signal: loadSettings never throws and
  //     falls back to DEFAULT_SETTINGS, so the unit is always defined. Used for
  //     DISPLAY only — the domain engine below is fed raw °F regardless.
  const settings = await deps.loadSettings();
  const temperatureUnit = settings.temperatureUnit;

  // 3. Live data. The forecast (points→hourly→alerts) is the hard dependency;
  //    AQI degrades softly to { usAqi: null } so a verdict can still render.
  const forecastRes = await deps.fetchForecast(point.lat, point.lon);
  if (!forecastRes.ok) {
    // Hard data failure → fall back to the last cached verdict if present.
    const cached = await deps.loadLastVerdict();
    if (cached !== null) {
      return staleFrom(cached, dogName, forecastRes.reason);
    }
    return { status: 'error', reason: forecastRes.reason, dogName };
  }
  const forecast = forecastRes.data;

  const aqiRes = await deps.fetchAirQuality(point.lat, point.lon);
  // AQI is a soft signal: on failure the engine simply drops it (usAqi: null).
  const airQuality: AirQuality = aqiRes.ok ? aqiRes.data : { usAqi: null };

  // 4. Build the "now" snapshot + sunFactor, then call the REAL engine.
  const now = deps.now();
  const nowSnapshot = pickNowSnapshot(forecast.hourly, now);
  if (nowSnapshot === null) {
    // No usable hourly period — try stale, else error.
    const cached = await deps.loadLastVerdict();
    if (cached !== null) {
      return staleFrom(cached, dogName, 'bad-response');
    }
    return { status: 'error', reason: 'bad-response', dogName };
  }

  const sf = computeSunFactor(
    point.lat,
    point.lon,
    new Date(nowSnapshot.startTime),
  );
  const verdict = computeVerdict({
    weather: nowSnapshot,
    airQuality,
    alerts: forecast.alerts,
    profile,
    sunFactor: sf,
  });

  // 5. Best windows via the real scan (re-runs the engine per hour).
  const { windows } = scanWindows({
    hours: forecast.hourly,
    airQuality,
    alerts: forecast.alerts,
    profile,
    location: point,
  });

  const fetchedAt = now.toISOString();

  // 6. Persist the fresh verdict for the next cold start / stale fallback.
  await deps.saveLastVerdict({
    verdict: verdict.level,
    fetchedAt,
    lat: point.lat,
    lon: point.lon,
  });

  return {
    status: 'success',
    verdict,
    windows,
    alerts: forecast.alerts,
    dogName,
    temperatureUnit,
    fetchedAt,
  };
}

/**
 * React hook wrapping `loadHomeVerdict`. Runs the pipeline once on mount, exposes
 * the current view-model, and a `refresh()` that re-runs it (back to 'loading').
 *
 * `overrides` is read through a ref so a fresh-identity object (e.g. the route's
 * default `{}` re-created each render) does NOT re-trigger the effect — that would
 * be an infinite load loop. Tests still inject fixtures via the same arg; the
 * latest value is always used by the next run.
 *
 * @param overrides optional dependency overrides (tests inject fixtures here)
 */
export function useHomeVerdict(overrides: Partial<HomeDeps> = {}): {
  model: HomeViewModel;
  refresh: () => void;
} {
  const [model, setModel] = useState<HomeViewModel>({ status: 'loading' });

  // Keep the latest overrides + mounted flag in refs. Updated inside an effect
  // (never during render) so a fresh-identity overrides object can't re-trigger
  // the load effect — that would be an infinite load loop.
  const overridesRef = useRef(overrides);
  const mountedRef = useRef(true);
  // Per-call generation token. Incremented at the START of each load() run; the
  // run captures its own id and only commits state while it is still the latest.
  // Guards against last-write races: a slow earlier run that resolves AFTER a
  // fast later run must NOT clobber the newer result with stale data (e.g. a
  // double-tapped refresh, or refresh() firing while the mount load() is still
  // awaiting a slow forecast). mountedRef alone only guards unmount, not staleness.
  const runIdRef = useRef(0);
  useEffect(() => {
    overridesRef.current = overrides;
  });

  // Fire the async pipeline; resolves into state (no synchronous setState here,
  // so it is safe to invoke from an effect).
  const load = useCallback(() => {
    const runId = ++runIdRef.current;
    void (async () => {
      const next = await loadHomeVerdict(overridesRef.current);
      // Bail if unmounted OR superseded by a newer run — only the most-recent
      // run is allowed to commit, so out-of-order resolution can't clobber.
      if (mountedRef.current && runId === runIdRef.current) {
        setModel(next);
      }
    })();
  }, []);

  // Initial load on mount. Initial state is already 'loading', so no synchronous
  // setState is needed — load() only sets state after the await resolves.
  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Explicit user refresh (an event handler, not an effect): show loading, then
  // re-run the pipeline.
  const refresh = useCallback(() => {
    setModel({ status: 'loading' });
    load();
  }, [load]);

  return { model, refresh };
}
