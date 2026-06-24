// src/data/nws.ts — client for NWS api.weather.gov (keyless), per Appendix B.
//
// Flow:
//   1. GET /points/{lat},{lon}            -> gridId/gridX/gridY (+ forecast URLs)
//   2. GET /gridpoints/{id}/{x},{y}/forecast/hourly -> hourly WeatherSnapshot[]
//   3. GET /gridpoints/{id}/{x},{y}       -> skyCover time-series, merged in
//   4. GET /alerts/active?point={lat},{lon} -> Alert[]
//
// Every request carries the required `User-Agent` header (omitting it returns
// HTTP 403, plan §8). Every public function returns a `DataResult` and never
// throws a network error (plan §9):
//   - 403            -> { ok:false, reason:'forbidden' }   (caller shows stale)
//   - timeout        -> { ok:false, reason:'timeout' }
//   - non-US (404 on /points only) -> { ok:false, reason:'unsupported-location' }
//     (a 404 on hourly/gridpoint/alerts is a transient http-error, NOT US-only)
//   - bad shape      -> { ok:false, reason:'bad-response' }

import type { Alert, WeatherSnapshot } from '../domain/types';
import { fetchJson } from './http';
import { fail, ok, type DataResult } from './result';

/** NWS API base. */
export const NWS_BASE_URL = 'https://api.weather.gov';

/**
 * Required NWS `User-Agent` (plan §8 / Appendix B). ONE source of truth — every
 * request sends it.
 *
 * DEVIATION FROM Appendix B (justified, plan §9): Appendix B's template is
 * `(CanIWalkMyDog, <project-contact-email>)`. We substitute the project repo URL
 * for the email placeholder because plan §9 calls for a PROJECT contact, not a
 * personal email — the public repo is the durable, non-personal contact channel.
 */
export const NWS_USER_AGENT = '(CanIWalkMyDog, https://github.com/aberson/walkies)';

const NWS_HEADERS: Record<string, string> = {
  'User-Agent': NWS_USER_AGENT,
  // NWS recommends an explicit GeoJSON accept; harmless when absent.
  Accept: 'application/geo+json',
};

// ---------------------------------------------------------------------------
// Raw response shapes (only the fields we read; Appendix B field names).
// ---------------------------------------------------------------------------

/** GET /points/{lat},{lon} -> properties.{gridId,gridX,gridY,...}. */
export interface NwsPoints {
  gridId: string;
  gridX: number;
  gridY: number;
  forecastHourly: string;
  forecastGridData: string;
}

interface RawPointsResponse {
  properties?: {
    gridId?: string;
    gridX?: number;
    gridY?: number;
    forecastHourly?: string;
    forecastGridData?: string;
  };
}

interface RawHourlyPeriod {
  startTime?: string;
  endTime?: string;
  isDaytime?: boolean;
  temperature?: number;
  temperatureUnit?: string;
  relativeHumidity?: { value?: number | null } | null;
  windSpeed?: string;
  probabilityOfPrecipitation?: { value?: number | null } | null;
}

interface RawHourlyResponse {
  properties?: { periods?: RawHourlyPeriod[] };
}

interface RawSkyCoverValue {
  validTime?: string;
  value?: number | null;
}

interface RawGridpointResponse {
  properties?: { skyCover?: { values?: RawSkyCoverValue[] } };
}

interface RawAlertFeature {
  properties?: {
    event?: string;
    severity?: string;
    headline?: string;
    onset?: string | null;
    ends?: string | null;
    description?: string;
  };
}

interface RawAlertsResponse {
  features?: RawAlertFeature[];
}

// ---------------------------------------------------------------------------
// Parsers (pure; exported for unit tests).
// ---------------------------------------------------------------------------

/**
 * Parse an NWS windSpeed string ("5 mph", "5 to 10 mph", "10 to 15 mph") to a
 * number of mph by extracting the FIRST integer. Returns 0 when no integer is
 * present (e.g. unexpected/empty string) so the consumer never sees NaN.
 */
export function parseWindSpeedMph(windSpeed: string | undefined): number {
  if (typeof windSpeed !== 'string') {
    return 0;
  }
  const match = windSpeed.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : 0;
}

/**
 * Resolve an NWS hourly period's temperature to °F, honoring `temperatureUnit`.
 * NWS periods are normally Fahrenheit, but the API can return Celsius (and the
 * Spanish-locale forecast does); a Celsius value fed straight in as °F is a
 * silent, SAFETY-relevant mis-verdict (a hot 30°C day read as 30°F → "cold
 * risk"). So: "C"/"c" → C*9/5+32; "F"/"f" or absent (NWS default is F) → as-is.
 *
 * Returns null when `temperature` is not a finite number, so the caller can DROP
 * the period rather than fabricate a plausible-but-false 0°F (plan §9).
 */
export function periodTempF(period: RawHourlyPeriod): number | null {
  const t = period.temperature;
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    return null;
  }
  const unit = period.temperatureUnit;
  if (unit === 'C' || unit === 'c') {
    return (t * 9) / 5 + 32;
  }
  return t;
}

