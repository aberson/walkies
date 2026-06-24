// src/data/airQuality.ts — Open-Meteo Air-Quality client (keyless, US AQI scale),
// per Appendix B. Returns a domain AirQuality. Missing AQI degrades to
// { usAqi: null } rather than throwing (plan §9). Also exports the documented
// AirNow adapter seam (plan §8) for the future EPA upgrade behind a proxy.

import type { AirQuality } from '../domain/types';
import { fetchJson } from './http';
import { fail, ok, type DataResult } from './result';

/** Open-Meteo air-quality base. */
export const OPEN_METEO_AIR_QUALITY_URL =
  'https://air-quality-api.open-meteo.com/v1/air-quality';

/**
 * The `current=` fields we request (Appendix B). Exported as the ONE source of
 * truth so tests assert against it instead of re-hardcoding the literal
 * (workspace duplicate-shape-constant rule).
 */
export const CURRENT_FIELDS = 'us_aqi,pm2_5,pm10,ozone';

interface RawAirQualityResponse {
  current?: {
    us_aqi?: number | null;
    pm2_5?: number | null;
    pm10?: number | null;
    ozone?: number | null;
  };
}

/**
 * Map a raw Open-Meteo response to the domain AirQuality. A missing/null
 * `current.us_aqi` yields `{ usAqi: null }` so the verdict engine can drop the
 * AQI signal instead of blocking (plan §9). Never throws.
 */
export function toAirQuality(raw: RawAirQualityResponse): AirQuality {
  const v = raw.current?.us_aqi;
  return { usAqi: typeof v === 'number' ? v : null };
}

/**
 * Fetch the current US AQI for a location from Open-Meteo. On any fetch/HTTP
 * failure this returns a `DataResult` failure (caller can show stale data); on
 * success it always returns an AirQuality, with `usAqi: null` when the model has
 * no value for that point (rare — Open-Meteo is model-based with no station gaps).
 */
export async function fetchAirQuality(
  lat: number,
  lon: number,
): Promise<DataResult<AirQuality>> {
  const url =
    `${OPEN_METEO_AIR_QUALITY_URL}?latitude=${lat}&longitude=${lon}` +
    `&current=${CURRENT_FIELDS}`;
  const res = await fetchJson<RawAirQualityResponse>(url);
  if (!res.ok) {
    return res;
  }
  // A response with no `current` object is malformed; anything else (including a
  // null us_aqi) is a valid "no value" → { usAqi: null }.
  if (typeof res.data.current !== 'object' || res.data.current === null) {
    return fail('bad-response');
  }
  return ok(toAirQuality(res.data));
}

// ---------------------------------------------------------------------------
// AirNow adapter seam (plan §8) — the future EPA AirNow upgrade behind a proxy.
//
// AirNow (Appendix B) is the official EPA observation source but needs a free
// API key (a secret) and is station-based (rural gaps). v1 deliberately ships
// Open-Meteo and keeps this typed seam so a later phase can swap the AQI source
// without touching callers: route fetchAirQuality → fetchAirQualityAirNow behind
// a config flag once a proxy holds the key. Until then it is NOT wired and
// throws a clear "not implemented" error if called directly.
// ---------------------------------------------------------------------------

/** Config the AirNow adapter will require once implemented. */
export interface AirNowConfig {
  /** Base URL of the key-holding proxy (NOT api.airnowapi.org directly — the
   *  key must never ship in the client; plan §8). */
  proxyBaseUrl: string;
  /** Search radius in miles (AirNow `distance` param; rural gaps → empty). */
  distanceMiles?: number;
}

/**
 * AirNow adapter STUB (plan §8). Same shape as `fetchAirQuality` so it is a
 * drop-in source swap. Not implemented in v1 — calling it throws so a
 * misconfiguration is loud rather than silently returning fake data.
 *
 * @throws Error always, until the EPA AirNow proxy upgrade is implemented.
 */
export async function fetchAirQualityAirNow(
  _lat: number,
  _lon: number,
  _config: AirNowConfig,
): Promise<DataResult<AirQuality>> {
  throw new Error(
    'AirNow adapter not implemented in v1 — Open-Meteo is the active AQI source ' +
      '(plan §8). Implement behind a key-holding proxy before wiring.',
  );
}
