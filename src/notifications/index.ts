// src/notifications — on-device local notification scheduling (plan §6).
//   schedule.ts        — pure payload builder + idempotent reschedule + opt-in
//   backgroundTask.ts  — best-effort expo-background-fetch refetch + reschedule

export {
  SCHEDULE_HORIZON_MS,
  MAX_PENDING_NOTIFICATIONS,
  buildNotifications,
  reschedule,
  requestNotificationPermission,
  setNotificationsEnabled,
} from './schedule';
export type {
  NotificationDescriptor,
  BuildNotificationsInput,
  NotificationsApi,
  RescheduleDeps,
  PermissionResult,
  SetNotificationsEnabledDeps,
} from './schedule';

export {
  BACKGROUND_REFRESH_TASK,
  runBackgroundRefresh,
  registerBackgroundRefresh,
  unregisterBackgroundRefresh,
} from './backgroundTask';
export type { BackgroundFetchApi } from './backgroundTask';
