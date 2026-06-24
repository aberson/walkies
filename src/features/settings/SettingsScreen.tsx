// src/features/settings/SettingsScreen.tsx — the Settings screen (plan §3.1, §8;
// Step 7). Five sections:
//   1. Units      — °F/°C + mi/km toggles → persisted to Settings, reflected live.
//   2. Surface    — default walk-surface selector (asphalt/concrete/grass).
//   3. Notifications — opt-in toggle wired to setNotificationsEnabled (Step 6),
//                      which requests permission + (re)schedules, or cancels all.
//   4. Data sources — attribution for NWS + Open-Meteo (Appendix B / §8).
//   5. Disclaimer — the persistent "informational, not veterinary advice" text.
//
// SAFETY NOTE (plan §4.2): the `defaultSurface` setting persists the user's usual
// surface as a PREFERENCE only. The BINDING pavement-burn signal in the headline
// verdict STAYS asphalt worst-case (the surface a dog is likely to encounter) —
// this screen never feeds defaultSurface into the headline/binding verdict math.
// Weakening that would let a "grass" preference hide a paw-burning sidewalk.
//
// Presentational + self-contained: loads Settings on mount (best-effort — a load
// failure leaves the defaults in place, never crashes) and persists each change.
// The data/notifications boundary is injected via `deps` for testability.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Settings, Surface } from '../../domain/types';
import { setNotificationsEnabled as realSetNotificationsEnabled } from '../../notifications';
import {
  DEFAULT_SETTINGS,
  loadSettings as realLoadSettings,
  saveSettings as realSaveSettings,
} from '../../storage';

import { DISCLAIMER_TEXT } from './disclaimerText';

// Re-export so existing importers of `DISCLAIMER_TEXT` from this module keep
// working; the canonical definition lives in ./disclaimerText (leaf module).
export { DISCLAIMER_TEXT };

/** Option metadata for the segmented selectors. */
const SURFACE_OPTIONS: { value: Surface; label: string }[] = [
  { value: 'asphalt', label: 'Asphalt' },
  { value: 'concrete', label: 'Concrete' },
  { value: 'grass', label: 'Grass' },
];

const TEMP_OPTIONS: { value: Settings['temperatureUnit']; label: string }[] = [
  { value: 'F', label: '°F' },
  { value: 'C', label: '°C' },
];

const DISTANCE_OPTIONS: { value: Settings['distanceUnit']; label: string }[] = [
  { value: 'mi', label: 'Miles' },
  { value: 'km', label: 'Kilometers' },
];

/** Injectable boundary deps — defaults to the real storage/notifications stack. */
export interface SettingsScreenDeps {
  loadSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<void>;
  /** Step 6's opt-in toggle: requests permission + (re)schedules / cancels all. */
  setNotificationsEnabled: (enabled: boolean) => Promise<unknown>;
}

const defaultDeps: SettingsScreenDeps = {
  loadSettings: realLoadSettings,
  saveSettings: realSaveSettings,
  setNotificationsEnabled: realSetNotificationsEnabled,
};

export interface SettingsScreenProps {
  /** Test seam: inject mocked storage/notifications deps. */
  deps?: Partial<SettingsScreenDeps>;
}

