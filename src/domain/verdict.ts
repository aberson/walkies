// src/domain/verdict.ts — the 5-signal verdict engine (Appendix E). PURE.
//
// Headline verdict = MOST RESTRICTIVE (worst) of five independent signals:
//   1. Pavement burn  2. Heat stress  3. Air quality  4. Cold  5. Active alert
// "Most restrictive signal wins" — a great temperature never hides a hazardous
// AQI or an active storm warning.

import { dogRisk } from './dogRisk';
import { heatIndex } from './heatIndex';
import { pavementTempF } from './pavement';
import type {
  AirQuality,
  Alert,
  BindingSignal,
  DogProfile,
  Verdict,
  VerdictLevel,
  WeatherSnapshot,
} from './types';

// ---- Band thresholds (Appendix E), as named constants (one source of truth) --

/** Pavement-burn (asphalt estimate) bands, °F. */
export const PAVEMENT_YELLOW_F = 115;
export const PAVEMENT_RED_F = 125;

/**
 * Heat-stress bands compared against the EFFECTIVE heat index
 * (= heatIndex + heatOffsetF). See the direction note below.
 */
export const HEAT_YELLOW_F = 75;
export const HEAT_HIGH_F = 85; // yellow for healthy, RED for vulnerable
export const HEAT_RED_F = 90;
/** Backstop: airTempF + RH at/above this forces >= yellow. */
export const HEAT_BACKSTOP_SUM = 150;

/** Air-quality (US AQI) bands. */
export const AQI_YELLOW = 100;
export const AQI_RED = 150;

/** Cold bands, °F. */
export const COLD_YELLOW_F = 32;
export const COLD_RED_F = 20;

/** Recommended max walk minutes by level. */
export const RECOMMENDED_MINUTES: Readonly<Record<VerdictLevel, number>> = {
  green: 45, // range 30–60
  yellow: 12, // range 10–15
  red: 0, // potty-break only
};

const SEVEN_SECOND_NOTE =
  'Tip: do the 7-second test — if you can’t hold the back of your hand on the ' +
  'pavement for 7 seconds, it’s too hot for paws.';

// ---- Level ordering --------------------------------------------------------

const LEVEL_RANK: Readonly<Record<VerdictLevel, number>> = {
  green: 0,
  yellow: 1,
  red: 2,
};

/** Return the more restrictive (worse) of two levels. */
function worse(a: VerdictLevel, b: VerdictLevel): VerdictLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

// ---- Signal result shape ---------------------------------------------------

interface SignalResult {
  level: VerdictLevel;
  signal: BindingSignal;
  /** Reason text, included only when the signal escalates above green. */
  reason: string;
}

// ---- Inputs ----------------------------------------------------------------

export interface VerdictInput {
  weather: WeatherSnapshot;
  airQuality: AirQuality;
  alerts: Alert[];
  profile: DogProfile;
  /**
   * Sun-exposure factor in [0,1] for this period (from sunPosition.sunFactor).
   * Passed in so the verdict engine stays pure of lat/date math.
   */
  sunFactor: number;
}

// ---- Alert classification --------------------------------------------------

const STORM_EVENT_RE =
  /thunderstorm|tornado|severe|hurricane|tropical storm|lightning/i;
const WARNING_RE = /warning/i;
const ADVISORY_RE = /advisor(y|ies)|watch/i;
/** Weather domains the verdict cares about (heat/cold/wind/winter/air). */
const RELEVANT_ALERT_RE =
  /heat|cold|wind|winter|blizzard|ice|snow|chill|air|smoke|stagnation|flag/i;

