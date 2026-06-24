// src/ui/WindowStrip.test.tsx — presentational best-windows strip.

import { render, screen } from '@testing-library/react-native';
import React from 'react';

import type { WalkWindow } from '../domain/windows';

import WindowStrip from './WindowStrip';

function window(over: Partial<WalkWindow> = {}): WalkWindow {
  return {
    startIndex: 3,
    endIndex: 6,
    startTime: '2999-06-21T19:15:00.000Z',
    endTime: '2999-06-21T22:15:00.000Z',
    level: 'green',
    label: 'after 7:15 PM',
    ...over,
  };
}

describe('WindowStrip', () => {
  it('shows "good all day" when green headline + a single all-green window', () => {
    render(
      <WindowStrip
        windows={[window({ startIndex: 0, level: 'green' })]}
        headlineLevel="green"
      />,
    );
    expect(screen.getByTestId('window-good-all-day')).toBeTruthy();
  });

  it('renders a later window chip with its label', () => {
    render(
      <WindowStrip
        windows={[window({ startIndex: 3, label: 'after 7:15 PM' })]}
        headlineLevel="red"
      />,
    );
    expect(screen.getByText(/Better after 7:15 PM/)).toBeTruthy();
  });

  it('renders the no-window message when there are no windows', () => {
    render(<WindowStrip windows={[]} headlineLevel="red" />);
    expect(screen.getByTestId('window-none')).toBeTruthy();
  });
});