/**
 * An NWS validTime is an ISO-8601 instant joined to an ISO-8601 duration by a
 * slash, e.g. "2025-06-21T12:00:00+00:00/PT6H". Parse the start instant (ms) and
 * the duration (ms). Supports the duration forms NWS emits: PnDTnHnMnS, with the
 * date (P..D) and time (T..) parts both optional. Returns null on a malformed
 * value.
 */
export function parseValidTimeInterval(
  validTime: string,
): { startMs: number; endMs: number } | null {
  const slash = validTime.indexOf('/');
  if (slash === -1) {
    return null;
  }
  const startMs = Date.parse(validTime.slice(0, slash));
  if (Number.isNaN(startMs)) {
    return null;
  }
  const durationMs = parseIso8601DurationMs(validTime.slice(slash + 1));
  if (durationMs === null) {
    return null;
  }
  return { startMs, endMs: startMs + durationMs };
}

/** Parse an ISO-8601 duration (e.g. "PT1H", "P1DT6H", "PT30M") to ms, or null. */
function parseIso8601DurationMs(duration: string): number | null {
  // Groups: days, hours, minutes, seconds. Each optional. Requires the leading P.
  const m = duration.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!m) {
    return null;
  }
  const [, d, h, min, s] = m;
  const days = d ? Number.parseInt(d, 10) : 0;
  const hours = h ? Number.parseInt(h, 10) : 0;
  const minutes = min ? Number.parseInt(min, 10) : 0;
  const seconds = s ? Number.parseInt(s, 10) : 0;
  return (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
}

/**
 * Find the skyCover percentage covering a given instant by scanning the
 * time-series for the interval whose [start, end) range contains `atMs`.
 * Returns 0 when no interval matches (the documented default).
 */
export function skyCoverAt(
  values: RawSkyCoverValue[],
  atMs: number,
): number {
  for (const entry of values) {
    if (typeof entry.validTime !== 'string') {
      continue;
    }
    const interval = parseValidTimeInterval(entry.validTime);
    if (interval === null) {
      continue;
    }
    if (atMs >= interval.startMs && atMs < interval.endMs) {
      return typeof entry.value === 'number' ? entry.value : 0;
    }
  }
  return 0;
}

/**
 * Map a raw hourly period + the skyCover series into a domain WeatherSnapshot,
 * honoring `temperatureUnit` for °F. skyCover is merged by matching this period's
 * startTime to the validTime interval that contains it (default 0 if no match).
 * Missing humidity/precip default to 0.
 *
 * Returns null when the period has no finite `temperature`: temperature is
 * safety-critical and we must not fabricate a plausible 0°F (which the domain
 * would read as a confident "too cold"). The caller drops null periods (plan §9).
 */
export function toWeatherSnapshot(
  period: RawHourlyPeriod,
  skyCoverValues: RawSkyCoverValue[],
): WeatherSnapshot | null {
  const airTempF = periodTempF(period);
  if (airTempF === null) {
    return null;
  }

  const startTime = period.startTime ?? '';
  const startMs = startTime ? Date.parse(startTime) : Number.NaN;
  const skyCoverPct = Number.isNaN(startMs)
    ? 0
    : skyCoverAt(skyCoverValues, startMs);

  return {
    startTime,
    airTempF,
    relativeHumidity:
      typeof period.relativeHumidity?.value === 'number'
        ? period.relativeHumidity.value
        : 0,
    windSpeedMph: parseWindSpeedMph(period.windSpeed),
    skyCoverPct,
    precipProbability:
      typeof period.probabilityOfPrecipitation?.value === 'number'
        ? period.probabilityOfPrecipitation.value
        : 0,
    isDaytime: period.isDaytime === true,
  };
}

/** Map a raw alert feature's properties into a domain Alert. */
export function toAlert(feature: RawAlertFeature): Alert {
  const p = feature.properties ?? {};
  return {
    event: typeof p.event === 'string' ? p.event : '',
    severity: typeof p.severity === 'string' ? p.severity : 'Unknown',
    headline: typeof p.headline === 'string' ? p.headline : '',
    onset: typeof p.onset === 'string' ? p.onset : null,
    ends: typeof p.ends === 'string' ? p.ends : null,
  };
}

// ---------------------------------------------------------------------------
// Public client functions (each returns a DataResult; none throws).
// ---------------------------------------------------------------------------

/**
 * Step 1: GET /points/{lat},{lon}. Returns the grid mapping + forecast URLs.
 * A 404 here means the coordinates are outside NWS coverage → the result's
 * reason is 'unsupported-location' (US-only, plan §9).
 */
