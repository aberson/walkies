// src/ui/VerdictCard.test.tsx — presentational card rendering from a Verdict prop.

import { render, screen } from '@testing-library/react-native';
import React from 'react';

import type { Verdict } from '../domain/types';

import VerdictCard from './VerdictCard';

function verdict(over: Partial<Verdict> = {}): Verdict {
  return {
    level: 'green',
    headline: 'Great time for a walk',
    reasons: [
      'Conditions look good for a walk right now.',
      'Tip: do the 7-second test — if you can’t hold the back of your hand on the pavement for 7 seconds, it’s too hot for paws.',
    ],
    pavementTempF: 78,
    recommendedMaxMinutes: 45,
    bindingSignal: 'none',
    ...over,
  };
}

describe('VerdictCard', () => {
  it('renders the headline, pavement temp, and duration', () => {
    render(<VerdictCard verdict={verdict()} />);
    expect(screen.getByText('Great time for a walk')).toBeTruthy();
    expect(screen.getByText('~78°F')).toBeTruthy();
    expect(
      screen.getByText(/Recommended max walk: about 45 minutes/),
    ).toBeTruthy();
  });

  it('always shows the 7-second-test note (standalone), even on green', () => {
    render(<VerdictCard verdict={verdict()} />);
    expect(screen.getByTestId('seven-second-note')).toBeTruthy();
  });

  it('shows the dog name in the headline when provided', () => {
    render(<VerdictCard verdict={verdict()} dogName="Biscuit" />);
    expect(screen.getByText('Biscuit: Great time for a walk')).toBeTruthy();
  });

  it('shows "—" (not "NaN") when pavementTempF is non-finite', () => {
    render(<VerdictCard verdict={verdict({ pavementTempF: NaN })} />);
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.queryByText(/NaN/)).toBeNull();
  });

  it('renders "potty break only" for a red 0-minute verdict', () => {
    render(
      <VerdictCard
        verdict={verdict({
          level: 'red',
          headline: 'Unsafe right now',
          recommendedMaxMinutes: 0,
          bindingSignal: 'airQuality',
          reasons: ['Air quality is poor (US AQI 175) — limit time outdoors.'],
        })}
      />,
    );
    expect(screen.getByTestId('verdict-card-red')).toBeTruthy();
    expect(screen.getByText(/Potty break only/)).toBeTruthy();
  });
});
