import { StyleSheet, View } from 'react-native';

import { ProfileForm } from '../features/profile';

/**
 * Profile route. Renders the Step-4 dog onboarding/edit form: breed picker
 * (auto-fills brachycephalic/coat/size), age, size (kg weight band),
 * body-condition, coat, dark-coat, and health-condition toggles. The form
 * prefills from any saved profile (edit path) and persists via saveProfile.
 */
export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <ProfileForm />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
