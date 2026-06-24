// src/ui/WindowStrip.tsx — "better windows today" strip (plan §4.3 / §5).
// Presentational: takes the WalkWindow[] from the windows scan and the current
// headline level. Renders "good all day" when the headline is green and the whole
// horizon is walkable, otherwise a row of "better after 7:15 PM" chips.

import { StyleSheet, Text, View } from 'react-native';

import type { VerdictLevel } from '../domain/types';
import type { WalkWindow } from '../domain/windows';

import { LEVEL_META } from './RiskBadge';

export interface WindowStripProps {
  windows: WalkWindow[];
  /** The current headline level — drives the "good all day" copy. */
  headlineLevel: VerdictLevel;
  testID?: string;
}

/** A horizontal strip of upcoming walkable windows. */
export default function WindowStrip({
  windows,
  headlineLevel,
  testID,
}: WindowStripProps) {
  // Green headline + a single all-green window = "good all day" (no need to wait).
  const allDayGreen =
    headlineLevel === 'green' &&
    windows.length === 1 &&
    windows[0].level === 'green';

  return (
    <View style={styles.container} testID={testID ?? 'window-strip'}>
      <Text style={styles.heading}>Better windows today</Text>

      {allDayGreen ? (
        <Text style={styles.allDay} testID="window-good-all-day">
          Good all day — conditions stay walkable.
        </Text>
      ) : windows.length === 0 ? (
        <Text style={styles.none} testID="window-none">
          No clearly better window in the next 12 hours.
        </Text>
      ) : (
        <View style={styles.chips}>
          {windows.map((w, i) => {
            const meta = LEVEL_META[w.level];
            return (
              <View
                key={`${w.startIndex}-${i}`}
                style={[styles.chip, { backgroundColor: meta.bg }]}
                testID={`window-chip-${i}`}
              >
                <Text style={styles.chipEmoji}>{meta.emoji}</Text>
                <Text style={[styles.chipText, { color: meta.fg }]}>
                  {/* The first window starting now reads "now"; later ones read
                      "better after <time>". */}
                  {i === 0 && w.startIndex === 0
                    ? 'Good now'
                    : `Better ${w.label}`}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  heading: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  allDay: {
    fontSize: 14,
    color: '#1b7a32',
    fontWeight: '600',
  },
  none: {
    fontSize: 14,
    color: '#777',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipEmoji: {
    fontSize: 13,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
