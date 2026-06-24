// src/domain/types.ts — shared domain types for the PURE verdict engine.
// No React Native, no network, no storage imports allowed in src/domain/.

/** Walking surface the pavement-temperature model is evaluated against. */
export type Surface = 'asphalt' | 'concrete' | 'grass';

/** Coat type — drives cold tolerance and (double_thick) heat vulnerability. */
export type Coat = 'short' | 'medium' | 'double_thick';

/** Size band: <10kg / 10–25 / 25–45 / >45 kg (Appendix A). */
export type Size = 'small' | 'medium' | 'large' | 'giant';

/** Body-condition score band. */
export type BodyCondition = 'under' | 'ideal' | 'overweight' | 'obese';

/** Health conditions that raise heat/respiratory risk. */
export type DogCondition =
  | 'respiratory'
  | 'cardiac'
  | 'laryngeal_paralysis'
  | 'tracheal_collapse'
  | 'none';

/**
 * The single dog profile (Appendix A). v1 stores exactly one of these.
 * `schemaVersion` is a literal so a future migration can branch on it.
 */
export interface DogProfile {
  name: string;
  /** From the seed list or "custom". */
  breed: string;
  /** Flat-faced; auto-set from breed, user-overridable. */
  brachycephalic: boolean;
  /** Age in months. puppy < 6 mo, senior >= 84 mo (7 yr). */
  ageMonths: number;
  size: Size;
  bodyCondition: BodyCondition;
  coat: Coat;
  /** Minor factor (weak evidence). */
  darkCoat: boolean;
  conditions: DogCondition[];
  schemaVersion: 1;
}

/**
 * User-tunable app settings (Step 4 storage; Step 7 wires the UI). Persisted
 * under `walkies.settings.v1`. `schemaVersion` is a literal so a future
 * migration can branch on it, mirroring `DogProfile`.
 */
export interface Settings {
  /** Display unit for temperatures. */
  temperatureUnit: 'F' | 'C';
  /** Display unit for distances. */
  distanceUnit: 'mi' | 'km';
  /** Surface the verdict defaults to (overridable per-check later). */
  defaultSurface: Surface;
  /** Whether best-window local notifications are enabled. */
  notificationsEnabled: boolean;
  /**
   * Whether the user has acknowledged the "informational, not veterinary
   * advice" disclaimer. Optional — Step 7 owns the disclaimer UI; defaults to
   * `false` (unacknowledged) when absent.
   */
  onboardingAcknowledged?: boolean;
  schemaVersion: 1;
}

/**
 * One hour (or "now") of weather, already normalised to the units the domain
 * core expects. Produced by the data layer from NWS responses.
 */
export interface WeatherSnapshot {
  /** ISO 8601 start time of this period (used as the window label source). */
  startTime: string;
  airTempF: number;
  /** Relative humidity, percent (0–100). */
  relativeHumidity: number;
  windSpeedMph: number;
  /** Sky cover, percent (0–100). 0 = clear, 100 = overcast. */
  skyCoverPct: number;
  /** Probability of precipitation, percent (0–100). */
  precipProbability: number;
  isDaytime: boolean;
}

/** Air-quality reading. `usAqi` may be null when no value is available. */
export interface AirQuality {
  /** US EPA AQI (0–500+), or null when unavailable. */
  usAqi: number | null;
}

/** An active NWS alert (Appendix B § alerts/active). */
export interface Alert {
  /** e.g. "Extreme Heat Warning", "Severe Thunderstorm Warning". */
  event: string;
  /** NWS severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown". */
  severity: string;
  /** ISO 8601, or null. */
  onset: string | null;
  /** ISO 8601, or null. */
  ends: string | null;
  headline: string;
}

/** Geographic point + time used for sun-elevation calculation. */
export interface GeoPoint {
  lat: number;
  lon: number;
}

export type VerdictLevel = 'green' | 'yellow' | 'red';

/** Which of the five signals drove the headline verdict. */
export type BindingSignal =
  | 'pavement'
  | 'heat'
  | 'airQuality'
  | 'cold'
  | 'alert'
  | 'none';

/** The single output of the verdict engine. */
export interface Verdict {
  level: VerdictLevel;
  headline: string;
  reasons: string[];
  /** Estimated asphalt pavement temperature, °F. */
  pavementTempF: number;
  /** Recommended max walk minutes (green→45, yellow→12, red→0). */
  recommendedMaxMinutes: number;
  /** The signal that produced the (most-restrictive) headline level. */
  bindingSignal: BindingSignal;
}
