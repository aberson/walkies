// src/notifications/schedule.ts — build + (re)schedule on-device local
// notifications from the best walking windows + active NWS alerts (plan §4.3,
// §5, §6).
//
// Two layers:
//   1. buildNotifications(...) — a PURE, deterministic payload builder (no I/O).
//      Maps "better windows today" and active alerts into notification
//      descriptors, capping to the next 24 h and to the iOS pending-notification
//      limit (plan §9: iOS caps ~64 pending). Unit-testable without expo.
//   2. reschedule(deps) — the idempotent orchestrator. ALWAYS cancels every
//      pending notification FIRST, then (if enabled) refetches the current data
//      via the SAME data seam useHomeVerdict uses, builds payloads, and schedules
//      each. BOTH the foreground-open path and the background-fetch path call
//      this one function, so the two triggers can never stack duplicates for the
//      same window (plan §6 cancel-then-reschedule discipline).
//
// This module may import expo-*, data, storage, and domain TYPES. It must NOT be
// imported by src/domain (domain stays pure).

import * as Notifications from 'expo-notifications';

import {
  fetchAirQuality as realFetchAirQuality,
  fetchForecast as realFetchForecast,
  getCurrentLocation as realGetCurrentLocation,
  type DataResult,
  type LocationResult,
} from '../data';
import type { NwsForecast } from '../data/nws';
import { scanWindows } from '../domain';
import type { AirQuality, Alert, DogProfile, Settings } from '../domain/types';
import type { WalkWindow } from '../domain/windows';
import {
  loadProfile as realLoadProfile,
  loadSettings as realLoadSettings,
  saveSettings as realSaveSettings,
} from '../storage';

// ---------------------------------------------------------------------------
// Constants (ONE source of truth for the caps).
// ---------------------------------------------------------------------------

/** Scheduling horizon: never schedule a notification more than 24 h out (§6). */
export const SCHEDULE_HORIZON_MS = 24 * 60 * 60 * 1000;

/**
 * Max pending notifications we will ever schedule. iOS silently caps the pending
 * queue at ~64 (plan §9); we stay safely under and coalesce/limit so the queue
 * can never exceed it. ONE source of truth — both the builder cap and any future
 * consumer read this.
 */
export const MAX_PENDING_NOTIFICATIONS = 60;

// ---------------------------------------------------------------------------
// Pure payload builder.
// ---------------------------------------------------------------------------

/**
 * A single local-notification descriptor. Deterministic output of
 * `buildNotifications`; later handed to `scheduleNotificationAsync`.
 */
export interface NotificationDescriptor {
  /**
   * Stable de-dupe key derived from the source (window startTime or alert
   * event+onset). Two builds over the same inputs produce the same key, so a
   * cancel-then-reschedule cycle yields an identical pending set — no duplicates.
   */
  key: string;
  title: string;
  body: string;
  /** When the notification should fire, as epoch ms. */
  triggerAt: number;
  /**
   * Source kind. Alerts are safety-critical and are never truncated ahead of
   * windows under the pending cap (§9).
   */
  kind: 'window' | 'alert';
  /**
   * Deliver immediately (a null / deliver-now trigger) rather than scheduling a
   * DATE trigger. True for an alert that is already in effect (no future onset):
   * a past-dated DATE trigger is dropped by some platforms, so we deliver now so
   * the "already in effect" caution reliably fires.
   */
  immediate?: boolean;
}

export interface BuildNotificationsInput {
  /** Best windows today, from scanWindows (chronological). */
  windows: WalkWindow[];
  /** Active NWS alerts. */
  alerts: Alert[];
  /** Dog name for the window copy (e.g. "Good walking window for Biscuit ..."). */
  dogName?: string;
  /** "Now" — the lower bound for triggerAt and the base of the 24 h horizon. */
  now: Date;
}

/** A friendly clock label, e.g. "7:15 PM", from an ISO instant. */
function clockLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return 'later';
  }
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/**
 * Build a "good walking window" descriptor for a single window, or null when the
 * window starts in the past or beyond the 24 h horizon (so it is excluded).
 *
 * A green window reads as a clear go; a yellow window is surfaced as a softer
 * "okay" so the copy never over-promises (plan §8 conservative framing).
 */
