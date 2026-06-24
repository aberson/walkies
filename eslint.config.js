// ESLint flat config. Uses eslint-config-expo's flat preset.
// https://docs.expo.dev/guides/using-eslint/
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: [
      'node_modules/**',
      '.expo/**',
      'dist/**',
      'coverage/**',
      'expo-env.d.ts',
    ],
  },
];
