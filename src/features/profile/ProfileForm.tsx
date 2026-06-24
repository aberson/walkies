// src/features/profile/ProfileForm.tsx — dog onboarding / edit form.
// Fields map EXACTLY to the Appendix A DogProfile schema (no sex/neuter, no raw
// weight — `size` IS the kg weight band). Selecting a seed breed auto-fills
// brachycephalic / coat / size (still user-overridable); the "Custom" sentinel
// leaves the user's toggles untouched. Wires to saveProfile / loadProfile.

import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type {
  BodyCondition,
  Coat,
  DogCondition,
  DogProfile,
  Size,
} from '../../domain/types';
import { loadProfile, saveProfile } from '../../storage/profile';

import { BREED_SEEDS, CUSTOM_BREED, type BreedSeed } from './breeds';

/** Option metadata for the segmented selectors. */
const SIZE_OPTIONS: { value: Size; label: string }[] = [
  { value: 'small', label: 'Small (<10 kg)' },
  { value: 'medium', label: 'Medium (10–25 kg)' },
  { value: 'large', label: 'Large (25–45 kg)' },
  { value: 'giant', label: 'Giant (>45 kg)' },
];

const BODY_CONDITION_OPTIONS: { value: BodyCondition; label: string }[] = [
  { value: 'under', label: 'Under' },
  { value: 'ideal', label: 'Ideal' },
  { value: 'overweight', label: 'Overweight' },
  { value: 'obese', label: 'Obese' },
];

const COAT_OPTIONS: { value: Coat; label: string }[] = [
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'double_thick', label: 'Double / thick' },
];

/** Conditions shown as multi-toggles. `none` is mutually exclusive (see below). */
const CONDITION_OPTIONS: { value: DogCondition; label: string }[] = [
  { value: 'respiratory', label: 'Respiratory' },
  { value: 'cardiac', label: 'Cardiac' },
  { value: 'laryngeal_paralysis', label: 'Laryngeal paralysis' },
  { value: 'tracheal_collapse', label: 'Tracheal collapse' },
  { value: 'none', label: 'None' },
];

/** Default seed used for a fresh (never-onboarded) profile. */
const FRESH_BREED = CUSTOM_BREED;

interface FormState {
  name: string;
  breed: string;
  brachycephalic: boolean;
  /** Collected as separate year/month inputs, stored as ageMonths. */
  ageYears: string;
  ageMonthsPart: string;
  size: Size;
  bodyCondition: BodyCondition;
  coat: Coat;
  darkCoat: boolean;
  conditions: DogCondition[];
}

function freshState(): FormState {
  return {
    name: '',
    breed: FRESH_BREED,
    brachycephalic: false,
    ageYears: '',
    ageMonthsPart: '',
    size: 'medium',
    bodyCondition: 'ideal',
    coat: 'short',
    darkCoat: false,
    conditions: ['none'],
  };
}

/** Hydrate the form from an existing profile (edit path). */
function stateFromProfile(p: DogProfile): FormState {
  return {
    name: p.name,
    breed: p.breed,
    brachycephalic: p.brachycephalic,
    ageYears: String(Math.floor(p.ageMonths / 12)),
    ageMonthsPart: String(p.ageMonths % 12),
    size: p.size,
    bodyCondition: p.bodyCondition,
    coat: p.coat,
    darkCoat: p.darkCoat,
    conditions: p.conditions.length > 0 ? p.conditions : ['none'],
  };
}

/** Parse the year/month inputs into a non-negative integer ageMonths. */
function toAgeMonths(years: string, months: string): number {
  const y = Number.parseInt(years, 10);
  const m = Number.parseInt(months, 10);
  const yMonths = Number.isFinite(y) && y > 0 ? y * 12 : 0;
  const mMonths = Number.isFinite(m) && m > 0 ? m : 0;
  return yMonths + mMonths;
}

/** Build the DogProfile to persist from current form state. */
function toProfile(s: FormState): DogProfile {
  return {
    name: s.name.trim(),
    breed: s.breed,
    brachycephalic: s.brachycephalic,
    ageMonths: toAgeMonths(s.ageYears, s.ageMonthsPart),
    size: s.size,
    bodyCondition: s.bodyCondition,
    coat: s.coat,
    darkCoat: s.darkCoat,
    conditions: s.conditions.length > 0 ? s.conditions : ['none'],
    schemaVersion: 1,
  };
}

export interface ProfileFormProps {
  /** Called after a successful save with the persisted profile. */
  onSaved?: (profile: DogProfile) => void;
}

