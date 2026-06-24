/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // @testing-library/react-native v12.4+ bundles its Jest matchers by default,
  // so no extend-expect setup file is required.
  // jest-expo's preset already configures transformIgnorePatterns for the RN /
  // Expo module set; we keep the default. Tests live next to the code as
  // *.test.ts / *.test.tsx.
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  // The Step 8 LIVE-network smoke (src/**/*.smoke.ts) MUST NOT run in the
  // default suite — it hits real APIs. It already fails the *.test.ts match
  // above; this ignore is a second guard so a rename can't sneak it into the
  // offline/CI run. Run it explicitly via `npm run smoke`.
  testPathIgnorePatterns: ['/node_modules/', '\\.smoke\\.ts$'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.smoke.ts',
  ],
};