/** The Settings screen. */
export default function SettingsScreen({ deps }: SettingsScreenProps) {
  const d: SettingsScreenDeps = { ...defaultDeps, ...deps };
  // Hold the resolved deps in state so the effect/handlers use a stable set.
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // Load persisted settings on mount. Best-effort: loadSettings never throws and
  // falls back to DEFAULT_SETTINGS, so a failure simply leaves the defaults.
  useEffect(() => {
    let active = true;
    void (async () => {
      const loaded = await d.loadSettings();
      if (active) {
        setSettings(loaded);
      }
    })();
    return () => {
      active = false;
    };
    // Run once on mount; deps are stable defaults / injected fixtures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Optimistically apply a settings patch + persist it. */
  const persist = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        void d.saveSettings(next).catch(() => {});
        return next;
      });
    },
    // d is rebuilt each render; saveSettings identity is stable for the real deps
    // and pinned per-test, so spreading deps here is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * Notifications opt-in. Delegates to Step 6's setNotificationsEnabled (which
   * persists notificationsEnabled itself + requests permission / reschedules),
   * then re-reads Settings so the UI reflects the PERSISTED state (a denied
   * permission leaves it off even though the user tapped on).
   */
  const onToggleNotifications = useCallback(
    (value: boolean) => {
      void (async () => {
        // Optimistic reflect; reconcile from storage after the async flow.
        setSettings((prev) => ({ ...prev, notificationsEnabled: value }));
        try {
          await d.setNotificationsEnabled(value);
        } catch {
          // Never crash on a notifications failure.
        }
        const reconciled = await d.loadSettings();
        setSettings(reconciled);
      })();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      testID="settings-screen"
    >
      <Text style={styles.heading}>Settings</Text>

      {/* 1. Units */}
      <Section title="Units">
        <Field label="Temperature">
          <Segmented
            options={TEMP_OPTIONS}
            value={settings.temperatureUnit}
            onSelect={(v) => persist({ temperatureUnit: v })}
            testIDPrefix="temp-unit"
          />
        </Field>
        <Field label="Distance">
          <Segmented
            options={DISTANCE_OPTIONS}
            value={settings.distanceUnit}
            onSelect={(v) => persist({ distanceUnit: v })}
            testIDPrefix="distance-unit"
          />
        </Field>
      </Section>

      {/* 2. Default walk surface (PREFERENCE only — see §4.2 note above). */}
      <Section title="Default walk surface">
        <Text style={styles.hint}>
          Your usual surface. The headline verdict always assumes hot asphalt
          (the worst case for paws), so this won’t make a verdict less cautious.
        </Text>
        <Segmented
          options={SURFACE_OPTIONS}
          value={settings.defaultSurface}
          onSelect={(v) => persist({ defaultSurface: v })}
          testIDPrefix="surface"
        />
      </Section>

      {/* 3. Notifications opt-in (wired to Step 6's setNotificationsEnabled). */}
      <Section title="Notifications">
        <ToggleField
          label="Walk-window & alert notifications"
          value={settings.notificationsEnabled}
          onToggle={() => onToggleNotifications(!settings.notificationsEnabled)}
          testID="toggle-notifications"
        />
        <Text style={styles.hint}>
          Get a heads-up for good walking windows and active weather alerts.
          You’ll be asked for notification permission the first time you turn
          this on.
        </Text>
      </Section>

      {/* 4. Data sources / attribution (Appendix B / §8). */}
      <Section title="Data sources">
        <Text style={styles.attribution} testID="attribution-nws">
          Weather and active alerts: U.S. National Weather Service
          (api.weather.gov).
        </Text>
        <Text style={styles.attribution} testID="attribution-open-meteo">
          Air quality (US AQI): Open-Meteo (air-quality-api.open-meteo.com).
        </Text>
      </Section>

      {/* 5. Persistent disclaimer (always visible — §8). */}
      <View style={styles.disclaimerBox} testID="settings-disclaimer">
        <Text style={styles.disclaimerText}>{DISCLAIMER_TEXT}</Text>
      </View>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers (mirror ProfileForm's chip/segmented style).
// ---------------------------------------------------------------------------

/** A titled settings section. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** Labelled field wrapper. */
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

/** A single selectable chip. */
function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={testID}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A single-select segmented control over a closed option set. */
function Segmented<T extends string>({
  options,
  value,
  onSelect,
  testIDPrefix,
}: {
  options: { value: T; label: string }[];
  value: T;
  onSelect: (value: T) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.chips}>
      {options.map((opt) => (
        <Chip
          key={opt.value}
          label={opt.label}
          selected={value === opt.value}
          onPress={() => onSelect(opt.value)}
          testID={`${testIDPrefix}-${opt.value}`}
        />
      ))}
    </View>
  );
}

/** A labelled on/off toggle rendered as a chip. */
function ToggleField({
  label,
  value,
  onToggle,
  testID,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={[styles.label, styles.toggleLabel]}>{label}</Text>
      <Pressable
        style={[styles.toggle, value && styles.toggleOn]}
        onPress={onToggle}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        testID={testID}
      >
        <Text style={[styles.toggleText, value && styles.toggleTextOn]}>
          {value ? 'On' : 'Off'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 22,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#222',
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  toggleLabel: {
    flex: 1,
    paddingRight: 12,
  },
  hint: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  chipSelected: {
    borderColor: '#1d6fe0',
    backgroundColor: '#e7f0fd',
  },
  chipText: {
    fontSize: 14,
    color: '#333',
  },
  chipTextSelected: {
    color: '#1d6fe0',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggle: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  toggleOn: {
    borderColor: '#1d6fe0',
    backgroundColor: '#e7f0fd',
  },
  toggleText: {
    fontSize: 14,
    color: '#666',
  },
  toggleTextOn: {
    color: '#1d6fe0',
    fontWeight: '600',
  },
  attribution: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  disclaimerBox: {
    backgroundColor: '#f4f5f7',
    borderRadius: 12,
    padding: 14,
  },
  disclaimerText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
    lineHeight: 18,
  },
});
