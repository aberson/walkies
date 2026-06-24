// src/notifications/backgroundTask.ts — the opportunistic background-fetch task
// that refetches the forecast and re-runs `reschedule` (plan §6, §9).
//
// iOS background-fetch is OPPORTUNISTIC — the OS decides if/when it runs (plan
// §9), so this is strictly best-effort: every app open also reschedules a full
// day, and registration that the OS declines must NOT crash the app. The task
// handler calls the SAME `reschedule` the foreground path uses, so a background
// run can never stack duplicates against a foreground run (cancel-then-reschedule
// converges on one identical pending set).

import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';

import { reschedule } from './schedule';

/**
 * Named background task. ONE source of truth — `defineTask`, `registerTaskAsync`,
 * and `unregisterTaskAsync` all reference this constant.
 */
export const BACKGROUND_REFRESH_TASK = 'walkies-background-refresh';

/**
 * The subset of expo-task-manager + expo-background-fetch the registration touches.
 * Injected so the register/unregister helpers are testable without the real native
 * modules.
 */
export interface BackgroundFetchApi {
  defineTask: typeof TaskManager.defineTask;
  isTaskDefined: typeof TaskManager.isTaskDefined;
  registerTaskAsync: typeof BackgroundFetch.registerTaskAsync;
  unregisterTaskAsync: typeof BackgroundFetch.unregisterTaskAsync;
}

const defaultApi: BackgroundFetchApi = {
  defineTask: TaskManager.defineTask,
  isTaskDefined: TaskManager.isTaskDefined,
  registerTaskAsync: BackgroundFetch.registerTaskAsync,
  unregisterTaskAsync: BackgroundFetch.unregisterTaskAsync,
};

/**
 * The task handler: best-effort refetch + reschedule. Returns NewData on success
 * and Failed on any error (so iOS can tune future scheduling) — but never lets an
 * exception escape, since an uncaught throw here would crash the OS task runner.
 *
 * Exported + accepts an injected `reschedule` so the contract ("never throw;
 * resolve Failed on error, NewData on success") can be tested directly without
 * the native runtime.
 *
 * @param doReschedule the rescheduler to invoke (defaults to the real one).
 */
export async function runBackgroundRefresh(
  doReschedule: () => Promise<void> = reschedule,
): Promise<BackgroundFetch.BackgroundFetchResult> {
  try {
    await doReschedule();
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
}

/**
 * Define the named task with TaskManager exactly once. `defineTask` must run at
 * module scope on the native side, but is guarded here against double-definition
 * (a hot reload or a second register call would otherwise redefine it).
 */
function ensureTaskDefined(api: BackgroundFetchApi): void {
  if (api.isTaskDefined(BACKGROUND_REFRESH_TASK)) {
    return;
  }
  api.defineTask(BACKGROUND_REFRESH_TASK, () => runBackgroundRefresh());
}

/**
 * Register the background-refresh task (best-effort, plan §9). Guards against
 * double-registration (defines the task only once) and SWALLOWS any registration
 * failure — the OS/platform may decline (background disabled, restricted, web),
 * and the app must keep working with foreground-only rescheduling. Never throws.
 *
 * @param overrides optional dependency overrides (tests inject fixtures here)
 * @returns true if registration succeeded, false if it was declined/failed.
 */
export async function registerBackgroundRefresh(
  overrides: Partial<BackgroundFetchApi> = {},
): Promise<boolean> {
  const api: BackgroundFetchApi = { ...defaultApi, ...overrides };
  try {
    ensureTaskDefined(api);
    await api.registerTaskAsync(BACKGROUND_REFRESH_TASK, {
      // ~15 min is the smallest interval iOS honors; Android default is 10 min.
      minimumInterval: 15 * 60,
      stopOnTerminate: false,
      startOnBoot: true,
    });
    return true;
  } catch {
    // Best-effort: a declined/failed registration is non-fatal (plan §9).
    return false;
  }
}

/**
 * Unregister the background-refresh task. Best-effort: a failure (e.g. the task
 * was never registered) is swallowed. Never throws.
 *
 * @param overrides optional dependency overrides (tests inject fixtures here)
 */
export async function unregisterBackgroundRefresh(
  overrides: Partial<BackgroundFetchApi> = {},
): Promise<void> {
  const api: BackgroundFetchApi = { ...defaultApi, ...overrides };
  try {
    await api.unregisterTaskAsync(BACKGROUND_REFRESH_TASK);
  } catch {
    // Non-fatal — unregistering an absent task is acceptable.
  }
}
