// src/ui/AlertRow.tsx — one active NWS alert row (plan §5). Presentational:
// takes a domain Alert and renders the event + headline. Severity tints the row.

import { StyleSheet, Text, View } from 'react-native';

import type { Alert } from '../domain/types';

export interface AlertRowProps {
  alert: Alert;
  testID?: string;
}

/** Pick a tint for the alert by its NWS severity. */
function severityColor(severity: string): { fg: string; bg: string } {
  const s = severity.toLowerCase();
  if (s === 'extreme' || s === 'severe') {
    return { fg: '#a32020', bg: '#fdeaea' };
  }
  if (s === 'moderate') {
    return { fg: '#8a6d00', bg: '#fdf3d6' };
  }
  return { fg: '#444', bg: '#eef1f5' };
}

/** A single active-alert row: event name + headline. */
export default function AlertRow({ alert, testID }: AlertRowProps) {
  const c = severityColor(alert.severity);
  return (
    <View
      style={[styles.row, { backgroundColor: c.bg }]}
      accessibilityRole="text"
      testID={testID ?? 'alert-row'}
    >
      <Text style={[styles.event, { color: c.fg }]}>
        ⚠️ {alert.event || 'Weather alert'}
      </Text>
      {alert.headline ? (
        <Text style={styles.headline} numberOfLines={3}>
          {alert.headline}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: 10,
    padding: 12,
    gap: 4,
  },
  event: {
    fontSize: 15,
    fontWeight: '700',
  },
  headline: {
    fontSize: 13,
    color: '#333',
    lineHeight: 18,
  },
});
