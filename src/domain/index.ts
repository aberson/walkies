// src/domain — PURE verdict engine public API (no RN, no network, no storage).

export * from './types';
export { heatIndex } from './heatIndex';
export { solarElevationDeg, sunFactor } from './sunPosition';
export {
  pavementTempF,
  ASPHALT_FULL_SUN_DELTA,
  CLOUD_ATTENUATION,
  SURFACE_FACTOR,
} from './pavement';
export {
  dogRisk,
  RISK_WEIGHTS,
  SENIOR_AGE_MONTHS,
  PUPPY_AGE_MONTHS,
  MAX_RISK_POINTS,
  HEAT_OFFSET_F_PER_POINT,
} from './dogRisk';
export type { DogRisk } from './dogRisk';
export {
  computeVerdict,
  RECOMMENDED_MINUTES,
  PAVEMENT_YELLOW_F,
  PAVEMENT_RED_F,
  HEAT_YELLOW_F,
  HEAT_HIGH_F,
  HEAT_RED_F,
  HEAT_BACKSTOP_SUM,
  AQI_YELLOW,
  AQI_RED,
  COLD_YELLOW_F,
  COLD_RED_F,
} from './verdict';
export type { VerdictInput } from './verdict';
export { scanWindows } from './windows';
export type { WalkWindow, WindowScanInput, WindowScanResult } from './windows';
