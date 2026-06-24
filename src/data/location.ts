// src/data/location.ts — thin expo-location wrapper: request foreground
// permission, then return the current {lat, lon}. Denied permission or any
// device error returns a typed result (never a throw), matching the data-layer
// degradation contract (plan §9).

import * as Location from 'expo-location';

import type { GeoPoint } from '../domain/types';

/** Why we could not produce a location. */
export type LocationFailureReason =
  /** The user denied (or has not granted) foreground location permission. */
  | 'permission-denied'
  /** Permission granted but the device could not produce a fix. */
  | 'unavailable';

/**
 * Result of a location request. Mirrors the data layer's discriminated pattern:
 * { ok: true, data: GeoPoint } | { ok: false, reason }. Never throws.
 */
export type LocationResult =
  | { ok: true; data: GeoPoint }
  | { ok: false; reason: LocationFailureReason };

/**
 * Request foreground location permission and return the current coordinates.
 *
 * - Permission denied → { ok: false, reason: 'permission-denied' }.
 * - Granted but the fix fails/throws → { ok: false, reason: 'unavailable' }.
 * - Success → { ok: true, data: { lat, lon } }.
 *
 * No background-location permission is requested (plan §2: foreground only).
 */
export async function getCurrentLocation(): Promise<LocationResult> {
  let granted: boolean;
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    granted = permission.granted;
  } catch {
    // A thrown permission request is treated as denial (typed, not propagated).
    return { ok: false, reason: 'permission-denied' };
  }

  if (!granted) {
    return { ok: false, reason: 'permission-denied' };
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      ok: true,
      data: { lat: position.coords.latitude, lon: position.coords.longitude },
    };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
