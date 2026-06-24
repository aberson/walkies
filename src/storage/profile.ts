// src/storage/profile.ts — parse-guarded, versioned persistence of the single
// DogProfile (plan §3.1, key `walkies.profile.v1`). Mirrors the cache.ts
// last-verdict parse-guard discipline: malformed JSON, a schemaVersion mismatch,
// or any shape mismatch is treated as ABSENT (returns null) so the app
// re-onboards instead of crashing. Writes are last-write-wins.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  BodyCondition,
  Coat,
  DogCondition,
  DogProfile,
  Size,
} from '../domain/types';

/** AsyncStorage key for the persisted dog profile (plan §3.1). */
export const PROFILE_KEY = 'walkies.profile.v1';

/** The schemaVersion the current build writes and accepts. */
const PROFILE_SCHEMA_VERSION = 1 as const;

const SIZES: readonly Size[] = ['small', 'medium', 'large', 'giant'];
const COATS: readonly Coat[] = ['short', 'medium', 'double_thick'];
const BODY_CONDITIONS: readonly BodyCondition[] = [
  'under',
  'ideal',
  'overweight',
  'obese',
];
const CONDITIONS: readonly DogCondition[] = [
  'respiratory',
  'cardiac',
  'laryngeal_paralysis',
  'tracheal_collapse',
  'none',
];

function isDogCondition(value: unknown): value is DogCondition {
  return (CONDITIONS as readonly unknown[]).includes(value);
}

/**
 * Full structural validation of a stored value against the DogProfile shape.
 * Returns false on any drift so a stale/corrupt record re-onboards rather than
 * feeding a malformed profile into the verdict engine.
 */
function isDogProfile(value: unknown): value is DogProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === PROFILE_SCHEMA_VERSION &&
    typeof v.name === 'string' &&
    typeof v.breed === 'string' &&
    typeof v.brachycephalic === 'boolean' &&
    typeof v.ageMonths === 'number' &&
    Number.isFinite(v.ageMonths) &&
    (SIZES as readonly unknown[]).includes(v.size) &&
    (BODY_CONDITIONS as readonly unknown[]).includes(v.bodyCondition) &&
    (COATS as readonly unknown[]).includes(v.coat) &&
    typeof v.darkCoat === 'boolean' &&
    Array.isArray(v.conditions) &&
    v.conditions.length > 0 &&
    v.conditions.every(isDogCondition)
  );
}

/**
 * Persist the dog profile (last-write-wins). Unlike the best-effort last-verdict
 * write, a profile-save failure is meaningful to the caller (the form should be
 * able to surface it), so this rethrows on a storage error.
 */
export async function saveProfile(profile: DogProfile): Promise<void> {
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/**
 * Load the persisted dog profile, or `null` when absent/corrupt/version-mismatch.
 * Parse-guarded: malformed JSON, a schemaVersion mismatch, or a shape mismatch
 * is treated as absent (never throws) so the app re-onboards.
 */
export async function loadProfile(): Promise<DogProfile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isDogProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
