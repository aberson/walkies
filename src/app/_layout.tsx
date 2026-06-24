import { Stack } from 'expo-router';

/**
 * Root navigation stack for the three v1 routes:
 *   index (Home / verdict)  ·  /profile  ·  /settings
 * Screens are placeholders in Step 1; later steps fill them in.
 */
export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Can I Walk My Dog?' }} />
      <Stack.Screen name="profile" options={{ title: 'Dog Profile' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
  );
}
