// src/domain/pavement.ts — estimated pavement temperature (§4.2 item 3).
// Calibrated to Berens (1970) full-sun data points. PURE.

import type { Surface } from './types';

/**
 * °F a full-sun asphalt surface gains over air temperature at peak sun.
 * Calibrated to Berens: 77°F air → ~127°F asphalt (target 125°F, ±5°F band).
 */
export const ASPHALT_FULL_SUN_DELTA = 50;

/** Cloud attenuation coefficient: overcast still gains some heat. */
export const CLOUD_ATTENUATION = 0.7;

/**
 * Relative solar absorptivity by surface. ONE source of truth — the verdict
 * engine and any caller imports this rather than re-defining it.
 */
export const SURFACE_FACTOR: Readonly<Record<Surface, number>> = {
  asphalt: 1.0,
  concrete: 0.55,
  grass: 0.1,
};

/**
 * Estimated pavement temperature, °F.
 *
 * `pavementTempF = airTempF + ASPHALT_FULL_SUN_DELTA * sunFactor *
 *  cloudFactor * surfaceFactor`, where
 * `cloudFactor = 1 - CLOUD_ATTENUATION * (skyCoverPct / 100)`.
 *
 * `sunFactor` (in [0,1]) is passed in — not derived from lat/date here — so the
 * pavement model is testable independently of the solar-position math.
 *
 * Calibration: airTempF=77, sunFactor=1, skyCoverPct=0, surface=asphalt → 127°F
 * (within ±5°F of the Berens 125°F target).
 *
 * @param airTempF air temperature, °F
 * @param sunFactor sun-exposure factor in [0,1] (see sunPosition.sunFactor)
 * @param skyCoverPct sky cover, percent (0–100)
 * @param surface walking surface
 * @returns estimated surface temperature, °F
 */
export function pavementTempF(
  airTempF: number,
  sunFactor: number,
  skyCoverPct: number,
  surface: Surface,
): number {
  const cloudFactor = 1 - CLOUD_ATTENUATION * (skyCoverPct / 100);
  const surfaceFactor = SURFACE_FACTOR[surface];
  return (
    airTempF + ASPHALT_FULL_SUN_DELTA * sunFactor * cloudFactor * surfaceFactor
  );
}
