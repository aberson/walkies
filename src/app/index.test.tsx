import { render, screen } from '@testing-library/react-native';
import React from 'react';

import HomeScreen from './index';

// Mock expo-router's Link so the Home screen can render without a full router
// context. The factory must require its deps inline because jest.mock is hoisted
// above the imports. Step 5 will add richer Home-screen tests against the real
// domain engine; this Step-1 test only proves the screen renders and the preset
// works.
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => (
      <Text>{children}</Text>
    ),
  };
});

describe('HomeScreen', () => {
  it('renders the home placeholder', () => {
    render(<HomeScreen />);
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Can I Walk My Dog?')).toBeTruthy();
  });
});
