/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // @testing-library/react-native v12.4+ bundles its Jest matchers by default,
  // so no extend-expect setup file is required.
  // jest-expo's preset already configures transformIgnorePatterns for the RN /
  // Expo module set; we keep the default. Tests live next to the code as
  // *.test.ts / *.test.tsx.
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}'],
};
