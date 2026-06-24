import { StyleSheet, Text, View } from 'react-native';

/**
 * Settings screen (placeholder). Step 7 replaces this with the units toggle
 * (°F/°C, mi/km), default walk-surface selector, notifications opt-in, a
 * data-source/attribution section, and the persistent "informational, not
 * veterinary advice" disclaimer + one-time onboarding acknowledgement.
 */
export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
});
