// src/features/profile/ProfileForm.test.tsx — form behaviour: breed auto-fill,
// the Custom path, and a save-from-form round trip. AsyncStorage is mocked via
// its bundled jest mock; storage functions are spied on the real module.

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import * as profileStorage from '../../storage/profile';

import ProfileForm from './ProfileForm';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ProfileForm', () => {
  it('auto-sets brachycephalic=true when French Bulldog is picked (done-when)', () => {
    render(<ProfileForm />);
    const toggle = screen.getByTestId('toggle-brachycephalic');
    // Fresh form starts with brachycephalic off.
    expect(toggle.props.accessibilityState.checked).toBe(false);

    fireEvent.press(screen.getByTestId('breed-French Bulldog'));

    expect(
      screen.getByTestId('toggle-brachycephalic').props.accessibilityState
        .checked,
    ).toBe(true);
    // And it also auto-fills coat (short) + size (small) for French Bulldog.
    expect(
      screen.getByTestId('coat-short').props.accessibilityState.selected,
    ).toBe(true);
    expect(
      screen.getByTestId('size-small').props.accessibilityState.selected,
    ).toBe(true);
  });

  it('Custom path leaves the user-set toggles untouched', () => {
    render(<ProfileForm />);
    // User turns brachycephalic on directly, then selects Custom.
    fireEvent.press(screen.getByTestId('toggle-brachycephalic'));
    expect(
      screen.getByTestId('toggle-brachycephalic').props.accessibilityState
        .checked,
    ).toBe(true);

    fireEvent.press(screen.getByTestId('breed-Custom'));

    // Custom must NOT reset the user's toggle.
    expect(
      screen.getByTestId('toggle-brachycephalic').props.accessibilityState
        .checked,
    ).toBe(true);
  });

  it('saves the profile with the right shape when the form is submitted', async () => {
    const saveSpy = jest
      .spyOn(profileStorage, 'saveProfile')
      .mockResolvedValue();
    const onSaved = jest.fn();
    render(<ProfileForm onSaved={onSaved} />);

    fireEvent.changeText(screen.getByTestId('input-name'), 'Biscuit');
    fireEvent.press(screen.getByTestId('breed-French Bulldog'));
    fireEvent.changeText(screen.getByTestId('input-age-years'), '7');
    fireEvent.changeText(screen.getByTestId('input-age-months'), '6');
    fireEvent.press(screen.getByTestId('save-profile'));

    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    expect(saveSpy).toHaveBeenCalledWith({
      name: 'Biscuit',
      breed: 'French Bulldog',
      brachycephalic: true,
      ageMonths: 90, // 7*12 + 6
      size: 'small',
      bodyCondition: 'ideal',
      coat: 'short',
      darkCoat: false,
      conditions: ['none'],
      schemaVersion: 1,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('blocks save and shows an error when the name is empty', async () => {
    const saveSpy = jest
      .spyOn(profileStorage, 'saveProfile')
      .mockResolvedValue();
    render(<ProfileForm />);

    fireEvent.press(screen.getByTestId('save-profile'));

    await waitFor(() =>
      expect(screen.getByText(/enter your dog/i)).toBeTruthy(),
    );
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('multi-toggle: selecting a real condition clears "none"', () => {
    render(<ProfileForm />);
    // Default conditions == ['none'].
    expect(
      screen.getByTestId('condition-none').props.accessibilityState.selected,
    ).toBe(true);

    fireEvent.press(screen.getByTestId('condition-respiratory'));

    expect(
      screen.getByTestId('condition-respiratory').props.accessibilityState
        .selected,
    ).toBe(true);
    expect(
      screen.getByTestId('condition-none').props.accessibilityState.selected,
    ).toBe(false);
  });
});
