// src/storage/settings.ts — parse-guarded, versioned persistence of app
// Settings (plan §3.1, key `walkies.settings.v1`). Same parse-guard discipline
// as profile.ts / cache.ts: malformed JSON, a schemaVersion mismatch, or any
// shape mismatch is treated as ABSENT and resolved to DEFAULT_SETTINGS, so the
// app always has a usable settings object. Writes are last-write-wins.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Settings, Surface } from '../domain/types';

/** AsyncStorage key for the persisted settings (plan §3.1). */
export const SETTINGS_KEY = 'walkies.settings.v1';

/** The schemaVersion the current build writes and accepts. */
const SETTINGS_SCHEMA_VERSION = 1 as const;

/**
 * Sensible defaults returned whenever settings are absent or unreadable. US
 * imperial units by default (primary audience), asphalt surface (the
 * worst-case the pavement model assumes), notifications off until opted in,
 * disclaimer unacknowledged.
 */
export const DEFAULT_SETTINGS: Settings = {
  temperatureUnit: 'F',
  distanceUnit: 'mi',
  defaultSurface: 'asphalt',
  notificationsEnabled: false,
  onboardingAcknowledged: false,
  schemaVersion: SETTINGS_SCHEMA_VERSION,
};

const SURFACES: readonly Surface[] = ['asphalt', 'concrete', 'grass'];

function isSettings(value: unknown): value is Settings {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === SETTINGS_SCHEMA_VERSION &&
    (v.temperatureUnit === 'F' || v.temperatureUnit === 'C') &&
    (v.distanceUnit === 'mi' || v.distanceUnit === 'km') &&
    (SURFACES as readonly unknown[]).includes(v.defaultSurface) &&
    typeof v.notificationsEnabled === 'boolean' &&
    (v.onboardingAcknowledged === undefined ||
      typeof v.onboardingAcknowledged === 'boolean')
  );
}

/** Persist settings (last-write-wins). Rethrows on a storage error. */
export async function saveSettings(settings: Settings): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Load settings, falling back to `DEFAULT_SETTINGS` whenever absent, malformed,
 * version-mismatched, or shape-mismatched. Never throws; always returns a
 * usable Settings object.
 */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw === null) {
      return DEFAULT_SETTINGS;
    }
    const parsed: unknown = JSON.parse(raw);
    return isSettings(parsed) ? parsed : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}
