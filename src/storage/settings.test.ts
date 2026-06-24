// src/storage/settings.test.ts — parse-guarded Settings persistence with
// defaults. AsyncStorage is mocked via its bundled jest mock.

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Settings } from '../domain/types';

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  saveSettings,
} from './settings';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

afterEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

const custom: Settings = {
  temperatureUnit: 'C',
  distanceUnit: 'km',
  defaultSurface: 'grass',
  notificationsEnabled: true,
  onboardingAcknowledged: true,
  schemaVersion: 1,
};

describe('settings persistence', () => {
  it('returns DEFAULT_SETTINGS when absent (done-when)', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips saved settings', async () => {
    await saveSettings(custom);
    const stored = await AsyncStorage.getItem(SETTINGS_KEY);
    expect(stored).not.toBeNull();
    expect(await loadSettings()).toEqual(custom);
  });

  it('falls back to defaults (no crash) on corrupt JSON', async () => {
    await AsyncStorage.setItem(SETTINGS_KEY, '{not json');
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults on a schemaVersion mismatch', async () => {
    await AsyncStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...custom, schemaVersion: 2 }),
    );
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults on a shape mismatch', async () => {
    await AsyncStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ temperatureUnit: 'K', schemaVersion: 1 }),
    );
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts settings without the optional onboardingAcknowledged field', async () => {
    const withoutAck = {
      temperatureUnit: 'F',
      distanceUnit: 'mi',
      defaultSurface: 'asphalt',
      notificationsEnabled: false,
      schemaVersion: 1,
    };
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(withoutAck));
    expect(await loadSettings()).toEqual(withoutAck);
  });
});
