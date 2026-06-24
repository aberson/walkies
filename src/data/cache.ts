// src/data/cache.ts — in-memory TTL cache + AsyncStorage last-verdict persistence.
// The TTLs (§3.2) keep the app within NWS/Open-Meteo fair-use while still feeling
// live. The last-verdict persistence (Appendix §3.1 key `walkies.cache.lastVerdict.v1`)
// lets the Home screen show an instant verdict on cold start while a fresh fetch runs.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { VerdictLevel } from '../domain/types';

/** Cache TTLs in milliseconds, per plan §3.2. ONE source of truth. */
export const CACHE_TTL_MS = {
  /** NWS /points grid mapping — stable for a location. */
  points: 24 * 60 * 60 * 1000,
  /** NWS hourly forecast — matches NWS `expires` cadence. */
  hourly: 60 * 60 * 1000,
  /** NWS gridpoint skyCover time-series. */
  skyCover: 60 * 60 * 1000,
  /** NWS active alerts. */
  alerts: 30 * 60 * 1000,
  /** Open-Meteo air quality. */
  airQuality: 60 * 60 * 1000,
} as const;

/** AsyncStorage key for the persisted last verdict (Appendix §3.1). */
export const LAST_VERDICT_KEY = 'walkies.cache.lastVerdict.v1';

interface CacheEntry<T> {
  value: T;
  /** Epoch ms after which the entry is considered stale. */
  expiresAt: number;
}

/**
 * A tiny keyed in-memory cache with per-entry expiry. Generic over value type;
 * callers pass a TTL (use a `CACHE_TTL_MS` member) per `set`.
 *
 * Not persisted — process-lifetime only. The app re-fetches on next launch,
 * which is the intended behaviour for live weather data. Persistence is reserved
 * for the last verdict (see `saveLastVerdict` / `loadLastVerdict`).
 */
export class TtlCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  /** A clock seam so tests can control time; defaults to `Date.now`. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Return the cached value for `key` if present and not expired; otherwise
   * `undefined` (and evict the stale entry).
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (this.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /** Store `value` under `key`, expiring after `ttlMs` from now. */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  /** True if `key` has a present, unexpired entry. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Remove a single entry. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Drop every entry. */
  clear(): void {
    this.store.clear();
  }
}

/** Persisted last-verdict shape (Appendix §3.1). */
export interface LastVerdict {
  /** The verdict level last shown to the user. */
  verdict: VerdictLevel;
  /** ISO 8601 time the verdict was computed. */
  fetchedAt: string;
  lat: number;
  lon: number;
}

function isLastVerdict(value: unknown): value is LastVerdict {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (v.verdict === 'green' || v.verdict === 'yellow' || v.verdict === 'red') &&
    typeof v.fetchedAt === 'string' &&
    typeof v.lat === 'number' &&
    typeof v.lon === 'number'
  );
}

/**
 * Persist the last verdict so the next cold start can show it instantly.
 * Failures are swallowed (a missing cache entry is non-fatal — the app just
 * fetches fresh), so this never throws to the caller.
 */
export async function saveLastVerdict(value: LastVerdict): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_VERDICT_KEY, JSON.stringify(value));
  } catch {
    // Persistence is best-effort; a failed write is non-fatal.
  }
}

/**
 * Load the persisted last verdict, or `null` when absent/corrupt. Parse-guarded:
 * malformed JSON or a shape mismatch is treated as absent (never throws).
 */
export async function loadLastVerdict(): Promise<LastVerdict | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_VERDICT_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    return isLastVerdict(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
