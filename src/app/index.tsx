import { StyleSheet, View } from 'react-native';

import { HomeScreen } from '../features/home';

/**
 * Home route (Step 5): the verdict screen. Renders HomeScreen, which uses the
 * useHomeVerdict controller to orchestrate location → live data → the pure
 * domain engine and shows the 🟢/🟡/🔴 VerdictCard, best-windows strip, active
 * alerts, and all degradation states (loading / stale / error / permission /
 * onboarding).
 */
export default function Home() {
  return (
    <View style={styles.container}>
      <HomeScreen />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
