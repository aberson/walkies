import { Stack } from 'expo-router';
import { useEffect } from 'react';

import { DisclaimerGate } from '../features/settings';
import { reschedule, registerBackgroundRefresh } from '../notifications';

/**
 * Root navigation stack for the three v1 routes:
 *   index (Home / verdict)  ·  /profile  ·  /settings
 * Screens are placeholders in Step 1; later steps fill them in.
 *
 * On mount (once), this root route — the always-mounted production caller —
 * wires the notification entry points (plan §6 foreground refresh-on-open, §9
 * background-fetch registration), strictly BEST-EFFORT: every call is wrapped so
 * a rejection or a thrown sync error can never crash the app, and an
 * unsupported platform (web) simply no-ops. `reschedule()` itself gates on
 * Settings.notificationsEnabled and cancels-then-schedules, so it is safe to
 * call unconditionally.
 *
 * The whole navigator is wrapped in `DisclaimerGate` (Step 7) so first use is
 * gated behind the §8 "informational, not veterinary advice" acknowledgement —
 * until the user taps "I understand", the app content (including Home) is not
 * shown. The gate is best-effort/no-crash and persists the acknowledgement, so
 * it never reappears after the first time.
 */
export default function RootLayout() {
  useEffect(() => {
    // Best-effort: register the opportunistic background-refresh task and run a
    // foreground reschedule. Neither may crash app startup (try/catch around the
    // sync kick-off + .catch on each promise).
    try {
      void registerBackgroundRefresh().catch(() => {});
      void reschedule().catch(() => {});
    } catch {
      // Unsupported platform / unexpected sync throw — non-fatal (plan §9).
    }
  }, []);

  return (
    <DisclaimerGate>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Can I Walk My Dog?' }} />
        <Stack.Screen name="profile" options={{ title: 'Dog Profile' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
      </Stack>
    </DisclaimerGate>
  );
}
