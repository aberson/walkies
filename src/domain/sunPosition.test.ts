import { solarElevationDeg, sunFactor } from './sunPosition';

// Reference location: roughly Wichita, KS (37.7°N, 97.3°W) on the summer
// solstice. Solar noon there is ~12:40 local (CDT = UTC-5), i.e. ~17:40 UTC.
const LAT = 37.7;
const LON = -97.3;

describe('solarElevationDeg', () => {
  it('is high near local solar noon on the summer solstice', () => {
    // ~17:40 UTC is near solar noon. Max elevation ≈ 90 - |lat - decl| =
    // 90 - (37.7 - 23.4) ≈ 75.7°.
    const noon = new Date(Date.UTC(2025, 5, 21, 17, 40, 0));
    const elev = solarElevationDeg(LAT, LON, noon);
    expect(elev).toBeGreaterThan(70);
    expect(elev).toBeLessThan(80);
  });

  it('is below the horizon (negative) at local midnight', () => {
    // ~05:40 UTC ≈ 00:40 local CDT.
    const midnight = new Date(Date.UTC(2025, 5, 21, 5, 40, 0));
    const elev = solarElevationDeg(LAT, LON, midnight);
    expect(elev).toBeLessThan(0);
  });

  it('is deterministic for identical inputs', () => {
    const d = new Date(Date.UTC(2025, 5, 21, 17, 40, 0));
    expect(solarElevationDeg(LAT, LON, d)).toBe(solarElevationDeg(LAT, LON, d));
  });
});

describe('sunFactor', () => {
  it('is 0 at night (sun below the horizon)', () => {
    const midnight = new Date(Date.UTC(2025, 5, 21, 5, 40, 0));
    expect(sunFactor(LAT, LON, midnight)).toBe(0);
  });

  it('is high (near 1) near solar noon at the solstice', () => {
    const noon = new Date(Date.UTC(2025, 5, 21, 17, 40, 0));
    const f = sunFactor(LAT, LON, noon);
    expect(f).toBeGreaterThan(0.9);
    expect(f).toBeLessThanOrEqual(1);
  });

  it('is always within [0, 1]', () => {
    for (let h = 0; h < 24; h++) {
      const d = new Date(Date.UTC(2025, 5, 21, h, 0, 0));
      const f = sunFactor(LAT, LON, d);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('returns a FINITE 0 for an Invalid Date (no NaN propagation)', () => {
    const f = sunFactor(LAT, LON, new Date('bad'));
    expect(Number.isFinite(f)).toBe(true);
    expect(f).toBe(0);
  });
});
