// src/data/cache.test.ts — TTL cache + persisted last-verdict.
// AsyncStorage is mocked via its bundled jest mock. Imports stay at the top
// (jest hoists the jest.mock call above them automatically).

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CACHE_TTL_MS,
  LAST_VERDICT_KEY,
  TtlCache,
  loadLastVerdict,
  saveLastVerdict,
  type LastVerdict,
} from './cache';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

afterEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('TtlCache', () => {
  it('returns a stored value before it expires', () => {
    let t = 1000;
    const cache = new TtlCache(() => t);
    cache.set('k', { a: 1 }, CACHE_TTL_MS.hourly);
    expect(cache.get('k')).toEqual({ a: 1 });
    expect(cache.has('k')).toBe(true);
  });

  it('evicts and returns undefined after the TTL elapses', () => {
    let t = 1000;
    const cache = new TtlCache(() => t);
    cache.set('k', 'v', CACHE_TTL_MS.alerts); // 30 min
    t += CACHE_TTL_MS.alerts; // exactly at expiry => expired (>=)
    expect(cache.get('k')).toBeUndefined();
    expect(cache.has('k')).toBe(false);
  });

  it('honours distinct TTLs per entry (§3.2)', () => {
    let t = 0;
    const cache = new TtlCache(() => t);
    cache.set('alerts', 1, CACHE_TTL_MS.alerts); // 30 min
    cache.set('points', 1, CACHE_TTL_MS.points); // 24 h
    t = CACHE_TTL_MS.alerts + 1; // past alerts, well within points
    expect(cache.get('alerts')).toBeUndefined();
    expect(cache.get('points')).toBe(1);
  });

  it('delete and clear remove entries', () => {
    const cache = new TtlCache(() => 0);
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    cache.clear();
    expect(cache.get('b')).toBeUndefined();
  });
});

describe('last-verdict persistence', () => {
  const sample: LastVerdict = {
    verdict: 'yellow',
    fetchedAt: '2025-06-21T17:00:00.000Z',
    lat: 44.96,
    lon: -93.27,
  };

  it('round-trips a saved verdict under the versioned key', async () => {
    await saveLastVerdict(sample);
    const stored = await AsyncStorage.getItem(LAST_VERDICT_KEY);
    expect(stored).not.toBeNull();
    const loaded = await loadLastVerdict();
    expect(loaded).toEqual(sample);
  });

  it('returns null when nothing is stored', async () => {
    expect(await loadLastVerdict()).toBeNull();
  });

  it('returns null (no throw) on corrupt JSON', async () => {
    await AsyncStorage.setItem(LAST_VERDICT_KEY, '{not json');
    expect(await loadLastVerdict()).toBeNull();
  });

  it('returns null (no throw) on a shape mismatch', async () => {
    await AsyncStorage.setItem(
      LAST_VERDICT_KEY,
      JSON.stringify({ verdict: 'purple', lat: 'x' }),
    );
    expect(await loadLastVerdict()).toBeNull();
  });

  it('swallows a write failure (no throw to caller)', async () => {
    jest
      .spyOn(AsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));
    await expect(saveLastVerdict(sample)).resolves.toBeUndefined();
  });
});
