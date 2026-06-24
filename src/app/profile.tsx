import { StyleSheet, Text, View } from 'react-native';

/**
 * Profile screen (placeholder). Step 4 replaces this with the dog
 * onboarding/edit form: breed picker (auto-fills brachycephalic/coat/size),
 * age, sex/neuter, weight + body-condition, coat, and health-condition toggles.
 */
export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
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
