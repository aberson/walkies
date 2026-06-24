// src/notifications/backgroundTask.test.ts — registration is best-effort and
// guarded. Mocks expo-task-manager + expo-background-fetch (and, transitively,
// the expo-notifications + AsyncStorage imports schedule.ts pulls in). Asserts:
// registers without throwing, double-registration is guarded, and a registration
// failure is swallowed (no throw).

import * as BackgroundFetch from 'expo-background-fetch';

import {
  BACKGROUND_REFRESH_TASK,
  runBackgroundRefresh,
  registerBackgroundRefresh,
  unregisterBackgroundRefresh,
  type BackgroundFetchApi,
} from './backgroundTask';

// jest hoists these jest.mock calls above the import above, so the SUT (and the
// schedule.ts module graph it pulls in) loads against the mocks.
//
// schedule.ts (imported by backgroundTask.ts) imports expo-notifications (enum)
// and the data barrel (→ AsyncStorage). Mock both so the module graph resolves.
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  cancelAllScheduledNotificationsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// expo-background-fetch is referenced for the BackgroundFetchResult enum at
// runtime in backgroundTask.ts; mock the enum + the registration fns.
jest.mock('expo-background-fetch', () => ({
  BackgroundFetchResult: { NoData: 1, NewData: 2, Failed: 3 },
  registerTaskAsync: jest.fn(),
  unregisterTaskAsync: jest.fn(),
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn(() => false),
}));

/** A fake TaskManager/BackgroundFetch seam that tracks task definition state. */
function fakeApi(over: Partial<BackgroundFetchApi> = {}): BackgroundFetchApi & {
  defineTask: jest.Mock;
  registerTaskAsync: jest.Mock;
  unregisterTaskAsync: jest.Mock;
  defined: Set<string>;
} {
  const defined = new Set<string>();
  const defineTask = jest.fn((name: string) => {
    defined.add(name);
  });
  const isTaskDefined = jest.fn((name: string) => defined.has(name));
  const registerTaskAsync = jest.fn(async () => {});
  const unregisterTaskAsync = jest.fn(async () => {});
  return {
    defineTask,
    isTaskDefined,
    registerTaskAsync,
    unregisterTaskAsync,
    defined,
    ...over,
  } as never;
}

describe('registerBackgroundRefresh (done-when: registers without error)', () => {
  it('resolves true and registers the named task without throwing', async () => {
    const api = fakeApi();
    await expect(registerBackgroundRefresh(api)).resolves.toBe(true);
    expect(api.registerTaskAsync).toHaveBeenCalledTimes(1);
    expect(api.registerTaskAsync.mock.calls[0][0]).toBe(
      BACKGROUND_REFRESH_TASK,
    );
    // Task defined exactly once.
    expect(api.defineTask).toHaveBeenCalledTimes(1);
  });

  it('guards double-registration: defineTask runs only once across two calls', async () => {
    const api = fakeApi();
    await registerBackgroundRefresh(api);
    await registerBackgroundRefresh(api);
    // Defined once (second call sees isTaskDefined → true), registered twice.
    expect(api.defineTask).toHaveBeenCalledTimes(1);
    expect(api.registerTaskAsync).toHaveBeenCalledTimes(2);
  });

  it('swallows a registration failure (best-effort) → resolves false, no throw', async () => {
    const api = fakeApi();
    api.registerTaskAsync.mockRejectedValueOnce(new Error('OS declined'));
    await expect(registerBackgroundRefresh(api)).resolves.toBe(false);
  });

  it('swallows a defineTask failure → resolves false, no throw', async () => {
    const api = fakeApi();
    api.defineTask.mockImplementationOnce(() => {
      throw new Error('define blew up');
    });
    await expect(registerBackgroundRefresh(api)).resolves.toBe(false);
  });
});

describe('runBackgroundRefresh (handler contract: never throws)', () => {
  it('resolves Failed (no throw) when reschedule REJECTS', async () => {
    // An uncaught throw here would crash the OS task runner; the handler must
    // swallow it and report Failed so the OS can tune future scheduling.
    const doReschedule = jest.fn(async () => {
      throw new Error('reschedule blew up');
    });
    await expect(runBackgroundRefresh(doReschedule)).resolves.toBe(
      BackgroundFetch.BackgroundFetchResult.Failed,
    );
    expect(doReschedule).toHaveBeenCalledTimes(1);
  });

  it('resolves NewData when reschedule RESOLVES', async () => {
    const doReschedule = jest.fn(async () => {});
    await expect(runBackgroundRefresh(doReschedule)).resolves.toBe(
      BackgroundFetch.BackgroundFetchResult.NewData,
    );
    expect(doReschedule).toHaveBeenCalledTimes(1);
  });
});

describe('unregisterBackgroundRefresh', () => {
  it('unregisters the named task without throwing', async () => {
    const api = fakeApi();
    await expect(unregisterBackgroundRefresh(api)).resolves.toBeUndefined();
    expect(api.unregisterTaskAsync).toHaveBeenCalledWith(
      BACKGROUND_REFRESH_TASK,
    );
  });

  it('swallows an unregister failure (best-effort) → no throw', async () => {
    const api = fakeApi();
    api.unregisterTaskAsync.mockRejectedValueOnce(new Error('not registered'));
    await expect(unregisterBackgroundRefresh(api)).resolves.toBeUndefined();
  });
});
