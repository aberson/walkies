// src/features/profile/breeds.ts — typed access to the breed seed JSON
// (assets/breeds.json, plan Appendix A). Selecting a breed auto-fills
// brachycephalic / coat / size; the "Custom" sentinel means the user sets the
// characteristic toggles directly.

import type { Coat, Size } from '../../domain/types';

import breedsJson from '../../../assets/breeds.json';

/** Characteristics a breed selection auto-fills (each user-overridable). */
export interface BreedSeed {
  name: string;
  brachycephalic: boolean;
  coat: Coat;
  size: Size;
}

/** Sentinel breed name: user sets the characteristic toggles directly. */
export const CUSTOM_BREED = 'Custom';

/** The ordered seed list (picker options). */
export const BREED_SEEDS: readonly BreedSeed[] = breedsJson.breeds as BreedSeed[];

/** Just the breed names, in picker order. */
export const BREED_NAMES: readonly string[] = BREED_SEEDS.map((b) => b.name);

/**
 * Look up the seed characteristics for a breed name, or `undefined` if the name
 * is not in the seed list. `CUSTOM_BREED` returns its (neutral) seed row, but
 * callers should treat Custom as "leave the user's toggles untouched".
 */
export function breedSeed(name: string): BreedSeed | undefined {
  return BREED_SEEDS.find((b) => b.name === name);
}
