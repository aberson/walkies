// src/features/settings — the Settings screen + one-time disclaimer gate (Step 7).
// The src/app/settings.tsx route renders SettingsScreen; DisclaimerGate wraps the
// app at the root (_layout.tsx) to gate first use behind the §8 acknowledgement.

export { default as SettingsScreen } from './SettingsScreen';
export type { SettingsScreenProps, SettingsScreenDeps } from './SettingsScreen';

export { DISCLAIMER_TEXT } from './disclaimerText';

export { default as DisclaimerGate } from './DisclaimerGate';
export type { DisclaimerGateProps, DisclaimerGateDeps } from './DisclaimerGate';
