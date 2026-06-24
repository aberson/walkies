// src/app/_layout.test.tsx — the ROOT route (production caller) wires the
// notification entry points on mount (plan §6 foreground refresh-on-open, §9
// background-fetch registration). This is the code-quality.md "integration test
// through the production caller" guard against SILENT WIRING: the notification
// module's reschedule + registerBackgroundRefresh are dead unless _layout calls
// them, and unit tests of those functions alone can't see a missing call site.
//
// The notifications module is mocked (we assert the calls, not their effects);
// expo-router's Stack is stubbed so the layout renders without the native
// navigator. The two assertions:
//   1. BOTH reschedule + registerBackgroundRefresh are invoked once on mount.
//   2. A thrown/rejected reschedule does NOT crash the render (best-effort §9).

import { render } from '@testing-library/react-native';
import React from 'react';

import RootLayout from './_layout';

// expo-router's Stack is a native navigator; stub it (and Stack.Screen) so the
// root layout renders without the real navigator.
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactLib = require('react');
  const Stack = ({ children }: { children: React.ReactNode }) =>
    ReactLib.createElement(ReactLib.Fragment, null, children);
  Stack.displayName = 'Stack';
  const Screen = () => null;
  Screen.displayName = 'Stack.Screen';
  Stack.Screen = Screen;
  return { Stack };
});

// Mock the notifications module — we assert the production caller REACHES these,
// not what they do (their behavior is covered in notifications/*.test.ts).
const mockReschedule = jest.fn(async () => {});
const mockRegisterBackgroundRefresh = jest.fn(async () => true);
jest.mock('../notifications', () => ({
  reschedule: () => mockReschedule(),
  registerBackgroundRefresh: () => mockRegisterBackgroundRefresh(),
}));

describe('RootLayout — production-caller notification wiring (silent-wiring guard)', () => {
  beforeEach(() => {
    mockReschedule.mockReset();
    mockReschedule.mockResolvedValue(undefined);
    mockRegisterBackgroundRefresh.mockReset();
    mockRegisterBackgroundRefresh.mockResolvedValue(true);
  });

  it('invokes BOTH reschedule and registerBackgroundRefresh once on mount', () => {
    render(<RootLayout />);
    expect(mockRegisterBackgroundRefresh).toHaveBeenCalledTimes(1);
    expect(mockReschedule).toHaveBeenCalledTimes(1);
  });

  it('does NOT crash the render when reschedule rejects (best-effort §9)', () => {
    mockReschedule.mockRejectedValueOnce(new Error('reschedule blew up'));
    // The render itself must not throw even though the on-mount reschedule
    // rejects — the wiring is wrapped so a failure can never crash app startup.
    expect(() => render(<RootLayout />)).not.toThrow();
    expect(mockReschedule).toHaveBeenCalledTimes(1);
    expect(mockRegisterBackgroundRefresh).toHaveBeenCalledTimes(1);
  });
});
