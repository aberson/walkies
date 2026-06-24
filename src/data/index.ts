// src/data — network clients; map raw API JSON to domain types.
// Public API for the data layer. Every network-touching function returns the
// shared DataResult (see result.ts) and degrades gracefully (plan §9) — none
// throws a network/HTTP error to the caller.

// Result pattern (the ONE pattern across the layer).
export { ok, fail } from './result';
export type { DataResult, DataFailureReason } from './result';

// HTTP helper (timeout-guarded JSON fetch + failure classification).
export { fetchJson, DEFAULT_TIMEOUT_MS } from './http';
export type { FetchJsonOptions } from './http';

// NWS client.
export {
  NWS_BASE_URL,
  NWS_USER_AGENT,
  fetchPoints,
  fetchHourly,
  fetchAlerts,
  fetchForecast,
  parseWindSpeedMph,
  parseValidTimeInterval,
  skyCoverAt,
  periodTempF,
  toWeatherSnapshot,
  toAlert,
} from './nws';
export type { NwsPoints, NwsForecast } from './nws';

// Open-Meteo air-quality client + AirNow adapter seam.
export {
  OPEN_METEO_AIR_QUALITY_URL,
  CURRENT_FIELDS,
  fetchAirQuality,
  toAirQuality,
  fetchAirQualityAirNow,
} from './airQuality';
export type { AirNowConfig } from './airQuality';

// In-memory TTL cache + persisted last-verdict.
export {
  TtlCache,
  CACHE_TTL_MS,
  LAST_VERDICT_KEY,
  saveLastVerdict,
  loadLastVerdict,
} from './cache';
export type { LastVerdict } from './cache';

// expo-location wrapper.
export { getCurrentLocation } from './location';
export type { LocationResult, LocationFailureReason } from './location';
