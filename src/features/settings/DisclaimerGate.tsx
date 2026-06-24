// src/features/settings/DisclaimerGate.tsx — the one-time onboarding
// acknowledgement gate (plan §8). Wraps the app content: on first launch, until
// `Settings.onboardingAcknowledged === true`, it BLOCKS the app behind a
// disclaimer-acknowledgement screen. Pressing "I understand" persists
// `onboardingAcknowledged = true` and reveals the wrapped content; after that it
// never shows again (the persisted flag survives reloads).
//
// Best-effort / no-crash (plan §9): loadSettings never throws (defaults to
// unacknowledged), and a save failure still reveals the content for this session
// — the gate must never trap the user behind a broken write. Mounted at the app
// entry (RootLayout) so it gates EVERY route, not just Home.

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Settings } from '../../domain/types';
import {
  loadSettings as realLoadSettings,
  saveSettings as realSaveSettings,
} from '../../storage';

import { DISCLAIMER_TEXT } from './disclaimerText';

/** Injectable storage boundary — defaults to the real persistence. */
export interface DisclaimerGateDeps {
  loadSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<void>;
}

const defaultDeps: DisclaimerGateDeps = {
  loadSettings: realLoadSettings,
  saveSettings: realSaveSettings,
};

export interface DisclaimerGateProps {
  /** App content shown ONLY once the disclaimer is acknowledged. */
  children: React.ReactNode;
  /** Test seam: inject mocked storage deps. */
  deps?: Partial<DisclaimerGateDeps>;
}

type GateState = 'checking' | 'gated' | 'acknowledged';

/**
 * Gate the wrapped content behind a one-time disclaimer acknowledgement.
 *
 * Resolution on mount:
 *   - settings.onboardingAcknowledged === true → 'acknowledged' (render children)
 *   - otherwise (false / absent / load failed) → 'gated' (render the disclaimer)
 */
export default function DisclaimerGate({
  children,
  deps,
}: DisclaimerGateProps) {
  const d: DisclaimerGateDeps = { ...defaultDeps, ...deps };
  const [state, setState] = useState<GateState>('checking');
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // loadSettings never throws; treat anything but an explicit `true` as
      // not-yet-acknowledged so a fresh/corrupt store shows the gate.
      const loaded = await d.loadSettings();
      if (!active) {
        return;
      }
      setSettings(loaded);
      setState(
        loaded.onboardingAcknowledged === true ? 'acknowledged' : 'gated',
      );
    })();
    return () => {
      active = false;
    };
    // Run once on mount; deps are stable defaults / pinned test fixtures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acknowledge = useCallback(() => {
    void (async () => {
      // Persist the flag; best-effort — even if the write fails we reveal the
      // content for this session so the gate can never trap the user.
      const base = settings ?? (await d.loadSettings());
      try {
        await d.saveSettings({ ...base, onboardingAcknowledged: true });
      } catch {
        // Swallow — proceed to reveal content regardless (plan §9 no-crash).
      }
      setState('acknowledged');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // Brief check before we know whether to gate — avoids a flash of app content
  // for a fresh (unacknowledged) user.
  if (state === 'checking') {
    return (
      <View style={styles.centered} testID="disclaimer-checking">
        <ActivityIndicator size="large" color="#1d6fe0" />
      </View>
    );
  }

  if (state === 'gated') {
    return (
      <ScrollView
        contentContainerStyle={styles.gateContent}
        testID="disclaimer-gate"
      >
        <Text style={styles.gateTitle}>Before you start</Text>
        <Text style={styles.gateBody}>{DISCLAIMER_TEXT}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
          ]}
          onPress={acknowledge}
          accessibilityRole="button"
          testID="disclaimer-acknowledge"
        >
          <Text style={styles.buttonText}>I understand</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Acknowledged → reveal the app.
  return <>{children}</>;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gateContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 28,
    gap: 18,
  },
  gateTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#222',
  },
  gateBody: {
    fontSize: 15,
    color: '#444',
    lineHeight: 22,
  },
  button: {
    backgroundColor: '#1d6fe0',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
