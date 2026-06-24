// src/data/http.ts — a single timeout-guarded JSON fetch helper that classifies
// failures into the shared `DataResult` reasons. Both nws.ts and airQuality.ts
// route through this so the degradation contract (plan §9) lives in ONE place:
//   - AbortController timeout      -> 'timeout'
//   - HTTP 403                     -> 'forbidden'
//   - HTTP 404                     -> 'unsupported-location' ONLY when the caller
//                                     opts in (NWS /points: non-US coords);
//                                     otherwise a 404 is a plain 'http-error'.
//   - other non-2xx                -> 'http-error'
//   - fetch reject (offline/DNS)   -> 'network-error'
//   - JSON.parse failure           -> 'bad-response'

import { fail, ok, type DataResult } from './result';

/** Default request timeout (ms). NWS/Open-Meteo are normally fast; 10s is slack. */
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchJsonOptions {
  /** Extra request headers (NWS supplies its required User-Agent here). */
  headers?: Record<string, string>;
  /** Abort the request after this many ms. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Treat an HTTP 404 as `'unsupported-location'` rather than the generic
   * `'http-error'`. Only the NWS `/points` step un-validates a location, so only
   * that call should opt in; a transient 404 on an already-validated grid/alerts
   * URL must NOT be mis-reported as "US-only" (plan §9).
   */
  unsupportedOn404?: boolean;
}

/**
 * Fetch `url` and parse the JSON body, never throwing — every failure mode is
 * mapped to a `DataResult` failure reason (see file header). The request is
 * wrapped in an AbortController so a hung connection resolves as `'timeout'`.
 *
 * The timeout stays armed THROUGH the body parse (`response.json()`): a server
 * that flushes headers fast but stalls the body is still aborted → `'timeout'`,
 * never an open-ended hang. The timer is always cleared exactly once.
 *
 * @typeParam T the expected (unvalidated) JSON shape; callers must still guard
 *   the fields they read.
 */
export async function fetchJson<T>(
  url: string,
  options: FetchJsonOptions = {},
): Promise<DataResult<T>> {
  const {
    headers,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    unsupportedOn404 = false,
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(url, { headers, signal: controller.signal });
    } catch (err) {
      // AbortController.abort() rejects the fetch with an AbortError.
      if (err instanceof Error && err.name === 'AbortError') {
        return fail('timeout');
      }
      return fail('network-error');
    }

    if (!response.ok) {
      if (response.status === 403) {
        return fail('forbidden');
      }
      if (response.status === 404 && unsupportedOn404) {
        // NWS /points returns 404 for coordinates outside US coverage.
        return fail('unsupported-location');
      }
      return fail('http-error');
    }

    // Parse the body with the timeout STILL armed — a hung response body must
    // abort too, otherwise a fast-headers/slow-body server escapes the ceiling.
    try {
      const data = (await response.json()) as T;
      return ok(data);
    } catch (err) {
      // A body that hangs until the controller aborts rejects json() with an
      // AbortError → classify as 'timeout', same as a hung connection. Any other
      // parse failure is a malformed body → 'bad-response'.
      if (err instanceof Error && err.name === 'AbortError') {
        return fail('timeout');
      }
      return fail('bad-response');
    }
  } finally {
    // Always cleared, exactly once, only after json() settles (no early clear).
    clearTimeout(timer);
  }
}
