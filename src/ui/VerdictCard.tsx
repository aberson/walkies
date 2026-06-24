// src/ui/VerdictCard.tsx — the large 🟢/🟡/🔴 headline card (plan §5).
// Presentational: takes a domain Verdict (+ optional dog name) and renders the
// big emoji, headline, estimated pavement temp with the ALWAYS-shown 7-second
// note, the recommended max minutes, and the binding reasons[].

import { StyleSheet, Text, View } from 'react-native';

import type { Settings, Verdict } from '../domain/types';

import { formatTemperature } from './format';
import { LEVEL_META } from './RiskBadge';

/**
 * The 7-second-test note (plan §5/§9). Shown on EVERY verdict card regardless of
 * level — paw safety guidance never depends on the headline being hot. The domain
 * engine also appends this to `reasons`; the card surfaces it as a standalone,
 * always-visible line so it can't be missed.
 */
export const SEVEN_SECOND_NOTE =
  'Do the 7-second test — if you can’t hold the back of your hand on the ' +
  'pavement for 7 seconds, it’s too hot for paws.';

export interface VerdictCardProps {
  verdict: Verdict;
  /** Optional dog name for the headline ("Biscuit: …"). */
  dogName?: string;
  /**
   * Display unit for the pavement temperature. Defaults to 'F' so existing
   * callers/tests are unaffected; the Home flow threads the user's Settings unit
   * (Step 7). DISPLAY-ONLY — the domain stays in °F (asphalt worst-case math
   * unchanged).
   */
  temperatureUnit?: Settings['temperatureUnit'];
  testID?: string;
}

/** Format the recommended duration as a short human phrase. */
function durationText(minutes: number): string {
  if (minutes <= 0) {
    return 'Potty break only — no real walk right now.';
  }
  return `Recommended max walk: about ${minutes} minutes.`;
}

/** The big headline verdict card. */
export default function VerdictCard({
  verdict,
  dogName,
  temperatureUnit = 'F',
  testID,
}: VerdictCardProps) {
  const meta = LEVEL_META[verdict.level];
  // The 7-second note is rendered as its own line; drop it from the reasons list
  // so it isn't duplicated (the engine appends it as the last reason).
  const reasons = verdict.reasons.filter(
    (r) => !r.includes('7-second test') && !r.includes('7 seconds'),
  );

  return (
    <View
      style={[styles.card, { backgroundColor: meta.bg }]}
      testID={testID ?? `verdict-card-${verdict.level}`}
    >
      <Text style={styles.emoji} accessibilityLabel={`Verdict: ${meta.label}`}>
        {meta.emoji}
      </Text>
      <Text style={[styles.headline, { color: meta.fg }]}>
        {dogName ? `${dogName}: ${verdict.headline}` : verdict.headline}
      </Text>

      <Text style={styles.duration}>
        {durationText(verdict.recommendedMaxMinutes)}
      </Text>

      <View style={styles.pavementRow}>
        <Text style={styles.pavementLabel}>Estimated asphalt</Text>
        <Text style={styles.pavementValue} testID="pavement-value">
          {Number.isFinite(verdict.pavementTempF)
            ? `~${formatTemperature(verdict.pavementTempF, temperatureUnit)}`
            : '—'}
        </Text>
      </View>

      {reasons.length > 0 ? (
        <View style={styles.reasons} testID="verdict-reasons">
          {reasons.map((reason, i) => (
            <Text key={i} style={styles.reason}>
              • {reason}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.sevenSecond} testID="seven-second-note">
        {SEVEN_SECOND_NOTE}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    padding: 20,
    gap: 10,
  },
  emoji: {
    fontSize: 56,
  },
  headline: {
    fontSize: 26,
    fontWeight: '800',
  },
  duration: {
    fontSize: 16,
    color: '#333',
    fontWeight: '600',
  },
  pavementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.12)',
    paddingTop: 10,
  },
  pavementLabel: {
    fontSize: 14,
    color: '#555',
  },
  pavementValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
  },
  reasons: {
    gap: 4,
  },
  reason: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  sevenSecond: {
    fontSize: 13,
    color: '#444',
    fontStyle: 'italic',
    marginTop: 4,
  },
});
