// src/notifications/schedule.test.ts — payload building + the idempotent
// reschedule orchestrator + the opt-in/permission flow.
//
// Mocks ONLY the boundary: expo-notifications, and the data/storage seam injected
// into reschedule/setNotificationsEnabled. The PURE domain (scanWindows, via
// reschedule's real call) is NEVER stubbed — reschedule runs the real scan over
// injected forecast fixtures, proving the producer→consumer wiring end-to-end.

import type {
  AirQuality,
  Alert,
  DogProfile,
  Settings,
  WeatherSnapshot,
} from '../domain/types';
import type { WalkWindow } from '../domain/windows';
import type { NwsForecast } from '../data/nws';
import { ok, fail, type DataResult } from '../data/result';
import type { LocationResult } from '../data';
import { DEFAULT_SETTINGS } from '../storage';

import {
  buildNotifications,
  reschedule,
  requestNotificationPermission,
  setNotificationsEnabled,
  MAX_PENDING_NOTIFICATIONS,
  type NotificationsApi,
  type PermissionResult,
  type RescheduleDeps,
} from './schedule';

// jest hoists these jest.mock calls above the imports above, so the SUT (and the
// data barrel it transitively imports) loads against the mocks.
//
// expo-notifications is only referenced for the SchedulableTriggerInputTypes enum
// at runtime in schedule.ts; mock it so the import resolves under jest without
// pulling the native module.
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  cancelAllScheduledNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

