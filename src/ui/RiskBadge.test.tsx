// src/ui/RiskBadge.test.tsx — presentational level chip.

import { render, screen } from '@testing-library/react-native';
import React from 'react';

import RiskBadge from './RiskBadge';

describe('RiskBadge', () => {
  it('renders the default label for each level', () => {
    render(<RiskBadge level="green" />);
    expect(screen.getByTestId('risk-badge-green')).toBeTruthy();
    expect(screen.getByText('Go')).toBeTruthy();
  });

  it('renders a custom label override', () => {
    render(<RiskBadge level="yellow" label="Last: Caution" />);
    expect(screen.getByText('Last: Caution')).toBeTruthy();
  });
});