function classifyAlert(alert: Alert): SignalResult | null {
  const event = alert.event ?? '';

  // Any thunderstorm/tornado/severe → red (don't walk in lightning).
  if (STORM_EVENT_RE.test(event) || /extreme|severe/i.test(alert.severity)) {
    return {
      level: 'red',
      signal: 'alert',
      reason: `Active alert: ${event || alert.headline} — do not walk now.`,
    };
  }

  // Only heat/cold/wind/winter/air-domain alerts feed this signal.
  if (!RELEVANT_ALERT_RE.test(event)) {
    return null;
  }

  if (WARNING_RE.test(event)) {
    return {
      level: 'red',
      signal: 'alert',
      reason: `Active warning: ${event} — unsafe to walk now.`,
    };
  }
  if (ADVISORY_RE.test(event)) {
    return {
      level: 'yellow',
      signal: 'alert',
      reason: `Active advisory: ${event} — take extra care.`,
    };
  }
  // Fallback: a relevant-domain alert that is neither Warning nor
  // Advisory/Watch (e.g. NWS "Air Quality Alert", Appendix B) must NOT be
  // silently dropped — it still names a real hazard, so escalate to at least
  // yellow. This is the only air signal when AQI data is null.
  return {
    level: 'yellow',
    signal: 'alert',
    reason: `Active alert: ${event} — take extra care.`,
  };
}

function hasActiveExtremeColdWarning(alerts: Alert[]): boolean {
  return alerts.some((a) => /extreme cold warning/i.test(a.event ?? ''));
}

// ---- The engine ------------------------------------------------------------

/**
 * Compute the headline verdict for one weather period and one dog.
 *
 * @param input weather + AQI + alerts + profile + sunFactor
 * @returns the most-restrictive Verdict across the five signals
 */
