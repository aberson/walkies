// src/storage — parse-guarded, versioned AsyncStorage persistence.
// profile.ts (load/save DogProfile) and settings.ts (load/save Settings).

export { PROFILE_KEY, loadProfile, saveProfile } from './profile';
export {
  SETTINGS_KEY,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
} from './settings';
