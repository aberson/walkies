/** @type {import('jest').Config} */
// Dedicated config for the Step 8 LIVE-network pipeline smoke (plan §11).
//
// Invoked ONLY by `npm run smoke` — never by the default `npm test`. It matches
// *.smoke.ts (not *.test.ts), so the default jest config's testMatch can never
// select these files: the default offline/CI suite stays network-free and green.
//
// CRITICAL: this config deliberately does NOT use the `jest-expo` preset. That
// preset pulls in @react-native/jest-preset, which replaces the global `fetch`
// with a React-Native mock that does NOT make real network requests (it returns
// status: undefined). The smoke MUST hit the real NWS + Open-Meteo APIs, so it
// runs in a plain Node environment with Node 20's built-in global `fetch`,
// transforming TypeScript via babel-jest + the same `babel-preset-expo` the app
// already uses (zero new dependencies — the preset ships with jest-expo).
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.smoke.ts'],
  transform: {
    '\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
};
