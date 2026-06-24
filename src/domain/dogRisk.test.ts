import { dogRisk, HEAT_OFFSET_F_PER_POINT, MAX_RISK_POINTS } from './dogRisk';
import type { DogProfile } from './types';

function profile(overrides: Partial<DogProfile> = {}): DogProfile {
  return {
    name: 'Test',
    breed: 'Mixed breed',
    brachycephalic: false,
    ageMonths: 36,
    size: 'medium',
    bodyCondition: 'ideal',
    coat: 'short',
    darkCoat: false,
    conditions: ['none'],
    schemaVersion: 1,
    ...overrides,
  };
}

describe('dogRisk', () => {
  it('a healthy adult mixed-breed scores 0 and is not vulnerable', () => {
    const r = dogRisk(profile());
    expect(r.score).toBe(0);
    expect(r.heatOffsetF).toBe(0);
    expect(r.respiratorySensitive).toBe(false);
  });

  it('sums additive weights (brachy senior with cardiac condition)', () => {
    // brachy(3) + senior(2) + cardiac(3) = 8
    const r = dogRisk(
      profile({
        breed: 'French Bulldog',
        brachycephalic: true,
        ageMonths: 120,
        conditions: ['cardiac'],
      }),
    );
    expect(r.score).toBe(8);
    expect(r.heatOffsetF).toBe(8 * HEAT_OFFSET_F_PER_POINT); // 12°F
    expect(r.respiratorySensitive).toBe(true);
  });

  it('caps the heat offset at MAX_RISK_POINTS * per-point (12°F)', () => {
    // brachy(3)+senior(2)+respiratory(3)+obese(2)+double(2)+giant(1)+dark(0.5)
    // = 13.5 points, well over the cap.
    const r = dogRisk(
      profile({
        brachycephalic: true,
        ageMonths: 132,
        conditions: ['respiratory'],
        bodyCondition: 'obese',
        coat: 'double_thick',
        size: 'giant',
        darkCoat: true,
      }),
    );
    expect(r.score).toBeGreaterThan(MAX_RISK_POINTS);
    expect(r.heatOffsetF).toBe(MAX_RISK_POINTS * HEAT_OFFSET_F_PER_POINT); // 12
  });

  it('puppy (<6mo) counts the same as senior for the age term', () => {
    const r = dogRisk(profile({ ageMonths: 3 }));
    expect(r.score).toBe(2);
  });

  it('respiratorySensitive is true for brachy OR respiratory/cardiac', () => {
    expect(
      dogRisk(profile({ brachycephalic: true })).respiratorySensitive,
    ).toBe(true);
    expect(
      dogRisk(profile({ conditions: ['respiratory'] })).respiratorySensitive,
    ).toBe(true);
    expect(
      dogRisk(profile({ conditions: ['cardiac'] })).respiratorySensitive,
    ).toBe(true);
    // laryngeal/tracheal raise the score but are NOT the respiratory flag.
    expect(
      dogRisk(profile({ conditions: ['laryngeal_paralysis'] }))
        .respiratorySensitive,
    ).toBe(false);
  });

  it('overweight (+1) is distinct from obese (+2)', () => {
    expect(dogRisk(profile({ bodyCondition: 'overweight' })).score).toBe(1);
    expect(dogRisk(profile({ bodyCondition: 'obese' })).score).toBe(2);
  });

  it('giant (+1) outweighs large (+0.5)', () => {
    expect(dogRisk(profile({ size: 'large' })).score).toBe(0.5);
    expect(dogRisk(profile({ size: 'giant' })).score).toBe(1);
  });
});
