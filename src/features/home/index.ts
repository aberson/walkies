// src/features/home — the verdict screen (Step 5).
// The src/app/index.tsx route renders HomeScreen; useHomeVerdict orchestrates
// location → data → the PURE domain engine → the view-model.

export { default as HomeScreen } from './HomeScreen';
export type { HomeScreenProps } from './HomeScreen';
export { useHomeVerdict, loadHomeVerdict } from './useHomeVerdict';
export type { HomeDeps, HomeStatus, HomeViewModel } from './useHomeVerdict';
