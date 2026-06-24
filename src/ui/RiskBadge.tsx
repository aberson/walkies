// src/ui/RiskBadge.tsx — a small level chip (🟢/🟡/🔴 + label). Presentational:
// takes a VerdictLevel, renders the emoji + a short word in the level's colour.

import { StyleSheet, Text, View } from 'react-native';

import type { VerdictLevel } from '../domain/types';

/** Emoji + short label + colours for each verdict level. ONE source of truth. */
export const LEVEL_META: Readonly<
  Record<VerdictLevel, { emoji: string; label: string; fg: string; bg: string }>
> = {
  green: { emoji: '🟢', label: 'Go', fg: '#1b7a32', bg: '#e6f4ea' },
  yellow: { emoji: '🟡', label: 'Caution', fg: '#8a6d00', bg: '#fdf3d6' },
  red: { emoji: '🔴', label: 'Unsafe', fg: '#a32020', bg: '#fdeaea' },
};

export interface RiskBadgeProps {
  level: VerdictLevel;
  /** Override the default per-level word (e.g. "Last: Caution"). */
  label?: string;
  testID?: string;
}

/** A compact level chip. */
export default function RiskBadge({ level, label, testID }: RiskBadgeProps) {
  const meta = LEVEL_META[level];
  return (
    <View
      style={[styles.badge, { backgroundColor: meta.bg }]}
      accessibilityRole="text"
      accessibilityLabel={`Risk level: ${meta.label}`}
      testID={testID ?? `risk-badge-${level}`}
    >
      <Text style={styles.emoji}>{meta.emoji}</Text>
      <Text style={[styles.label, { color: meta.fg }]}>
        {label ?? meta.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  emoji: {
    fontSize: 14,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
  },
});
