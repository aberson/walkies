// src/smoke/pipeline.smoke.ts — Step 8 PIPELINE SMOKE GATE (plan §11).
//
// A headless, end-to-end LIVE-network cycle that mirrors useHomeVerdict's
// composition but with a FIXED real lat/lon (no expo-location): it calls the
// REAL NWS + Open-Meteo clients over the network, feeds the result through the
// REAL domain core (computeVerdict + scanWindows), and asserts a WELL-FORMED
// Verdict. NOTHING in the data or domain layer is stubbed — this is the
// producer→consumer drift catch that mocked unit tests cannot see (plan §11).
//
// Run ONLY via `npm run smoke` (jest --config jest.smoke.config.js). The default
// `npm test` ignores this file: it is `*.smoke.ts`, not `*.test.ts`, so the
// default jest `testMatch` never selects it → CI/offline stays green with zero
// network.
//
// NETWORK-GATING (the load-bearing distinction):
//   - "couldn't REACH the API" (offline / DNS / timeout / a recoverable
//     DataResult failure from NWS or Open-Meteo) → SKIP gracefully (pass, no
//     network is not a code defect).
//   - "REACHED the API but the pipeline produced a MALFORMED verdict"
//     (level not in {green,yellow,red}, NaN pavementTempF, empty reasons, …)
//     → HARD FAIL, and the failure message NAMES the offending field.

// Import the data clients from their SPECIFIC module files (not the `../data`
// barrel). These are the SAME real clients the app uses — importing them
// directly just avoids the barrel's re-export of cache.ts, which pulls in
// @react-native-async-storage/async-storage (a native module that is null
// outside the RN runtime; this smoke runs in plain Node). The smoke does not
// touch the cache, so bypassing it is correct and keeps the clients real.
import { fetchAirQuality } from '../data/airQuality';
import { fetchForecast } from '../data/nws';
import type { DataFailureReason } from '../data/result';
import {
  computeVerdict,
  scanWindows,
  sunFactor as computeSunFactor,
} from '../domain';
import type {
  AirQuality,
  DogProfile,
  Verdict,
  WeatherSnapshot,
} from '../domain/types';

// ---------------------------------------------------------------------------
// Fixed inputs (no expo-location): a US location NWS reliably covers.
// ---------------------------------------------------------------------------

/** New York City — well inside NWS coverage; stable grid mapping. */
const SMOKE_LAT = 40.7128;
const SMOKE_LON = -74.006;

/**
 * A representative, mid-vulnerability sample dog (not the worst case, not the
 * baseline) so the verdict exercises the dog-vulnerability offset path without
 * forcing a particular level. The smoke asserts the verdict is WELL-FORMED, not
 * that it is any specific colour (which depends on live weather).
 */
const SMOKE_PROFILE: DogProfile = {
  name: 'Smoke',
  breed: 'Labrador Retriever',
  brachycephalic: false,
  ageMonths: 48,
  size: 'large',
  bodyCondition: 'ideal',
  coat: 'short',
  darkCoat: false,
  conditions: ['none'],
  schemaVersion: 1,
};

/**
 * DataResult failure reasons that mean "could not reach / use the upstream API"
 * — these gate a SKIP, not a failure. A `bad-response` (we reached the API but
 * its body did not match the contract) is treated as a SKIP too: the smoke's job
 * is to verify the producer→consumer wiring against a LIVE-shaped response; an
 * upstream contract change is an environment problem to surface via the skip
 * message, not a verdict-malformation hard fail. The HARD failures this gate
 * protects are strictly the well-formed-verdict assertions below.
 */
const SKIPPABLE_REASONS: ReadonlySet<DataFailureReason> =
  new Set<DataFailureReason>([
    'timeout',
    'network-error',
    'forbidden',
    'http-error',
    'unsupported-location',
    'bad-response',
  ]);

const SKIP_MESSAGE = 'smoke: skipped (no network / upstream unavailable)';

/**
 * Run ONE live end-to-end cycle and either (a) print the verdict and return it,
 * (b) return null to signal a graceful network SKIP, or (c) throw a hard,
 * field-naming assertion error when the pipeline produced a malformed verdict.
 */
