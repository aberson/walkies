// src/storage/profile.test.ts — parse-guarded DogProfile persistence.
// AsyncStorage is mocked via its bundled jest mock (jest hoists jest.mock above
// the imports).

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DogProfile } from '../domain/types';

import { PROFILE_KEY, loadProfile, saveProfile } from './profile';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

afterEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

const sample: DogProfile = {
  name: 'Biscuit',
  breed: 'French Bulldog',
  brachycephalic: true,
  ageMonths: 90,
  size: 'small',
  bodyCondition: 'ideal',
  coat: 'short',
  darkCoat: false,
  conditions: ['respiratory'],
  schemaVersion: 1,
};

describe('profile persistence', () => {
  it('round-trips a saved profile under the versioned key (done-when)', async () => {
    await saveProfile(sample);
    const stored = await AsyncStorage.getItem(PROFILE_KEY);
    expect(stored).not.toBeNull();
    const loaded = await loadProfile();
    expect(loaded).toEqual(sample);
  });

  it('returns null when nothing is stored (re-onboard)', async () => {
    expect(await loadProfile()).toBeNull();
  });

  it('returns null (no crash) on corrupt JSON — re-onboards (done-when)', async () => {
    await AsyncStorage.setItem(PROFILE_KEY, '{not json');
    expect(await loadProfile()).toBeNull();
  });

  it('returns null on a schemaVersion mismatch', async () => {
    await AsyncStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ ...sample, schemaVersion: 2 }),
    );
    expect(await loadProfile()).toBeNull();
  });

  it('returns null on a shape mismatch (missing/invalid fields)', async () => {
    await AsyncStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ name: 'Rex', breed: 'Pug', schemaVersion: 1 }),
    );
    expect(await loadProfile()).toBeNull();
  });

  it('returns null when a field has the wrong enum value', async () => {
    await AsyncStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ ...sample, size: 'enormous' }),
    );
    expect(await loadProfile()).toBeNull();
  });

  it('returns null when conditions contains an invalid entry', async () => {
    await AsyncStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ ...sample, conditions: ['respiratory', 'bogus'] }),
    );
    expect(await loadProfile()).toBeNull();
  });

  it('returns null when conditions is empty (invariant: always non-empty)', async () => {
    await AsyncStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ ...sample, conditions: [] }),
    );
    expect(await loadProfile()).toBeNull();
  });

  it('last-write-wins overwrites the previous profile', async () => {
    await saveProfile(sample);
    const updated: DogProfile = { ...sample, name: 'Cookie', breed: 'Pug' };
    await saveProfile(updated);
    expect(await loadProfile()).toEqual(updated);
  });
});
