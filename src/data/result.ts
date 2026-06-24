// src/data/result.ts — the ONE result pattern shared across the data layer.
//
// Every network-touching public function in src/data returns a discriminated
// `DataResult<T>`: either { ok: true, data } or { ok: false, reason }. Callers
// switch on `.ok`; nothing in this layer throws a network/HTTP error to the
// caller (plan §9 degradation contract). `reason` is a closed string union so
// the UI can map each failure to a specific message (e.g. the US-only notice).

/** Why a data fetch could not produce a usable value (plan §9). */
export type DataFailureReason =
  /** HTTP 403 — NWS rejected the request (e.g. throttling / bad User-Agent). */
  | 'forbidden'
  /** Request exceeded the timeout / was aborted. */
  | 'timeout'
  /** Coordinates are outside NWS coverage (NWS /points returns 404). US-only. */
  | 'unsupported-location'
  /** Any other HTTP error (4xx/5xx other than 403/404). */
  | 'http-error'
  /** Network failure (DNS, offline, connection reset). */
  | 'network-error'
  /** Response parsed but its shape did not match the expected contract. */
  | 'bad-response';

export type DataResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: DataFailureReason };

/** Construct a success result. */
export function ok<T>(data: T): DataResult<T> {
  return { ok: true, data };
}

/** Construct a failure result. */
export function fail<T = never>(reason: DataFailureReason): DataResult<T> {
  return { ok: false, reason };
}
