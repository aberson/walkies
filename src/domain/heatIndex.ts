// src/domain/heatIndex.ts — NWS Rothfusz heat-index regression (Appendix C).
// Source: NWS WPC wpc.ncep.noaa.gov/html/heatindex_equation.shtml
// PURE: a function of (airTempF, relativeHumidity) only.

/**
 * Apparent temperature ("heat index") in °F from air temperature (°F) and
 * relative humidity (%), per the NWS Rothfusz regression.
 *
 * Algorithm (verbatim from Appendix C):
 *  1. Compute the simple form. If the average of (HI_simple, T) < 80°F, return
 *     HI_simple — the regression is only valid in the hot range.
 *  2. Otherwise use the full 9-term regression, then apply the two NWS
 *     boundary adjustments (low-RH and high-RH).
 *
 * @param airTempF air temperature, °F
 * @param relativeHumidity relative humidity, percent (0–100)
 * @returns heat index, °F
 */
export function heatIndex(airTempF: number, relativeHumidity: number): number {
  const T = airTempF;
  const RH = relativeHumidity;

  // Simple form (Steadman).
  const hiSimple = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + RH * 0.094);

  // Below 80°F the simple form is the authoritative answer.
  if ((hiSimple + T) / 2 < 80) {
    return hiSimple;
  }

  // Full Rothfusz regression.
  let hi =
    -42.379 +
    2.04901523 * T +
    10.14333127 * RH -
    0.22475541 * T * RH -
    0.00683783 * T * T -
    0.05481717 * RH * RH +
    0.00122874 * T * T * RH +
    0.00085282 * T * RH * RH -
    0.00000199 * T * T * RH * RH;

  // Low-humidity adjustment.
  if (RH < 13 && T >= 80 && T <= 112) {
    hi -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
  }

  // High-humidity adjustment.
  if (RH > 85 && T >= 80 && T <= 87) {
    hi += ((RH - 85) / 10) * ((87 - T) / 5);
  }

  return hi;
}
