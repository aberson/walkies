// src/ui/format.test.ts — DISPLAY-only units formatting (Step 7).
// Pure functions, no RN / storage needed. Conversion math is the single source
// of truth, so these tests pin both the math and the rounding/format.

import { fToC, milesToKm, formatTemperature, formatDistance } from './format';

describe('fToC — the single °F→°C conversion', () => {
  it('converts the freezing/boiling anchors exactly', () => {
    expect(fToC(32)).toBeCloseTo(0, 10);
    expect(fToC(212)).toBeCloseTo(100, 10);
  });

  it('converts a hot-pavement reading (125°F ≈ 51.67°C)', () => {
    expect(fToC(125)).toBeCloseTo(51.666, 2);
  });
});

describe('milesToKm — the single mi→km conversion', () => {
  it('converts 1 mile to ~1.609 km', () => {
    expect(milesToKm(1)).toBeCloseTo(1.609344, 6);
  });
});

describe('formatTemperature', () => {
  it('formats °F unchanged and whole-rounded', () => {
    expect(formatTemperature(125, 'F')).toBe('125°F');
    expect(formatTemperature(78.4, 'F')).toBe('78°F');
  });

  it('converts to °C and rounds (125°F → "52°C") (done-when)', () => {
    // 125°F = 51.67°C → rounds to 52.
    expect(formatTemperature(125, 'C')).toBe('52°C');
  });

  it('converts the boiling anchor (212°F → "100°C")', () => {
    expect(formatTemperature(212, 'C')).toBe('100°C');
  });

  it('renders the em-dash placeholder (never "NaN") for non-finite input', () => {
    expect(formatTemperature(NaN, 'F')).toBe('—');
    expect(formatTemperature(Infinity, 'C')).toBe('—');
  });
});

describe('formatDistance', () => {
  it('formats miles unchanged, dropping a trailing .0', () => {
    expect(formatDistance(1, 'mi')).toBe('1 mi');
    expect(formatDistance(1.25, 'mi')).toBe('1.3 mi');
  });

  it('converts to km with one decimal (1 mi → "1.6 km")', () => {
    expect(formatDistance(1, 'km')).toBe('1.6 km');
  });

  it('renders the em-dash placeholder for non-finite input', () => {
    expect(formatDistance(NaN, 'mi')).toBe('—');
  });
});