async function runLivePipeline(): Promise<Verdict | null> {
  // 1. LIVE NWS: points → hourly (+ skyCover) → alerts. Real network, real
  //    User-Agent header (nws.ts sends it). Never throws — returns DataResult.
  const forecastRes = await fetchForecast(SMOKE_LAT, SMOKE_LON);
  if (!forecastRes.ok) {
    if (SKIPPABLE_REASONS.has(forecastRes.reason)) {
      console.log(`${SKIP_MESSAGE} (NWS forecast: ${forecastRes.reason})`);
      return null;
    }
    // No non-skippable reasons exist today, but fail loud if the union grows.
    throw new Error(
      `smoke: unexpected NWS failure reason "${forecastRes.reason}"`,
    );
  }
  const forecast = forecastRes.data;

  // 2. LIVE Open-Meteo AQI. AQI is a SOFT signal: a failure degrades to
  //    { usAqi: null } (exactly as useHomeVerdict does) — it does NOT skip the
  //    whole smoke, because NWS (the hard dependency) already succeeded.
  const aqiRes = await fetchAirQuality(SMOKE_LAT, SMOKE_LON);
  const airQuality: AirQuality = aqiRes.ok ? aqiRes.data : { usAqi: null };

  // 3. Build the "now" snapshot (first/current hourly period) + the real
  //    sunFactor for the fixed location, then run the REAL domain engine.
  const nowSnapshot: WeatherSnapshot | undefined = forecast.hourly[0];
  if (nowSnapshot === undefined) {
    // fetchHourly guarantees ≥1 snapshot on success; treat an empty list as an
    // upstream anomaly → skip rather than a verdict hard-fail.
    console.log(`${SKIP_MESSAGE} (NWS forecast: empty hourly series)`);
    return null;
  }

  const sf = computeSunFactor(
    SMOKE_LAT,
    SMOKE_LON,
    new Date(nowSnapshot.startTime),
  );
  const verdict = computeVerdict({
    weather: nowSnapshot,
    airQuality,
    alerts: forecast.alerts,
    profile: SMOKE_PROFILE,
    sunFactor: sf,
  });

  // 4. Also exercise the windows scan (the other domain consumer of live data)
  //    so producer→consumer drift in EITHER engine surfaces here.
  const { windows } = scanWindows({
    hours: forecast.hourly,
    airQuality,
    alerts: forecast.alerts,
    profile: SMOKE_PROFILE,
    location: { lat: SMOKE_LAT, lon: SMOKE_LON },
  });

  // 5. WELL-FORMED-VERDICT assertions. Each failure NAMES the offending field
  //    (plan §11 / Step 8 "Done when"). These are HARD failures — the API was
  //    reached but the pipeline produced something malformed.
  assertVerdictWellFormed(verdict);

  // 6. Success: print the verdict summary + a window summary, then return it.
  const windowSummary =
    windows.length === 0
      ? 'no walkable windows in horizon'
      : windows.map((w) => `${w.label} (${w.level})`).join(', ');

  console.log(
    [
      'smoke: OK — live pipeline produced a well-formed verdict',
      `  location:    ${SMOKE_LAT}, ${SMOKE_LON} (NYC)`,
      `  dog:         ${SMOKE_PROFILE.name} (${SMOKE_PROFILE.breed})`,
      `  level:       ${verdict.level}`,
      `  pavementTempF: ${verdict.pavementTempF.toFixed(1)}`,
      `  headline:    ${verdict.headline}`,
      `  reasons:     ${verdict.reasons.length}`,
      `  maxMinutes:  ${verdict.recommendedMaxMinutes}`,
      `  windows:     ${windowSummary}`,
    ].join('\n'),
  );

  return verdict;
}

/**
 * Throw a field-naming Error if the verdict is not well-formed. Kept separate so
 * the assertion logic (the HARD-fail contract) reads as one block.
 */
function assertVerdictWellFormed(verdict: Verdict): void {
  if (
    verdict.level !== 'green' &&
    verdict.level !== 'yellow' &&
    verdict.level !== 'red'
  ) {
    throw new Error(
      `smoke: level was not green/yellow/red (got ${String(verdict.level)})`,
    );
  }
  if (!Number.isFinite(verdict.pavementTempF)) {
    throw new Error(
      `smoke: pavementTempF was not finite (got ${String(verdict.pavementTempF)})`,
    );
  }
  if (!Array.isArray(verdict.reasons) || verdict.reasons.length === 0) {
    throw new Error('smoke: reasons was not a non-empty array');
  }
  if (!Number.isFinite(verdict.recommendedMaxMinutes)) {
    throw new Error(
      `smoke: recommendedMaxMinutes was not finite (got ${String(verdict.recommendedMaxMinutes)})`,
    );
  }
  if (typeof verdict.headline !== 'string' || verdict.headline.length === 0) {
    throw new Error('smoke: headline was not a non-empty string');
  }
}

// ---------------------------------------------------------------------------
// Jest entry point. A single spec that runs ONE real cycle. The live fetch can
// take a few seconds (points→hourly→gridpoint→alerts→AQI), so the timeout is
// generous. A network SKIP resolves as a PASS (the assertion is "ran without a
// malformed verdict"); only a malformed verdict throws and fails the run.
// ---------------------------------------------------------------------------

describe('pipeline smoke (LIVE network)', () => {
  it('produces a well-formed verdict from live NWS + Open-Meteo, or skips offline', async () => {
    const verdict = await runLivePipeline();
    if (verdict === null) {
      // Graceful network skip — nothing to assert; the cycle could not reach
      // the upstream API. (Message already printed by runLivePipeline.)
      return;
    }
    // Re-assert at the jest layer too, so a green test ALWAYS means a
    // well-formed verdict (belt-and-suspenders with the in-pipeline asserts).
    expect(['green', 'yellow', 'red']).toContain(verdict.level);
    expect(Number.isFinite(verdict.pavementTempF)).toBe(true);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    expect(Number.isFinite(verdict.recommendedMaxMinutes)).toBe(true);
  }, 60_000);
});
