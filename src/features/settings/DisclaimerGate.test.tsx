// src/features/settings/DisclaimerGate.test.tsx — the one-time onboarding
// acknowledgement gate (plan §8 done-when: "the disclaimer acknowledgement
// persists and gates first use"). Storage is injected via deps.
//
// The three legs of the done-when:
//   1. unacknowledged on load → gate shown, app content NOT shown.
//   2. pressing "I understand" → persists onboardingAcknowledged=true (saveSettings)
//      AND reveals the wrapped content.
//   3. acknowledged on load → no gate, content shown directly (persists across
//      reloads — a fresh mount with the persisted flag skips the gate).

import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import type { Settings } from '../../domain/types';

import DisclaimerGate, { type DisclaimerGateDeps } from './DisclaimerGate';

// DisclaimerGate imports the storage barrel (settings.ts → AsyncStorage). Storage
// is injected via deps, but the module import still needs the bundled mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

function settings(over: Partial<Settings> = {}): Settings {
  return {
    temperatureUnit: 'F',
    distanceUnit: 'mi',
    defaultSurface: 'asphalt',
    notificationsEnabled: false,
    schemaVersion: 1,
    ...over,
  };
}

/** Deps backed by an in-memory settings cell so save→reload round-trips. */
function makeDeps(initial: Settings): {
  deps: Partial<DisclaimerGateDeps>;
  saveSettings: jest.Mock;
  current: () => Settings;
} {
  let cell = initial;
  const saveSettings = jest.fn(async (s: Settings) => {
    cell = s;
  });
  return {
    deps: {
      loadSettings: jest.fn(async () => cell),
      saveSettings,
    },
    saveSettings,
    current: () => cell,
  };
}

const APP = <Text testID="app-content">App content</Text>;

describe('DisclaimerGate — gates first use + persists (done-when)', () => {
  it('unacknowledged on load → gate shown, app content hidden', async () => {
    const m = makeDeps(settings({ onboardingAcknowledged: false }));
    render(<DisclaimerGate deps={m.deps}>{APP}</DisclaimerGate>);

    expect(await screen.findByTestId('disclaimer-gate')).toBeTruthy();
    expect(screen.queryByTestId('app-content')).toBeNull();
  });

  it('treats absent onboardingAcknowledged as not-acknowledged (shows gate)', async () => {
    // No onboardingAcknowledged field at all → must still gate.
    const m = makeDeps(settings());
    render(<DisclaimerGate deps={m.deps}>{APP}</DisclaimerGate>);
    expect(await screen.findByTestId('disclaimer-gate')).toBeTruthy();
    expect(screen.queryByTestId('app-content')).toBeNull();
  });

  it('pressing "I understand" persists the flag AND reveals content', async () => {
    const m = makeDeps(settings({ onboardingAcknowledged: false }));
    render(<DisclaimerGate deps={m.deps}>{APP}</DisclaimerGate>);
    await screen.findByTestId('disclaimer-gate');

    fireEvent.press(screen.getByTestId('disclaimer-acknowledge'));

    // Content revealed.
    expect(await screen.findByTestId('app-content')).toBeTruthy();
    expect(screen.queryByTestId('disclaimer-gate')).toBeNull();
    // Persisted with onboardingAcknowledged = true.
    expect(m.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingAcknowledged: true }),
    );
    expect(m.current().onboardingAcknowledged).toBe(true);
  });

  it('acknowledged on load → no gate, content shown (persists across reload)', async () => {
    const m = makeDeps(settings({ onboardingAcknowledged: true }));
    render(<DisclaimerGate deps={m.deps}>{APP}</DisclaimerGate>);

    expect(await screen.findByTestId('app-content')).toBeTruthy();
    expect(screen.queryByTestId('disclaimer-gate')).toBeNull();
  });

  it('a save failure still reveals content (best-effort/no-crash, §9)', async () => {
    const m = makeDeps(settings({ onboardingAcknowledged: false }));
    (m.deps.saveSettings as jest.Mock).mockRejectedValueOnce(
      new Error('write failed'),
    );
    render(<DisclaimerGate deps={m.deps}>{APP}</DisclaimerGate>);
    await screen.findByTestId('disclaimer-gate');

    fireEvent.press(screen.getByTestId('disclaimer-acknowledge'));

    // Even though the persist threw, the gate must not trap the user.
    expect(await screen.findByTestId('app-content')).toBeTruthy();
  });
});
