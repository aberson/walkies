// src/features/home/HomeScreen.tsx — the verdict screen view (plan §5).
// Renders the controller's view-model: handles loading / success / stale / error
// / permission-denied / needs-onboarding. Composes the presentational ui/
// components (VerdictCard, WindowStrip, AlertRow, RiskBadge). All data flows from
// useHomeVerdict — this component does no fetching itself.

import { Link } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AlertRow, RiskBadge, VerdictCard, WindowStrip } from '../../ui';

import { useHomeVerdict, type HomeDeps } from './useHomeVerdict';

export interface HomeScreenProps {
  /** Test seam: inject mocked data/location/storage deps. Domain stays real. */
  deps?: Partial<HomeDeps>;
}

/** A primary action button matching the app's #1d6fe0 palette. */
function PrimaryButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

/** The Home verdict screen. */
export default function HomeScreen({ deps }: HomeScreenProps) {
  const { model, refresh } = useHomeVerdict(deps);

  // ---- loading ----
  if (model.status === 'loading') {
    return (
      <View style={styles.centered} testID="home-loading">
        <ActivityIndicator size="large" color="#1d6fe0" />
        <Text style={styles.muted}>Checking conditions…</Text>
      </View>
    );
  }

  // ---- permission-denied ----
  if (model.status === 'permission-denied') {
    return (
      <View style={styles.centered} testID="home-permission-denied">
        <Text style={styles.title}>Location needed</Text>
        <Text style={styles.body}>
          “Can I Walk My Dog?” needs your location to read the local weather and
          air quality. We never store or share it — only the current coordinates
          are sent to the weather service.
        </Text>
        <PrimaryButton
          label="Allow location & retry"
          onPress={refresh}
          testID="permission-retry"
        />
      </View>
    );
  }

  // ---- needs-onboarding ----
  if (model.status === 'needs-onboarding') {
    return (
      <View style={styles.centered} testID="home-needs-onboarding">
        <Text style={styles.title}>Set up your dog</Text>
        <Text style={styles.body}>
          Add your dog’s profile so the verdict can account for their breed,
          size, coat, and any health conditions.
        </Text>
        <Link href="/profile" asChild>
          <PrimaryButton
            label="Create dog profile"
            onPress={() => {}}
            testID="onboarding-link"
          />
        </Link>
      </View>
    );
  }

  // ---- error ----
  if (model.status === 'error') {
    return (
      <View style={styles.centered} testID="home-error">
        <Text style={styles.title}>Couldn’t get conditions</Text>
        <Text style={styles.body}>
          We couldn’t reach the weather service and have no recent verdict to
          show. Check your connection and try again.
        </Text>
        <PrimaryButton label="Retry" onPress={refresh} testID="error-retry" />
      </View>
    );
  }

  // ---- stale (cached verdict, fresh fetch failed) ----
  if (model.status === 'stale' && model.lastVerdict) {
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        testID="home-stale"
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refresh} />
        }
      >
        <View style={styles.staleBadge} testID="stale-badge">
          <Text style={styles.staleBadgeText}>
            Showing last known result — couldn’t refresh.
          </Text>
        </View>
        <Text style={styles.title}>Last known verdict</Text>
        <RiskBadge level={model.lastVerdict.verdict} />
        <Text style={styles.muted}>
          As of {formatTimestamp(model.lastVerdict.fetchedAt)}
        </Text>
        <PrimaryButton
          label="Try to refresh"
          onPress={refresh}
          testID="stale-retry"
        />
      </ScrollView>
    );
  }

  // ---- success ----
  if (model.status === 'success' && model.verdict) {
    const alerts = model.alerts ?? [];
    return (
      <ScrollView
        contentContainerStyle={styles.content}
        testID="home-success"
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refresh} />
        }
      >
        <VerdictCard
          verdict={model.verdict}
          dogName={model.dogName}
          temperatureUnit={model.temperatureUnit ?? 'F'}
        />

        {alerts.length > 0 ? (
          <View style={styles.alerts} testID="home-alerts">
            {alerts.map((alert, i) => (
              <AlertRow key={`${alert.event}-${i}`} alert={alert} />
            ))}
          </View>
        ) : null}

        <WindowStrip
          windows={model.windows ?? []}
          headlineLevel={model.verdict.level}
        />

        {model.fetchedAt ? (
          <Text style={styles.muted}>
            Updated {formatTimestamp(model.fetchedAt)}
          </Text>
        ) : null}

        <Text style={styles.disclaimer}>
          Informational guidance, not veterinary advice. Use your own judgment.
        </Text>
      </ScrollView>
    );
  }

  // Defensive fallback (should be unreachable given the states above).
  return (
    <View style={styles.centered} testID="home-error">
      <Text style={styles.title}>Something went wrong</Text>
      <PrimaryButton label="Retry" onPress={refresh} testID="error-retry" />
    </View>
  );
}

/** Render an ISO timestamp as a short local time, or the raw string on parse fail. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: '#222',
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    color: '#444',
    textAlign: 'center',
    lineHeight: 21,
  },
  muted: {
    fontSize: 13,
    color: '#777',
  },
  disclaimer: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    marginTop: 4,
  },
  alerts: {
    gap: 8,
  },
  staleBadge: {
    backgroundColor: '#fdf3d6',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  staleBadgeText: {
    color: '#8a6d00',
    fontSize: 14,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#1d6fe0',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 22,
    alignItems: 'center',
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