// The data barrel transitively imports AsyncStorage; load its mock so imports
// resolve (every data/storage dep is injected in these tests, not real).
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const NOW = new Date('2999-06-21T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const HOUR = 60 * 60 * 1000;

const MPLS = { lat: 44.96, lon: -93.27 };

const HEALTHY_PROFILE: DogProfile = {
  name: 'Biscuit',
  breed: 'custom',
  brachycephalic: false,
  ageMonths: 36,
  size: 'medium',
  bodyCondition: 'ideal',
  coat: 'medium',
  darkCoat: false,
  conditions: ['none'],
  schemaVersion: 1,
};

function windowAt(offsetMs: number, level: 'green' | 'yellow'): WalkWindow {
  const startTime = new Date(NOW_MS + offsetMs).toISOString();
  return {
    startIndex: 0,
    endIndex: 0,
    startTime,
    endTime: startTime,
    level,
    label: 'after',
  };
}

function alertAt(event: string, onsetOffsetMs: number | null): Alert {
  return {
    event,
    severity: 'Severe',
    headline: `${event} headline`,
    onset:
      onsetOffsetMs === null
        ? null
        : new Date(NOW_MS + onsetOffsetMs).toISOString(),
    ends: null,
  };
}

// ---------------------------------------------------------------------------
// buildNotifications — pure payload mapping + caps (done-when: payload + cap).
// ---------------------------------------------------------------------------

describe('buildNotifications', () => {
  it('maps a green window to a real title/body/triggerAt', () => {
    const out = buildNotifications({
      windows: [windowAt(2 * HOUR, 'green')],
      alerts: [],
      dogName: 'Biscuit',
      now: NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Good walking window for Biscuit');
    expect(out[0].body).toContain('good for a walk after');
    expect(out[0].triggerAt).toBe(NOW_MS + 2 * HOUR);
    expect(out[0].key).toBe(
      `window:${new Date(NOW_MS + 2 * HOUR).toISOString()}`,
    );
  });

  it('softens a yellow window to "okay" copy', () => {
    const out = buildNotifications({
      windows: [windowAt(3 * HOUR, 'yellow')],
      alerts: [],
      dogName: 'Biscuit',
      now: NOW,
    });
    expect(out[0].title).toBe('Okay walking window for Biscuit');
    expect(out[0].body).toContain('okay for a shorter walk');
  });

  it('maps an active alert to a caution payload (event + headline)', () => {
    const out = buildNotifications({
      windows: [],
      alerts: [alertAt('Excessive Heat Warning', 4 * HOUR)],
      now: NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Walk caution: Excessive Heat Warning');
    expect(out[0].body).toBe('Excessive Heat Warning headline');
    expect(out[0].triggerAt).toBe(NOW_MS + 4 * HOUR);
  });

  it('fires an already-active alert (no future onset) immediately (deliver-now)', () => {
    const out = buildNotifications({
      windows: [],
      alerts: [alertAt('Air Quality Alert', null)],
      now: NOW,
    });
    expect(out[0].triggerAt).toBe(NOW_MS);
    // Already-active → immediate (null trigger), not a past-dated DATE trigger
    // (which some platforms drop). A future-onset alert stays a DATE trigger.
    expect(out[0].immediate).toBe(true);
  });

  it('keeps a future-onset alert as a (non-immediate) DATE trigger', () => {
    const out = buildNotifications({
      windows: [],
      alerts: [alertAt('Excessive Heat Warning', 4 * HOUR)],
      now: NOW,
    });
    expect(out[0].triggerAt).toBe(NOW_MS + 4 * HOUR);
    expect(out[0].immediate).toBeFalsy();
  });

  it('cap: ALL alerts survive and windows fill the rest (alerts never truncated)', () => {
    // More windows than free slots, plus several LATE alerts. Under the cap,
    // every alert must survive (even though all the windows are sooner), and
    // the remaining slots fill with the soonest windows. Total never exceeds cap.
    const minute = 60 * 1000;
    const alertCount = 5;
    // Alerts onset LATE (after every window) so a naive soonest-first truncation
    // would drop them — the bug this guards against.
    const alerts = Array.from({ length: alertCount }, (_, i) =>
      alertAt(`Late Alert ${i}`, 10 * HOUR + i * minute),
    );
    // Far more windows than the leftover slots, all sooner than the alerts.
    const windowCount = MAX_PENDING_NOTIFICATIONS + 20;
    const windows = Array.from({ length: windowCount }, (_, i) =>
      windowAt((i + 1) * minute, 'green'),
    );

    const out = buildNotifications({ windows, alerts, now: NOW });

    expect(out.length).toBe(MAX_PENDING_NOTIFICATIONS);
    const keptAlerts = out.filter((d) => d.kind === 'alert');
    const keptWindows = out.filter((d) => d.kind === 'window');
    // Every alert survives despite being later than every window.
    expect(keptAlerts.length).toBe(alertCount);
    // Remaining slots filled by windows (soonest-first).
    expect(keptWindows.length).toBe(MAX_PENDING_NOTIFICATIONS - alertCount);
    expect(keptWindows[0].triggerAt).toBe(NOW_MS + 1 * minute);
  });

  it('falls back to "your dog" when no dogName is given', () => {
    const out = buildNotifications({
      windows: [windowAt(2 * HOUR, 'green')],
      alerts: [],
      now: NOW,
    });
    expect(out[0].title).toBe('Good walking window for your dog');
  });

  it('24h cap: a window > 24 h out is excluded', () => {
    const out = buildNotifications({
      windows: [
        windowAt(2 * HOUR, 'green'), // in-horizon
        windowAt(25 * HOUR, 'green'), // beyond 24 h → dropped
      ],
      alerts: [],
      now: NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0].triggerAt).toBe(NOW_MS + 2 * HOUR);
  });

  it('excludes windows starting at or before now', () => {
    const out = buildNotifications({
      windows: [windowAt(-HOUR, 'green'), windowAt(0, 'green')],
      alerts: [],
      now: NOW,
    });
    expect(out).toHaveLength(0);
  });

  it('iOS-limit cap: more candidates than the limit → output ≤ limit, soonest kept', () => {
    // Build (limit + 10) candidate windows, each 1 minute apart but all within
    // 24 h, so only the cap survives and they are the SOONEST ones.
    const minute = 60 * 1000;
    const count = MAX_PENDING_NOTIFICATIONS + 10;
    const windows = Array.from({ length: count }, (_, i) =>
      windowAt((i + 1) * minute, 'green'),
    );
    const out = buildNotifications({ windows, alerts: [], now: NOW });
    expect(out.length).toBe(MAX_PENDING_NOTIFICATIONS);
    // Soonest-first: the first kept is +1 min, the last kept is +cap min.
    expect(out[0].triggerAt).toBe(NOW_MS + 1 * minute);
    expect(out[out.length - 1].triggerAt).toBe(
      NOW_MS + MAX_PENDING_NOTIFICATIONS * minute,
    );
  });

  it('coalesces duplicate-key windows into one descriptor', () => {
    const w = windowAt(2 * HOUR, 'green');
    const out = buildNotifications({
      windows: [w, { ...w }], // identical startTime → identical key
      alerts: [],
      now: NOW,
    });
    expect(out).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// reschedule — idempotency + opt-out (done-when: idempotency, opt-out).
// ---------------------------------------------------------------------------

/** A fake expo-notifications scheduler that records the pending set by key. */
function fakeNotifications(): NotificationsApi & {
  cancelAllScheduledNotificationsAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
  pendingKeys: () => string[];
  pending: Map<string, unknown>;
} {
  const pending = new Map<string, unknown>();
  const cancelAllScheduledNotificationsAsync = jest.fn(async () => {
    pending.clear();
  });
  const scheduleNotificationAsync = jest.fn(
    async (req: { identifier?: string }) => {
      const id = req.identifier ?? `auto-${pending.size}`;
      pending.set(id, req);
      return id;
    },
  );
  return {
    cancelAllScheduledNotificationsAsync,
    scheduleNotificationAsync,
    pending,
    pendingKeys: () => [...pending.keys()].sort(),
  };
}

/** Hourly comfortable snapshots → scanWindows yields green windows. */
function comfortableHours(count: number, airTempF: number): WeatherSnapshot[] {
  return Array.from({ length: count }, (_, i) => ({
    startTime: new Date(NOW_MS + (i + 1) * HOUR).toISOString(),
    airTempF,
    relativeHumidity: 40,
    windSpeedMph: 3,
    skyCoverPct: 50,
    precipProbability: 0,
    isDaytime: false,
  }));
}

function forecast(hours: WeatherSnapshot[], alerts: Alert[] = []): NwsForecast {
  return {
    points: {
      gridId: 'MPX',
      gridX: 107,
      gridY: 71,
      forecastHourly: 'h',
      forecastGridData: 'g',
    },
    hourly: hours,
    alerts,
  };
}

function rescheduleDeps(over: {
  notifications: NotificationsApi;
  settings?: Settings;
  location?: LocationResult;
  profile?: DogProfile | null;
  forecastRes?: DataResult<NwsForecast>;
  aqiRes?: DataResult<AirQuality>;
}): Partial<RescheduleDeps> {
  return {
    notifications: over.notifications,
    loadSettings: async () =>
      over.settings ?? { ...DEFAULT_SETTINGS, notificationsEnabled: true },
    getCurrentLocation: async (): Promise<LocationResult> =>
      over.location ?? { ok: true, data: MPLS },
    loadProfile: async () =>
      over.profile === undefined ? HEALTHY_PROFILE : over.profile,
    fetchForecast: async () =>
      over.forecastRes ?? ok(forecast(comfortableHours(12, 60))),
    fetchAirQuality: async () => over.aqiRes ?? ok({ usAqi: 20 }),
    now: () => NOW,
  };
}

describe('reschedule — idempotency (done-when)', () => {
  it('rescheduling twice yields the SAME pending set (no duplicates)', async () => {
    const notifications = fakeNotifications();
    const deps = rescheduleDeps({ notifications });

    await reschedule(deps);
    const afterFirst = notifications.pendingKeys();
    const scheduleCallsAfterFirst =
      notifications.scheduleNotificationAsync.mock.calls.length;

    await reschedule(deps);
    const afterSecond = notifications.pendingKeys();
    const scheduleCallsAfterSecond =
      notifications.scheduleNotificationAsync.mock.calls.length;

    // Same pending set after run 2 as after run 1 — no growth, no duplicates.
    expect(afterSecond).toEqual(afterFirst);
    expect(afterFirst.length).toBeGreaterThan(0);
    // No duplicate keys in the final pending set.
    expect(new Set(afterSecond).size).toBe(afterSecond.length);
    // No EXTRA schedule attempts on the second run — the two runs each issue the
    // same number of scheduleNotificationAsync calls (pins idempotent effort, not
    // just an idempotent final key set).
    expect(scheduleCallsAfterSecond - scheduleCallsAfterFirst).toBe(
      scheduleCallsAfterFirst,
    );
  });

  it('cancelAllScheduledNotificationsAsync runs before scheduling on EACH run', async () => {
    const notifications = fakeNotifications();
    const order: string[] = [];
    notifications.cancelAllScheduledNotificationsAsync.mockImplementation(
      async () => {
        order.push('cancel');
        notifications.pending.clear();
      },
    );
    notifications.scheduleNotificationAsync.mockImplementation(
      async (req: { identifier?: string }) => {
        order.push('schedule');
        const id = req.identifier ?? `auto-${notifications.pending.size}`;
        notifications.pending.set(id, req);
        return id;
      },
    );
    const deps = rescheduleDeps({ notifications });

    await reschedule(deps);
    await reschedule(deps);

    // Every 'schedule' is preceded by a 'cancel'; the first action is a cancel,
    // and a second cancel appears before the second run's schedules.
    expect(order[0]).toBe('cancel');
    const firstSchedule = order.indexOf('schedule');
    expect(order.lastIndexOf('cancel')).toBeGreaterThan(firstSchedule);
    // cancel called exactly twice (once per run).
    expect(
      notifications.cancelAllScheduledNotificationsAsync,
    ).toHaveBeenCalledTimes(2);
  });
});

describe('reschedule — opt-out (done-when)', () => {
  it('notificationsEnabled=false → cancels all, schedules nothing', async () => {
    const notifications = fakeNotifications();
    const deps = rescheduleDeps({
      notifications,
      settings: { ...DEFAULT_SETTINGS, notificationsEnabled: false },
    });

    await reschedule(deps);

    expect(
      notifications.cancelAllScheduledNotificationsAsync,
    ).toHaveBeenCalledTimes(1);
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(notifications.pendingKeys()).toEqual([]);
  });

  it('cancels (then schedules nothing) when location is denied', async () => {
    const notifications = fakeNotifications();
    const deps = rescheduleDeps({
      notifications,
      location: { ok: false, reason: 'permission-denied' },
    });

    await reschedule(deps);

    expect(
      notifications.cancelAllScheduledNotificationsAsync,
    ).toHaveBeenCalledTimes(1);
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels (then schedules nothing) when the forecast fetch fails', async () => {
    const notifications = fakeNotifications();
    const deps = rescheduleDeps({
      notifications,
      forecastRes: fail('timeout'),
    });

    await reschedule(deps);

    expect(
      notifications.cancelAllScheduledNotificationsAsync,
    ).toHaveBeenCalledTimes(1);
    expect(notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules window notifications from the real scan when enabled (no alerts)', async () => {
    const notifications = fakeNotifications();
    const deps = rescheduleDeps({
      notifications,
      // Comfortable, alert-free forecast → the real scanWindows yields a green
      // window, proving the producer→consumer wiring end-to-end (domain not stubbed).
      forecastRes: ok(forecast(comfortableHours(12, 60))),
    });

    await reschedule(deps);

    expect(
      notifications.scheduleNotificationAsync.mock.calls.length,
    ).toBeGreaterThan(0);
    const keys = notifications.pendingKeys();
    expect(keys.some((k) => k.startsWith('window:'))).toBe(true);
  });

  it('schedules an alert caution when an active NWS alert is present', async () => {
    // An active alert reds out every hour (most-restrictive-signal-wins), so the
    // real scan yields NO walk windows — but the alert itself must still surface
    // as a caution notification.
    const notifications = fakeNotifications();
    const deps = rescheduleDeps({
      notifications,
      forecastRes: ok(
        forecast(comfortableHours(12, 60), [
          alertAt('Heat Advisory', 2 * HOUR),
        ]),
      ),
    });

    await reschedule(deps);

    const keys = notifications.pendingKeys();
    expect(keys.some((k) => k.startsWith('alert:Heat Advisory'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Permission flow + setNotificationsEnabled.
// ---------------------------------------------------------------------------

describe('requestNotificationPermission', () => {
  it('returns granted when already granted (no prompt)', async () => {
    const requestPermissionsAsync = jest.fn();
    const res = await requestNotificationPermission({
      getPermissionsAsync: jest.fn(async () => ({ granted: true })) as never,
      requestPermissionsAsync: requestPermissionsAsync as never,
    });
    expect(res).toEqual({ granted: true });
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('prompts and returns granted when the user grants', async () => {
    const res = await requestNotificationPermission({
      getPermissionsAsync: jest.fn(async () => ({ granted: false })) as never,
      requestPermissionsAsync: jest.fn(async () => ({
        granted: true,
      })) as never,
    });
    expect(res).toEqual({ granted: true });
  });

  it('returns denied (no throw) when the user denies', async () => {
    const res = await requestNotificationPermission({
      getPermissionsAsync: jest.fn(async () => ({ granted: false })) as never,
      requestPermissionsAsync: jest.fn(async () => ({
        granted: false,
      })) as never,
    });
    expect(res).toEqual({ granted: false, reason: 'denied' });
  });

  it('returns error (no throw) when the request throws', async () => {
    const res = await requestNotificationPermission({
      getPermissionsAsync: jest.fn(async () => {
        throw new Error('boom');
      }) as never,
      requestPermissionsAsync: jest.fn() as never,
    });
    expect(res).toEqual({ granted: false, reason: 'error' });
  });
});

describe('setNotificationsEnabled', () => {
  it('opting OUT persists false and reschedules (cancel-all path)', async () => {
    const saved: Settings[] = [];
    const rescheduleSpy = jest.fn(async () => {});
    const res = await setNotificationsEnabled(false, {
      loadSettings: async () => ({
        ...DEFAULT_SETTINGS,
        notificationsEnabled: true,
      }),
      saveSettings: async (s) => {
        saved.push(s);
      },
      requestPermission: jest.fn() as () => Promise<PermissionResult>,
      reschedule: rescheduleSpy,
    });
    expect(res).toEqual({ granted: true });
    expect(saved[0].notificationsEnabled).toBe(false);
    expect(rescheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('opting IN with granted permission persists true and reschedules', async () => {
    const saved: Settings[] = [];
    const rescheduleSpy = jest.fn(async () => {});
    const res = await setNotificationsEnabled(true, {
      loadSettings: async () => DEFAULT_SETTINGS,
      saveSettings: async (s) => {
        saved.push(s);
      },
      requestPermission: async () => ({ granted: true }),
      reschedule: rescheduleSpy,
    });
    expect(res).toEqual({ granted: true });
    expect(saved[0].notificationsEnabled).toBe(true);
    expect(rescheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('opting IN with denied permission persists false and does not crash', async () => {
    const saved: Settings[] = [];
    const rescheduleSpy = jest.fn(async () => {});
    const res = await setNotificationsEnabled(true, {
      loadSettings: async () => DEFAULT_SETTINGS,
      saveSettings: async (s) => {
        saved.push(s);
      },
      requestPermission: async () => ({ granted: false, reason: 'denied' }),
      reschedule: rescheduleSpy,
    });
    expect(res).toEqual({ granted: false, reason: 'denied' });
    // Denied → we cannot deliver, so the persisted opt-in is false.
    expect(saved[0].notificationsEnabled).toBe(false);
    expect(rescheduleSpy).toHaveBeenCalledTimes(1);
  });
});
