// src/ui/format.ts — DISPLAY-only units formatting (plan §3.1 Settings, Step 7).
//
// The domain stores everything in US units: temperatures in °F (e.g.
// `Verdict.pavementTempF`, `WeatherSnapshot.airTempF`) and any distance in miles.
// These helpers convert ONLY for display against the user's chosen `Settings`
// units; the domain core never sees a converted value, so it stays pure and the
// "asphalt worst-case" headline math is untouched.
//
// ONE source of truth for the conversion math: `fToC` / `milesToKm` are the only
// place °F→°C and mi→km happen, so a future re-duplication can't drift.

import type { Settings } from '../domain/types';

/** °F→°C — the single conversion. */
export function fToC(tempF: number): number {
  return ((tempF - 32) * 5) / 9;
}

/** miles→km — the single conversion. */
export function milesToKm(miles: number): number {
  return miles * 1.609344;
}

/**
 * Format a temperature (stored in °F) for display in the user's chosen unit.
 * Rounds to a whole degree (sensible for a walk verdict — sub-degree precision is
 * noise). Non-finite input renders the em-dash placeholder so a NaN pavement
 * estimate never shows "NaN°F".
 *
 * Examples: `formatTemperature(125, 'F')` → "125°F";
 * `formatTemperature(125, 'C')` → "52°C".
 */
export function formatTemperature(
  tempF: number,
  unit: Settings['temperatureUnit'],
): string {
  if (!Number.isFinite(tempF)) {
    return '—';
  }
  const value = unit === 'C' ? fToC(tempF) : tempF;
  return `${Math.round(value)}°${unit}`;
}

/**
 * Format a distance (stored in miles) for display in the user's chosen unit.
 * Rounds to one decimal place. Non-finite input renders the em-dash placeholder.
 *
 * Examples: `formatDistance(1, 'mi')` → "1 mi"; `formatDistance(1, 'km')` → "1.6 km".
 */
export function formatDistance(
  miles: number,
  unit: Settings['distanceUnit'],
): string {
  if (!Number.isFinite(miles)) {
    return '—';
  }
  const value = unit === 'km' ? milesToKm(miles) : miles;
  // Round to one decimal, then drop a trailing ".0" so whole values read cleanly.
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text} ${unit}`;
}