function windowDescriptor(
  window: WalkWindow,
  dogName: string | undefined,
  nowMs: number,
): NotificationDescriptor | null {
  const startMs = Date.parse(window.startTime);
  if (Number.isNaN(startMs)) {
    return null;
  }
  // Strictly in the future and within the horizon (24 h cap).
  if (startMs <= nowMs || startMs - nowMs > SCHEDULE_HORIZON_MS) {
    return null;
  }

  const who = dogName ? dogName : 'your dog';
  const time = clockLabel(window.startTime);
  const title =
    window.level === 'green'
      ? `Good walking window for ${who}`
      : `Okay walking window for ${who}`;
  const body =
    window.level === 'green'
      ? `Conditions look good for a walk after ${time}.`
      : `Conditions are okay for a shorter walk after ${time}.`;

  return {
    // Key on the window's own start instant → stable across rebuilds.
    key: `window:${window.startTime}`,
    title,
    body,
    triggerAt: startMs,
    kind: 'window',
  };
}

/**
 * Build a caution descriptor for an active alert, or null when the alert has no
 * usable onset within the horizon. Alerts with no onset (or a past onset) but
 * still active are surfaced immediately at `now` so the user is warned promptly.
 */
function alertDescriptor(
  alert: Alert,
  nowMs: number,
): NotificationDescriptor | null {
  const event = alert.event.trim();
  if (event === '') {
    return null;
  }

  // Prefer the alert onset; fall back to "now" for an already-active alert. An
  // onset beyond the 24 h horizon is excluded.
  const onsetMs = alert.onset ? Date.parse(alert.onset) : Number.NaN;
  let triggerAt: number;
  let immediate = false;
  if (!Number.isNaN(onsetMs) && onsetMs > nowMs) {
    if (onsetMs - nowMs > SCHEDULE_HORIZON_MS) {
      return null;
    }
    triggerAt = onsetMs;
  } else {
    // No future onset → warn immediately (alert is already in effect). Mark it
    // as an immediate delivery: a DATE trigger at/just-before "now" can be
    // silently dropped on some platforms, so we deliver-now instead.
    triggerAt = nowMs;
    immediate = true;
  }

  const headline = alert.headline.trim();
  const body =
    headline !== ''
      ? headline
      : `${event} is in effect — take extra care on walks.`;

  return {
    // Key on event + onset so the same alert never schedules twice.
    key: `alert:${event}:${alert.onset ?? 'now'}`,
    title: `Walk caution: ${event}`,
    body,
    triggerAt,
    kind: 'alert',
    immediate,
  };
}

/**
 * Build the deterministic set of notification descriptors for the next 24 h from
 * the best windows + active alerts.
 *
 * Caps applied, in order:
 *   - 24 h horizon: any window/alert firing beyond `now + 24 h` is excluded.
 *   - past: windows starting at/before `now` are excluded (alerts with no future
 *     onset fire at `now`).
 *   - iOS pending limit: at most `MAX_PENDING_NOTIFICATIONS` descriptors. Alerts
 *     (safety-critical) are NEVER truncated ahead of windows: we keep ALL alerts
 *     up to the cap first, then fill the remaining slots with the SOONEST
 *     windows — so a late safety alert can never be dropped to make room for a
 *     sooner walk window. Within each group, soonest-first.
 *   - de-dupe: descriptors sharing a key are coalesced (last write wins on key),
 *     so two windows/alerts can never map to two pending entries for one source.
 *
 * Pure: no I/O, no clock except the injected `now`. Same inputs → same output.
 */
export function buildNotifications(
  input: BuildNotificationsInput,
): NotificationDescriptor[] {
  const { windows, alerts, dogName, now } = input;
  const nowMs = now.getTime();

  const alertDescriptors = alerts
    .map((a) => alertDescriptor(a, nowMs))
    .filter((d): d is NotificationDescriptor => d !== null);
  const windowDescriptors = windows
    .map((w) => windowDescriptor(w, dogName, nowMs))
    .filter((d): d is NotificationDescriptor => d !== null);

  // Coalesce by key (de-dupe), preserving alert-before-window priority by
  // inserting alerts first.
  const byKey = new Map<string, NotificationDescriptor>();
  for (const d of [...alertDescriptors, ...windowDescriptors]) {
    if (!byKey.has(d.key)) {
      byKey.set(d.key, d);
    }
  }
  const deduped = [...byKey.values()];

  // Split by kind so alerts are never truncated ahead of windows. Each group is
  // soonest-first; we keep ALL alerts (up to the cap), then fill the remaining
  // slots with the soonest windows. Never exceeds the cap. Deterministic.
  const bySoonest = (a: NotificationDescriptor, b: NotificationDescriptor) =>
    a.triggerAt - b.triggerAt;
  const alertsKept = deduped
    .filter((d) => d.kind === 'alert')
    .sort(bySoonest)
    .slice(0, MAX_PENDING_NOTIFICATIONS);
  const windowSlots = MAX_PENDING_NOTIFICATIONS - alertsKept.length;
  const windowsKept = deduped
    .filter((d) => d.kind === 'window')
    .sort(bySoonest)
    .slice(0, Math.max(0, windowSlots));

  // Final order: soonest-first across the combined kept set (stable, deterministic).
  return [...alertsKept, ...windowsKept].sort(bySoonest);
}

