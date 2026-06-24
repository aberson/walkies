// src/domain/dogRisk.ts — DogProfile → vulnerability score + heat offset
// (Appendix D). PURE. ONE source of truth for the weights table.

import type { DogProfile } from './types';

/** Age thresholds (months). senior >= 84 (7 yr); puppy < 6. */
export const SENIOR_AGE_MONTHS = 84;
export const PUPPY_AGE_MONTHS = 6;

/** Points cap and the °F-per-point conversion for the heat offset. */
export const MAX_RISK_POINTS = 8;
export const HEAT_OFFSET_F_PER_POINT = 1.5;

/**
 * ONE source of truth for the additive vulnerability weights (Appendix D).
 * Every weight lives here; no other file hard-codes these numbers.
 */
export const RISK_WEIGHTS = {
  brachycephalic: 3,
  seniorOrPuppy: 2,
  /** any of respiratory / cardiac / laryngeal_paralysis / tracheal_collapse */
  riskCondition: 3,
  obese: 2,
  overweight: 1,
  doubleThickCoat: 2,
  giant: 1,
  large: 0.5,
  darkCoat: 0.5,
} as const;

/** Conditions that count toward the +3 "risk condition" points. */
const RISK_CONDITIONS: ReadonlySet<DogProfile['conditions'][number]> = new Set([
  'respiratory',
  'cardiac',
  'laryngeal_paralysis',
  'tracheal_collapse',
]);

export interface DogRisk {
  /** Raw additive vulnerability score (uncapped). */
  score: number;
  /** °F the heat bands shift down: min(score, 8) * 1.5 (≤ 12°F). */
  heatOffsetF: number;
  /** True if brachycephalic OR has a respiratory/cardiac condition. */
  respiratorySensitive: boolean;
}

function hasRiskCondition(profile: DogProfile): boolean {
  return profile.conditions.some((c) => RISK_CONDITIONS.has(c));
}

/**
 * Compute the dog's vulnerability score, the derived heat-band offset (°F), and
 * the respiratory-sensitivity flag (Appendix D).
 *
 * @param profile the dog profile
 * @returns score, heatOffsetF, respiratorySensitive
 */
export function dogRisk(profile: DogProfile): DogRisk {
  let score = 0;

  if (profile.brachycephalic) {
    score += RISK_WEIGHTS.brachycephalic;
  }
  if (
    profile.ageMonths >= SENIOR_AGE_MONTHS ||
    profile.ageMonths < PUPPY_AGE_MONTHS
  ) {
    score += RISK_WEIGHTS.seniorOrPuppy;
  }
  if (hasRiskCondition(profile)) {
    score += RISK_WEIGHTS.riskCondition;
  }
  if (profile.bodyCondition === 'obese') {
    score += RISK_WEIGHTS.obese;
  } else if (profile.bodyCondition === 'overweight') {
    score += RISK_WEIGHTS.overweight;
  }
  if (profile.coat === 'double_thick') {
    score += RISK_WEIGHTS.doubleThickCoat;
  }
  if (profile.size === 'giant') {
    score += RISK_WEIGHTS.giant;
  } else if (profile.size === 'large') {
    score += RISK_WEIGHTS.large;
  }
  if (profile.darkCoat) {
    score += RISK_WEIGHTS.darkCoat;
  }

  const heatOffsetF =
    Math.min(score, MAX_RISK_POINTS) * HEAT_OFFSET_F_PER_POINT;

  const respiratorySensitive =
    profile.brachycephalic ||
    profile.conditions.includes('respiratory') ||
    profile.conditions.includes('cardiac');

  return { score, heatOffsetF, respiratorySensitive };
}