export function computeVerdict(input: VerdictInput): Verdict {
  const { weather, airQuality, alerts, profile, sunFactor } = input;
  const risk = dogRisk(profile);
  const vulnerable = risk.heatOffsetF > 0;

  const pavement = pavementTempF(
    weather.airTempF,
    sunFactor,
    weather.skyCoverPct,
    'asphalt',
  );

  const signals: SignalResult[] = [];

  // ---- (1) Pavement burn (asphalt estimate) ----
  {
    let level: VerdictLevel = 'green';
    if (pavement >= PAVEMENT_RED_F) {
      level = 'red';
    } else if (pavement >= PAVEMENT_YELLOW_F) {
      level = 'yellow';
    }
    if (level !== 'green') {
      signals.push({
        level,
        signal: 'pavement',
        reason:
          `Estimated asphalt is ~${Math.round(pavement)}°F — ` +
          (level === 'red'
            ? 'hot enough to burn paws.'
            : 'getting hot for paws; stick to grass/shade.'),
      });
    }
  }

  // ---- (2) Heat stress ----
  // DIRECTION NOTE (deviation from literal Appendix-E wording):
  // Appendix E literally says "heat index, then subtract heatOffsetF", but the
  // design intent stated throughout §8 is that vulnerability shifts thresholds
  // DOWN — a vulnerable dog must reach yellow/red at a LOWER air temp. Adding
  // the offset to the heat index (equivalently, lowering the thresholds) is the
  // only formulation that satisfies done-when test #3. We therefore ADD the
  // offset to the heat index. (Subtracting it would make vulnerable dogs *less*
  // restricted — the opposite of the intent — so we deliberately do NOT.)
  {
    const hi = heatIndex(weather.airTempF, weather.relativeHumidity);
    const effectiveHI = hi + risk.heatOffsetF;

    let level: VerdictLevel = 'green';
    if (effectiveHI >= HEAT_RED_F) {
      level = 'red';
    } else if (effectiveHI >= HEAT_HIGH_F) {
      // 85–89: yellow for a healthy dog, RED for any vulnerable dog.
      level = vulnerable ? 'red' : 'yellow';
    } else if (effectiveHI >= HEAT_YELLOW_F) {
      level = 'yellow';
    }

    // Backstop: very hot + humid forces at least yellow (red if vulnerable).
    if (weather.airTempF + weather.relativeHumidity >= HEAT_BACKSTOP_SUM) {
      level = worse(level, vulnerable ? 'red' : 'yellow');
    }

    if (level !== 'green') {
      const ageYears = Math.floor(profile.ageMonths / 12);
      const who =
        vulnerable && profile.breed && profile.breed !== 'custom'
          ? `For your ${ageYears}-year-old ${profile.breed}, `
          : '';
      signals.push({
        level,
        signal: 'heat',
        reason:
          `${who}the heat index (${Math.round(hi)}°F` +
          (risk.heatOffsetF > 0
            ? `, effectively ${Math.round(effectiveHI)}°F for this dog`
            : '') +
          ') ' +
          (level === 'red'
            ? 'is unsafe — wait for a cooler window.'
            : 'is warm — keep it short and shaded.'),
      });
    }
  }

  // ---- (3) Air quality (drop the signal entirely when usAqi is null) ----
  // Loose `!= null` so an `undefined` usAqi (a realistic data-layer mapping
  // omission) is also dropped, rather than slipping through with `undefined`
  // numeric comparisons.
  if (airQuality.usAqi != null) {
    const aqi = airQuality.usAqi;
    let level: VerdictLevel = 'green';
    if (aqi > AQI_RED) {
      level = 'red';
    } else if (aqi >= AQI_YELLOW) {
      level = risk.respiratorySensitive ? 'red' : 'yellow';
    }
    if (level !== 'green') {
      signals.push({
        level,
        signal: 'airQuality',
        reason:
          `Air quality is poor (US AQI ${aqi})` +
          (risk.respiratorySensitive
            ? ' — risky for a respiratory-sensitive dog.'
            : ' — limit time outdoors.'),
      });
    }
  }

  // ---- (4) Cold ----
  {
    const t = weather.airTempF;
    const coldSensitive = profile.size === 'small' || profile.coat === 'short';
    const extremeColdWarning = hasActiveExtremeColdWarning(alerts);

    let level: VerdictLevel = 'green';
    if (t < COLD_RED_F || extremeColdWarning) {
      level = coldSensitive ? 'red' : 'yellow';
    } else if (t <= COLD_YELLOW_F) {
      level = coldSensitive ? 'yellow' : 'green';
    }
    if (level !== 'green') {
      signals.push({
        level,
        signal: 'cold',
        reason:
          `It's cold (${Math.round(t)}°F)` +
          (coldSensitive
            ? ' — tough on a small or short-coated dog; keep it brief.'
            : ' — keep the walk short.'),
      });
    }
  }

  // ---- (5) Active NWS alerts ----
  for (const alert of alerts) {
    const result = classifyAlert(alert);
    if (result) {
      signals.push(result);
    }
  }

  // ---- Resolve the headline (most restrictive wins) ----
  let level: VerdictLevel = 'green';
  let bindingSignal: BindingSignal = 'none';
  for (const s of signals) {
    if (LEVEL_RANK[s.level] > LEVEL_RANK[level]) {
      level = s.level;
      bindingSignal = s.signal;
    }
  }

  // Reasons: the binding signal(s) first (those at the headline level), then
  // any lower-but-non-green caveats. The 7-second pavement note is ALWAYS last.
  const headlineReasons = signals
    .filter((s) => s.level === level && level !== 'green')
    .map((s) => s.reason);
  const otherReasons = signals
    .filter((s) => s.level !== level && s.level !== 'green')
    .map((s) => s.reason);

  const reasons: string[] = [...headlineReasons, ...otherReasons];
  if (level === 'green') {
    reasons.push('Conditions look good for a walk right now.');
  }
  reasons.push(SEVEN_SECOND_NOTE);

  const headline =
    level === 'green'
      ? 'Great time for a walk'
      : level === 'yellow'
        ? 'Short walk in shade recommended'
        : 'Unsafe right now';

  return {
    level,
    headline,
    reasons,
    pavementTempF: pavement,
    recommendedMaxMinutes: RECOMMENDED_MINUTES[level],
    bindingSignal,
  };
}
