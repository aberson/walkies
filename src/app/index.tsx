import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Home screen (placeholder). Step 5 replaces this with the verdict screen:
 * the 🟢/🟡/🔴 VerdictCard, estimated pavement temp, recommended duration,
 * reasons, alerts, and the best-windows strip.
 */
export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Home</Text>
      <Text style={styles.subtitle}>Can I Walk My Dog?</Text>
      <Link href="/profile" style={styles.link}>
        Dog Profile
      </Link>
      <Link href="/settings" style={styles.link}>
        Settings
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 16,
    color: '#555',
  },
  link: {
    fontSize: 18,
    color: '#1d6fe0',
    paddingVertical: 4,
  },
});