export async function fetchPoints(
  lat: number,
  lon: number,
): Promise<DataResult<NwsPoints>> {
  const url = `${NWS_BASE_URL}/points/${lat},${lon}`;
  // ONLY /points un-validates a location → opt into 404=unsupported-location here.
  // Other NWS calls leave it default (404 → http-error); see fetchJson options.
  const res = await fetchJson<RawPointsResponse>(url, {
    headers: NWS_HEADERS,
    unsupportedOn404: true,
  });
  if (!res.ok) {
    return res;
  }
  const p = res.data.properties;
  if (
    !p ||
    typeof p.gridId !== 'string' ||
    typeof p.gridX !== 'number' ||
    typeof p.gridY !== 'number' ||
    typeof p.forecastHourly !== 'string' ||
    typeof p.forecastGridData !== 'string'
  ) {
    return fail('bad-response');
  }
  return ok({
    gridId: p.gridId,
    gridX: p.gridX,
    gridY: p.gridY,
    forecastHourly: p.forecastHourly,
    forecastGridData: p.forecastGridData,
  });
}

/** Step 3 helper: GET /gridpoints/{id}/{x},{y} -> raw skyCover values. */
async function fetchSkyCoverValues(
  points: NwsPoints,
): Promise<DataResult<RawSkyCoverValue[]>> {
  const url = `${NWS_BASE_URL}/gridpoints/${points.gridId}/${points.gridX},${points.gridY}`;
  const res = await fetchJson<RawGridpointResponse>(url, {
    headers: NWS_HEADERS,
  });
  if (!res.ok) {
    return res;
  }
  const values = res.data.properties?.skyCover?.values;
  return ok(Array.isArray(values) ? values : []);
}

/**
 * Step 2+3: fetch the hourly forecast and the skyCover series for a known grid,
 * then merge skyCover into each hourly period → WeatherSnapshot[].
 *
 * If the skyCover fetch fails (but the hourly fetch succeeds) we still return the
 * hourly snapshots with skyCover defaulted to 0 — a missing sun-exposure proxy
 * is a soft degradation, not a hard failure. A failed hourly fetch propagates.
 */
export async function fetchHourly(
  points: NwsPoints,
): Promise<DataResult<WeatherSnapshot[]>> {
  const hourlyUrl = `${NWS_BASE_URL}/gridpoints/${points.gridId}/${points.gridX},${points.gridY}/forecast/hourly`;
  const hourlyRes = await fetchJson<RawHourlyResponse>(hourlyUrl, {
    headers: NWS_HEADERS,
  });
  if (!hourlyRes.ok) {
    return hourlyRes;
  }
  const periods = hourlyRes.data.properties?.periods;
  if (!Array.isArray(periods)) {
    return fail('bad-response');
  }

  // Best-effort skyCover; default to [] (→ 0 per period) if it fails.
  const skyRes = await fetchSkyCoverValues(points);
  const skyValues = skyRes.ok ? skyRes.data : [];

  // Drop periods with no finite temperature (toWeatherSnapshot → null) so a
  // fabricated 0°F can't poison the windows scan. If NONE survive, the forecast
  // is unusable → bad-response (mirrors fetchPoints' strict missing-field guard).
  const snapshots = periods
    .map((period) => toWeatherSnapshot(period, skyValues))
    .filter((s): s is WeatherSnapshot => s !== null);
  if (snapshots.length === 0) {
    return fail('bad-response');
  }
  return ok(snapshots);
}

/**
 * Step 4: GET /alerts/active?point={lat},{lon} -> domain Alert[]. An empty
 * feature list is a valid success (no active alerts), not a failure.
 */
export async function fetchAlerts(
  lat: number,
  lon: number,
): Promise<DataResult<Alert[]>> {
  const url = `${NWS_BASE_URL}/alerts/active?point=${lat},${lon}`;
  const res = await fetchJson<RawAlertsResponse>(url, { headers: NWS_HEADERS });
  if (!res.ok) {
    return res;
  }
  const features = res.data.features;
  if (!Array.isArray(features)) {
    return fail('bad-response');
  }
  return ok(features.map(toAlert));
}

/** Bundle of the full NWS read for a location. */
export interface NwsForecast {
  points: NwsPoints;
  hourly: WeatherSnapshot[];
  alerts: Alert[];
}

/**
 * Convenience: run the full NWS flow (points → hourly+skyCover → alerts) for a
 * location and return the bundle. Short-circuits on the first hard failure
 * (points/hourly). Alerts degrade softly: a failed alerts fetch yields an empty
 * alert list rather than failing the whole forecast.
 */
export async function fetchForecast(
  lat: number,
  lon: number,
): Promise<DataResult<NwsForecast>> {
  const pointsRes = await fetchPoints(lat, lon);
  if (!pointsRes.ok) {
    return pointsRes;
  }
  const hourlyRes = await fetchHourly(pointsRes.data);
  if (!hourlyRes.ok) {
    return hourlyRes;
  }
  const alertsRes = await fetchAlerts(lat, lon);
  const alerts = alertsRes.ok ? alertsRes.data : [];

  return ok({
    points: pointsRes.data,
    hourly: hourlyRes.data,
    alerts,
  });
}
