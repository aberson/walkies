import {
  ASPHALT_FULL_SUN_DELTA,
  CLOUD_ATTENUATION,
  pavementTempF,
  SURFACE_FACTOR,
} from './pavement';

describe('pavementTempF', () => {
  it('calibrates to ~125°F for 77°F air in full clear-noon sun on asphalt (±5°F)', () => {
    // Berens (1970) full-sun calibration target: 77°F air → ~125°F asphalt.
    // Assert ONLY the genuine calibration goal (within ±5°F of 125°F); don't
    // re-assert the model's exact arithmetic (that would be tautological).
    const t = pavementTempF(77, 1, 0, 'asphalt');
    expect(Math.abs(t - 125)).toBeLessThanOrEqual(5);
  });

  it('shaded grass is much cooler than full-sun asphalt at the same air temp', () => {
    const asphalt = pavementTempF(77, 1, 0, 'asphalt');
    // Shade → sunFactor 0; grass also has a low surface factor.
    const shadedGrass = pavementTempF(77, 0, 100, 'grass');
    expect(shadedGrass).toBeLessThan(asphalt);
    // With no sun, the surface is essentially air temperature.
    expect(shadedGrass).toBeCloseTo(77, 1);
  });

  it('overcast lowers the surface temperature vs clear sky', () => {
    const clear = pavementTempF(85, 1, 0, 'asphalt');
    const overcast = pavementTempF(85, 1, 100, 'asphalt');
    expect(overcast).toBeLessThan(clear);
    // 100% sky cover → cloudFactor = 1 - CLOUD_ATTENUATION, so the gain is
    // that fraction of the full-sun delta. Derive from the constants so the
    // test can't drift when they are retuned.
    const expectedGain = ASPHALT_FULL_SUN_DELTA * (1 - CLOUD_ATTENUATION);
    expect(overcast).toBeCloseTo(85 + expectedGain, 5);
  });

  it('concrete sits between grass and asphalt', () => {
    const air = 90;
    const grass = pavementTempF(air, 1, 0, 'grass');
    const concrete = pavementTempF(air, 1, 0, 'concrete');
    const asphalt = pavementTempF(air, 1, 0, 'asphalt');
    expect(grass).toBeLessThan(concrete);
    expect(concrete).toBeLessThan(asphalt);
  });

  it('surface factors are the single source of truth', () => {
    expect(SURFACE_FACTOR.asphalt).toBe(1.0);
    expect(SURFACE_FACTOR.concrete).toBe(0.55);
    expect(SURFACE_FACTOR.grass).toBe(0.1);
  });

  it('at night (sunFactor 0) every surface equals air temperature', () => {
    expect(pavementTempF(60, 0, 0, 'asphalt')).toBe(60);
    expect(pavementTempF(60, 0, 50, 'concrete')).toBe(60);
  });
});
