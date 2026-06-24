import { StyleSheet, View } from 'react-native';

import { SettingsScreen } from '../features/settings';

/**
 * Settings route (Step 7): renders SettingsScreen, which provides the units
 * toggles (°F/°C, mi/km), the default walk-surface selector, the notifications
 * opt-in (wired to setNotificationsEnabled), a data-source/attribution section
 * (NWS + Open-Meteo), and the persistent "informational, not veterinary advice"
 * disclaimer (plan §3.1, §8). The one-time onboarding acknowledgement gate
 * (DisclaimerGate) is mounted at the app root in _layout.tsx.
 */
export default function Settings() {
  return (
    <View style={styles.container}>
      <SettingsScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