// ---------------------------------------------------------------------------
// Injectable dependency seam (mirrors useHomeVerdict's HomeDeps).
// ---------------------------------------------------------------------------

/**
 * The subset of expo-notifications scheduling the orchestrator touches. Injected
 * so `reschedule` is testable without the real native module.
 */
export interface NotificationsApi {
  cancelAllScheduledNotificationsAsync: () => Promise<void>;
  scheduleNotificationAsync: (
    request: Notifications.NotificationRequestInput,
  ) => Promise<string>;
}

/** Injectable deps for `reschedule` — defaults to the real expo/data/storage stack. */
export interface RescheduleDeps {
  notifications: NotificationsApi;
  getCurrentLocation: () => Promise<LocationResult>;
  loadProfile: () => Promise<DogProfile | null>;
  loadSettings: () => Promise<Settings>;
  fetchForecast: (lat: number, lon: number) => Promise<DataResult<NwsForecast>>;
  fetchAirQuality: (
    lat: number,
    lon: number,
  ) => Promise<DataResult<AirQuality>>;
  /** Clock seam so tests can pin "now". */
  now: () => Date;
}

const defaultNotificationsApi: NotificationsApi = {
  cancelAllScheduledNotificationsAsync:
    Notifications.cancelAllScheduledNotificationsAsync,
  scheduleNotificationAsync: Notifications.scheduleNotificationAsync,
};

const defaultRescheduleDeps: RescheduleDeps = {
  notifications: defaultNotificationsApi,
  getCurrentLocation: realGetCurrentLocation,
  loadProfile: realLoadProfile,
  loadSettings: realLoadSettings,
  fetchForecast: realFetchForecast,
  fetchAirQuality: realFetchAirQuality,
  now: () => new Date(),
};

/**
 * Idempotently rebuild the pending notification set.
 *
 * Contract (plan §6):
 *   1. ALWAYS `cancelAllScheduledNotificationsAsync()` FIRST — every run starts
 *      from an empty pending queue, so re-running can never stack duplicates.
 *   2. If notifications are disabled in Settings → return after the cancel
 *      (opting out leaves ZERO pending and schedules nothing).
 *   3. Otherwise refetch the current data via the SAME data seam useHomeVerdict
 *      uses (location → forecast → windows via scanWindows), build payloads, and
 *      schedule each via a DATE trigger.
 *
 * Both the foreground-open path and the background-fetch path call THIS function,
 * so the two triggers converge on one identical pending set. Never throws — a
 * data/location failure simply leaves the (already-cancelled) queue empty.
 *
 * @param overrides optional dependency overrides (tests inject fixtures here)
 */
