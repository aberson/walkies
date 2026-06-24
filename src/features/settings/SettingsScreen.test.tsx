// src/features/settings/SettingsScreen.test.tsx — Settings screen behaviour.
// The storage + notifications BOUNDARY is injected via deps (no real IO). Covers:
//   - units toggles persist + reflect (°F/°C, mi/km)
//   - default-surface selector persists
//   - notifications opt-in delegates to setNotificationsEnabled(true/false)
//   - data-source attribution + persistent disclaimer text present

import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import React from 'react';

import type { Settings } from '../../domain/types';

import SettingsScreen, {
  DISCLAIMER_TEXT,
  type SettingsScreenDeps,
} from './SettingsScreen';

// SettingsScreen imports the notifications barrel, which transitively imports the
// data barrel → cache.ts → AsyncStorage. The storage/notifications boundary is
// fully injected via deps, but the module import still needs the bundled mock.
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
    onboardingAcknowledged: true,
    schemaVersion: 1,
    ...over,
  };
}

/** Injected deps backed by an in-memory settings cell. */
function makeDeps(initial: Settings): {
  deps: Partial<SettingsScreenDeps>;
  saveSettings: jest.Mock;
  setNotificationsEnabled: jest.Mock;
  current: () => Settings;
} {
  let cell = initial;
  const saveSettings = jest.fn(async (s: Settings) => {
    cell = s;
  });
  const setNotificationsEnabled = jest.fn(async (enabled: boolean) => {
    // Mirror Step 6: persist the flag so a follow-up loadSettings reflects it.
    cell = { ...cell, notificationsEnabled: enabled };
    return { granted: enabled };
  });
  return {
    deps: {
      loadSettings: jest.fn(async () => cell),
      saveSettings,
      setNotificationsEnabled,
    },
    saveSettings,
    setNotificationsEnabled,
    current: () => cell,
  };
}

describe('SettingsScreen — units', () => {
  it('toggling temperature to °C persists temperatureUnit and reflects it', async () => {
    const m = makeDeps(settings({ temperatureUnit: 'F' }));
    render(<SettingsScreen deps={m.deps} />);

    // Starts on °F (loaded from storage).
    await waitFor(() =>
      expect(
        screen.getByTestId('temp-unit-F').props.accessibilityState.selected,
      ).toBe(true),
    );

    fireEvent.press(screen.getByTestId('temp-unit-C'));

    // Reflected immediately + persisted.
    expect(
      screen.getByTestId('temp-unit-C').props.accessibilityState.selected,
    ).toBe(true);
    await waitFor(() =>
      expect(m.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ temperatureUnit: 'C' }),
      ),
    );
    expect(m.current().temperatureUnit).toBe('C');
  });

  it('toggling distance to km persists distanceUnit', async () => {
    const m = makeDeps(settings({ distanceUnit: 'mi' }));
    render(<SettingsScreen deps={m.deps} />);
    await screen.findByTestId('distance-unit-mi');

    fireEvent.press(screen.getByTestId('distance-unit-km'));

    await waitFor(() =>
      expect(m.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ distanceUnit: 'km' }),
      ),
    );
    expect(m.current().distanceUnit).toBe('km');
  });
});

describe('SettingsScreen — default surface', () => {
  it('persists the chosen default walk surface', async () => {
    const m = makeDeps(settings({ defaultSurface: 'asphalt' }));
    render(<SettingsScreen deps={m.deps} />);
    await waitFor(() =>
      expect(
        screen.getByTestId('surface-asphalt').props.accessibilityState.selected,
      ).toBe(true),
    );

    fireEvent.press(screen.getByTestId('surface-grass'));

    await waitFor(() =>
      expect(m.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ defaultSurface: 'grass' }),
      ),
    );
    expect(m.current().defaultSurface).toBe('grass');
  });
});

describe('SettingsScreen — notifications opt-in', () => {
  it('opting IN calls setNotificationsEnabled(true)', async () => {
    const m = makeDeps(settings({ notificationsEnabled: false }));
    render(<SettingsScreen deps={m.deps} />);
    await waitFor(() =>
      expect(
        screen.getByTestId('toggle-notifications').props.accessibilityState
          .checked,
      ).toBe(false),
    );

    fireEvent.press(screen.getByTestId('toggle-notifications'));

    await waitFor(() =>
      expect(m.setNotificationsEnabled).toHaveBeenCalledWith(true),
    );
  });

  it('opting OUT calls setNotificationsEnabled(false)', async () => {
    const m = makeDeps(settings({ notificationsEnabled: true }));
    render(<SettingsScreen deps={m.deps} />);
    await waitFor(() =>
      expect(
        screen.getByTestId('toggle-notifications').props.accessibilityState
          .checked,
      ).toBe(true),
    );

    fireEvent.press(screen.getByTestId('toggle-notifications'));

    await waitFor(() =>
      expect(m.setNotificationsEnabled).toHaveBeenCalledWith(false),
    );
  });

  it('reflects the PERSISTED state after a denied opt-in (stays off)', async () => {
    const m = makeDeps(settings({ notificationsEnabled: false }));
    // Override: setNotificationsEnabled returns denied + leaves the flag false.
    (m.deps.setNotificationsEnabled as jest.Mock).mockImplementation(
      async () => ({ granted: false, reason: 'denied' }),
    );
    render(<SettingsScreen deps={m.deps} />);
    await screen.findByTestId('toggle-notifications');

    fireEvent.press(screen.getByTestId('toggle-notifications'));

    // After reconciling from storage (still false), the toggle returns to off.
    await waitFor(() =>
      expect(
        screen.getByTestId('toggle-notifications').props.accessibilityState
          .checked,
      ).toBe(false),
    );
  });
});

describe('SettingsScreen — attribution + disclaimer', () => {
  it('credits NWS and Open-Meteo as data sources', async () => {
    const m = makeDeps(settings());
    render(<SettingsScreen deps={m.deps} />);
    expect(await screen.findByTestId('attribution-nws')).toBeTruthy();
    expect(screen.getByTestId('attribution-open-meteo')).toBeTruthy();
    expect(screen.getByText(/National Weather Service/)).toBeTruthy();
    expect(screen.getByText(/Open-Meteo/)).toBeTruthy();
  });

  it('always shows the persistent "not veterinary advice" disclaimer', async () => {
    const m = makeDeps(settings());
    render(<SettingsScreen deps={m.deps} />);
    expect(await screen.findByTestId('settings-disclaimer')).toBeTruthy();
    expect(screen.getByText(DISCLAIMER_TEXT)).toBeTruthy();
    expect(screen.getByText(/not veterinary advice/)).toBeTruthy();
  });
});
