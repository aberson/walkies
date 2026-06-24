// src/domain/sunPosition.ts — solar elevation angle (NOAA-style) and the
// derived sun-exposure factor for the pavement model.
// PURE: a function of (lat, lon, date) only. The Date is passed in by the
// caller — the domain core never reads the device clock itself.

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Day of year (1–366) for a Date, in UTC. */
function dayOfYearUTC(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  return Math.floor(diff / 86_400_000);
}

/**
 * Solar elevation angle in degrees for a location and instant.
 *
 * Uses the standard NOAA solar-position approximation (fractional-year →
 * declination + equation of time → hour angle → elevation). Accurate to a
 * fraction of a degree, which is far better than the pavement model needs.
 *
 * The supplied `Date` is interpreted in UTC; `lon` is degrees east (NWS/most
 * US points are negative). This keeps the function purely deterministic for
 * its inputs regardless of the host machine's timezone.
 *
 * @param lat latitude in degrees (north positive)
 * @param lon longitude in degrees (east positive; US is negative)
 * @param date the instant to evaluate
 * @returns solar elevation angle, degrees (negative = below horizon)
 */
export function solarElevationDeg(
  lat: number,
  lon: number,
  date: Date,
): number {
  // An Invalid Date (e.g. `new Date('bad')`) has a NaN time. Treat it as the
  // conservative "sun below the horizon" case rather than letting NaN propagate
  // through the trig and out into pavementTempF as a NaN surface temperature.
  if (!Number.isFinite(date.getTime())) {
    return -90;
  }
  const dayOfYear = dayOfYearUTC(date);
  const hourUTC =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;

  // Fractional year (radians).
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hourUTC - 12) / 24);

  // Equation of time (minutes).
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Solar declination (radians).
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // True solar time (minutes). 4 min per degree of longitude.
  const timeOffset = eqTime + 4 * lon; // no timezone term: hourUTC is already UTC
  const trueSolarTime = hourUTC * 60 + timeOffset;

  // Hour angle (degrees): 0 at solar noon, ±180 at midnight.
  let hourAngle = trueSolarTime / 4 - 180;
  // Normalise into [-180, 180].
  hourAngle = ((((hourAngle + 180) % 360) + 360) % 360) - 180;

  const latRad = lat * DEG_TO_RAD;
  const haRad = hourAngle * DEG_TO_RAD;

  // Solar zenith angle.
  const cosZenith =
    Math.sin(latRad) * Math.sin(decl) +
    Math.cos(latRad) * Math.cos(decl) * Math.cos(haRad);
  const clampedCosZenith = Math.max(-1, Math.min(1, cosZenith));
  const zenithRad = Math.acos(clampedCosZenith);

  // Elevation = 90° − zenith.
  return 90 - zenithRad * RAD_TO_DEG;
}

/** Clamp a number into [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Sun-exposure factor in [0, 1] for the pavement model: `sin(elevation)`,
 * clamped to 0 at or below the horizon (night). 1 only when the sun is
 * directly overhead. This is the multiplicative sun term in pavement.ts.
 *
 * @param lat latitude in degrees
 * @param lon longitude in degrees (east positive)
 * @param date the instant to evaluate
 * @returns sun factor in [0, 1]
 */
export function sunFactor(lat: number, lon: number, date: Date): number {
  const elevationDeg = solarElevationDeg(lat, lon, date);
  const factor = Math.sin(elevationDeg * DEG_TO_RAD);
  // Defence in depth: if the elevation (or sin) came out non-finite for any
  // reason, fall back to 0 (no sun) so `clamp` can't pass a NaN through —
  // Math.max/min do NOT filter NaN. Keeps pavementTempF finite.
  if (!Number.isFinite(factor)) {
    return 0;
  }
  return clamp(factor, 0, 1);
}