export async function reschedule(
  overrides: Partial<RescheduleDeps> = {},
): Promise<void> {
  const deps: RescheduleDeps = { ...defaultRescheduleDeps, ...overrides };

  // (1) Always clear first — the core idempotency guarantee.
  await deps.notifications.cancelAllScheduledNotificationsAsync();

  // (2) Gate on the opt-in. Disabled → nothing scheduled (queue stays empty).
  const settings = await deps.loadSettings();
  if (!settings.notificationsEnabled) {
    return;
  }

  // (3) Refetch current data via the shared seam.
  const loc = await deps.getCurrentLocation();
  if (!loc.ok) {
    return;
  }
  const point = loc.data;

  const profile = await deps.loadProfile();
  if (profile === null) {
    return;
  }

  const forecastRes = await deps.fetchForecast(point.lat, point.lon);
  if (!forecastRes.ok) {
    return;
  }
  const forecast = forecastRes.data;

  const aqiRes = await deps.fetchAirQuality(point.lat, point.lon);
  // AQI degrades softly (mirrors useHomeVerdict): drop the signal on failure.
  const airQuality: AirQuality = aqiRes.ok ? aqiRes.data : { usAqi: null };

  // Best windows via the REAL pure domain scan (never stubbed).
  const { windows } = scanWindows({
    hours: forecast.hourly,
    airQuality,
    alerts: forecast.alerts,
    profile,
    location: point,
  });

  const descriptors = buildNotifications({
    windows,
    alerts: forecast.alerts,
    dogName: profile.name.trim() || undefined,
    now: deps.now(),
  });

  // Schedule each keyed by its stable identifier. An `immediate` descriptor (an
  // already-active alert) uses a null trigger (deliver-now) — a past-dated DATE
  // trigger is dropped by some platforms — while everything else uses a DATE
  // trigger at its future instant.
  for (const d of descriptors) {
    await deps.notifications.scheduleNotificationAsync({
      identifier: d.key,
      content: { title: d.title, body: d.body },
      trigger: d.immediate
        ? null
        : {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: d.triggerAt,
          },
    });
  }
}

// ---------------------------------------------------------------------------
// Permission flow + Settings opt-in.
// ---------------------------------------------------------------------------

/** Typed outcome of a notification-permission request (never a throw). */
export type PermissionResult =
  /** Permission is granted — we may schedule. */
  | { granted: true }
  /** Permission denied (or the request failed) — handled gracefully, no throw. */
  | { granted: false; reason: 'denied' | 'error' };

/**
 * Request (or confirm) notification permission via expo-notifications. Checks the
 * existing grant first and only prompts when not already granted. A denial or a
 * thrown request resolves to a typed `{ granted: false }` — never throws, so the
 * caller (opt-in flow) can degrade gracefully.
 */
export async function requestNotificationPermission(
  api: {
    getPermissionsAsync: typeof Notifications.getPermissionsAsync;
    requestPermissionsAsync: typeof Notifications.requestPermissionsAsync;
  } = {
    getPermissionsAsync: Notifications.getPermissionsAsync,
    requestPermissionsAsync: Notifications.requestPermissionsAsync,
  },
): Promise<PermissionResult> {
  try {
    const existing = await api.getPermissionsAsync();
    if (existing.granted) {
      return { granted: true };
    }
    const requested = await api.requestPermissionsAsync();
    return requested.granted
      ? { granted: true }
      : { granted: false, reason: 'denied' };
  } catch {
    return { granted: false, reason: 'error' };
  }
}

/** Injectable deps for `setNotificationsEnabled`. */
export interface SetNotificationsEnabledDeps {
  loadSettings: () => Promise<Settings>;
  saveSettings: (settings: Settings) => Promise<void>;
  requestPermission: () => Promise<PermissionResult>;
  reschedule: (overrides?: Partial<RescheduleDeps>) => Promise<void>;
}

const defaultSetEnabledDeps: SetNotificationsEnabledDeps = {
  loadSettings: realLoadSettings,
  saveSettings: realSaveSettings,
  requestPermission: requestNotificationPermission,
  reschedule,
};

/**
 * Toggle the notifications opt-in and reconcile the pending queue.
 *
 *   - Opting OUT: persist `notificationsEnabled = false`, then `reschedule`
 *     (which cancels all + schedules nothing). Returns `{ granted: true }` since
 *     no permission is needed to turn the feature off.
 *   - Opting IN: request permission first. On denial, persist `false` (we cannot
 *     deliver) and reschedule (a no-op clear) — never crash. On grant, persist
 *     `true` and reschedule (schedules the day's set).
 *
 * @returns the permission result so the UI can surface a "turn on in Settings" hint.
 */
export async function setNotificationsEnabled(
  enabled: boolean,
  overrides: Partial<SetNotificationsEnabledDeps> = {},
): Promise<PermissionResult> {
  const deps: SetNotificationsEnabledDeps = {
    ...defaultSetEnabledDeps,
    ...overrides,
  };

  if (!enabled) {
    const settings = await deps.loadSettings();
    await deps.saveSettings({ ...settings, notificationsEnabled: false });
    await deps.reschedule();
    return { granted: true };
  }

  // Opting in → need permission before we promise to deliver.
  const permission = await deps.requestPermission();
  const settings = await deps.loadSettings();
  await deps.saveSettings({
    ...settings,
    notificationsEnabled: permission.granted,
  });
  await deps.reschedule();
  return permission;
}