export default function ProfileForm({ onSaved }: ProfileFormProps) {
  const [state, setState] = useState<FormState>(freshState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from an existing profile (edit-existing path). A missing/corrupt
  // profile leaves the fresh defaults in place (re-onboard).
  useEffect(() => {
    let active = true;
    void (async () => {
      const existing = await loadProfile();
      if (active && existing !== null) {
        setState(stateFromProfile(existing));
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  /** Selecting a breed auto-fills its characteristics (user can still override). */
  function selectBreed(seed: BreedSeed) {
    setState((prev) => {
      if (seed.name === CUSTOM_BREED) {
        // Custom: keep the user's current toggles, just record the breed name.
        return { ...prev, breed: CUSTOM_BREED };
      }
      return {
        ...prev,
        breed: seed.name,
        brachycephalic: seed.brachycephalic,
        coat: seed.coat,
        size: seed.size,
      };
    });
  }

  /** Toggle a condition; `none` is mutually exclusive with the others. */
  function toggleCondition(value: DogCondition) {
    setState((prev) => {
      if (value === 'none') {
        return { ...prev, conditions: ['none'] };
      }
      const withoutNone = prev.conditions.filter((c) => c !== 'none');
      const next = withoutNone.includes(value)
        ? withoutNone.filter((c) => c !== value)
        : [...withoutNone, value];
      return { ...prev, conditions: next.length > 0 ? next : ['none'] };
    });
  }

  async function handleSave() {
    setError(null);
    if (state.name.trim().length === 0) {
      setError('Please enter your dog’s name.');
      return;
    }
    setSaving(true);
    try {
      const profile = toProfile(state);
      await saveProfile(profile);
      onSaved?.(profile);
    } catch {
      setError('Could not save the profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const ageMonths = toAgeMonths(state.ageYears, state.ageMonthsPart);
  const ageContext =
    ageMonths > 0 && ageMonths < 6
      ? 'Puppy (under 6 months) — extra heat/cold caution.'
      : ageMonths >= 84
        ? 'Senior (7+ years) — extra heat/cold caution.'
        : null;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Dog profile</Text>

      <Field label="Name">
        <TextInput
          style={styles.input}
          value={state.name}
          onChangeText={(t) => update('name', t)}
          placeholder="e.g. Biscuit"
          accessibilityLabel="Dog name"
          testID="input-name"
        />
      </Field>

      <Field label="Breed">
        <View style={styles.chips}>
          {BREED_SEEDS.map((seed) => (
            <Chip
              key={seed.name}
              label={seed.name}
              selected={state.breed === seed.name}
              onPress={() => selectBreed(seed)}
              testID={`breed-${seed.name}`}
            />
          ))}
        </View>
        {state.breed === CUSTOM_BREED ? (
          <Text style={styles.hint}>
            Custom: set brachycephalic, coat, and size below yourself.
          </Text>
        ) : null}
      </Field>

      <ToggleField
        label="Brachycephalic (flat-faced)"
        value={state.brachycephalic}
        onToggle={() => update('brachycephalic', !state.brachycephalic)}
        testID="toggle-brachycephalic"
      />

      <Field label="Age">
        <View style={styles.ageRow}>
          <TextInput
            style={[styles.input, styles.ageInput]}
            value={state.ageYears}
            onChangeText={(t) => update('ageYears', t.replace(/[^0-9]/g, ''))}
            placeholder="Years"
            keyboardType="number-pad"
            accessibilityLabel="Age years"
            testID="input-age-years"
          />
          <TextInput
            style={[styles.input, styles.ageInput]}
            value={state.ageMonthsPart}
            onChangeText={(t) =>
              update('ageMonthsPart', t.replace(/[^0-9]/g, ''))
            }
            placeholder="Months"
            keyboardType="number-pad"
            accessibilityLabel="Age months"
            testID="input-age-months"
          />
        </View>
        {ageContext !== null ? (
          <Text style={styles.hint}>{ageContext}</Text>
        ) : null}
      </Field>

      <Field label="Size (weight band)">
        <Segmented
          options={SIZE_OPTIONS}
          value={state.size}
          onSelect={(v) => update('size', v)}
          testIDPrefix="size"
        />
      </Field>

      <Field label="Body condition">
        <Segmented
          options={BODY_CONDITION_OPTIONS}
          value={state.bodyCondition}
          onSelect={(v) => update('bodyCondition', v)}
          testIDPrefix="body"
        />
      </Field>

      <Field label="Coat">
        <Segmented
          options={COAT_OPTIONS}
          value={state.coat}
          onSelect={(v) => update('coat', v)}
          testIDPrefix="coat"
        />
      </Field>

      <ToggleField
        label="Dark coat"
        value={state.darkCoat}
        onToggle={() => update('darkCoat', !state.darkCoat)}
        testID="toggle-darkCoat"
      />

      <Field label="Health conditions">
        <View style={styles.chips}>
          {CONDITION_OPTIONS.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              selected={state.conditions.includes(opt.value)}
              onPress={() => toggleCondition(opt.value)}
              testID={`condition-${opt.value}`}
            />
          ))}
        </View>
      </Field>

      {error !== null ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={({ pressed }) => [
          styles.saveButton,
          pressed && styles.saveButtonPressed,
          saving && styles.saveButtonDisabled,
        ]}
        onPress={handleSave}
        disabled={saving}
        accessibilityRole="button"
        testID="save-profile"
      >
        <Text style={styles.saveButtonText}>
          {saving ? 'Saving…' : 'Save profile'}
        </Text>
      </Pressable>
    </ScrollView>
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

/** A single selectable chip (used for breed + multi-toggle conditions). */
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
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.toggle, value && styles.toggleOn]}
        onPress={onToggle}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        testID={testID}
      >
        <Text style={[styles.toggleText, value && styles.toggleTextOn]}>
          {value ? 'Yes' : 'No'}
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
    gap: 18,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  hint: {
    fontSize: 13,
    color: '#666',
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  ageRow: {
    flexDirection: 'row',
    gap: 12,
  },
  ageInput: {
    flex: 1,
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
    paddingHorizontal: 14,
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
  error: {
    color: '#c0392b',
    fontSize: 14,
  },
  saveButton: {
    backgroundColor: '#1d6fe0',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  saveButtonPressed: {
    opacity: 0.85,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
});
