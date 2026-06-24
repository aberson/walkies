// src/ui/AlertRow.test.tsx — presentational single-alert row.

import { render, screen } from '@testing-library/react-native';
import React from 'react';

import type { Alert } from '../domain/types';

import AlertRow from './AlertRow';

function alert(over: Partial<Alert> = {}): Alert {
  return {
    event: 'Heat Advisory',
    severity: 'Moderate',
    headline: 'Heat advisory in effect until 8 PM',
    onset: null,
    ends: null,
    ...over,
  };
}

describe('AlertRow', () => {
  it('renders the event and headline', () => {
    render(<AlertRow alert={alert()} />);
    expect(screen.getByText(/Heat Advisory/)).toBeTruthy();
    expect(screen.getByText(/Heat advisory in effect until 8 PM/)).toBeTruthy();
  });

  it('falls back to a generic label when the event is empty', () => {
    render(<AlertRow alert={alert({ event: '', headline: '' })} />);
    expect(screen.getByText(/Weather alert/)).toBeTruthy();
  });
});
