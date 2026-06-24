import { computeVerdict } from './verdict';
import type { VerdictInput } from './verdict';
import type { AirQuality, Alert, DogProfile, WeatherSnapshot } from './types';

// ---- builders --------------------------------------------------------------

function dog(overrides: Partial<DogProfile> = {}): DogProfile {
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

function weather(overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot {
  return {
    startTime: '2025-06-21T12:00:00-05:00',
    airTempF: 70,
    relativeHumidity: 40,
    windSpeedMph: 5,
    skyCoverPct: 0,
    precipProbability: 0,
    isDaytime: true,
    ...overrides,
  };
}

const noAqi: AirQuality = { usAqi: null };

function input(overrides: Partial<VerdictInput> = {}): VerdictInput {
  return {
    weather: weather(),
    airQuality: noAqi,
    alerts: [],
    profile: dog(),
    sunFactor: 0, // night/shade by default so pavement = air temp unless set
    ...overrides,
  };
}

const HEALTHY = dog();
const BRACHY_SENIOR = dog({
  name: 'Pierre',
  breed: 'French Bulldog',
  brachycephalic: true,
  ageMonths: 120, // 10 years
});

/**
 * Find the lowest air temperature (°F) at which this dog reaches `red` for the
 * heat signal, holding everything else fixed (no sun, no AQI, no alerts, dry
 * enough that the backstop doesn't fire). Returns null if never red in range.
 */
function redHeatThreshold(profile: DogProfile): number | null {
  for (let t = 60; t <= 130; t += 0.5) {
    const v = computeVerdict(
      input({
        profile,
        weather: weather({ airTempF: t, relativeHumidity: 30 }),
        sunFactor: 0, // remove pavement from the picture
      }),
    );
    if (v.level === 'red' && v.bindingSignal === 'heat') {
      return t;
    }
  }
  return null;
}

// ---- tests -----------------------------------------------------------------

describe('computeVerdict — vulnerability ordering (done-when #3)', () => {
  it('a brachy senior reaches red at a STRICTLY LOWER air temp than a healthy adult', () => {
    const brachy = redHeatThreshold(BRACHY_SENIOR);
    const healthy = redHeatThreshold(HEALTHY);

    expect(brachy).not.toBeNull();
    expect(healthy).not.toBeNull();
    // The whole point of the app: vulnerable dogs are restricted sooner.
    expect(brachy as number).toBeLessThan(healthy as number);
  });
});

describe('computeVerdict — most restrictive signal wins (done-when #4)', () => {
  it('comfortable temp but AQI 175 → red (AQI dominates)', () => {
    const v = computeVerdict(
      input({
        weather: weather({ airTempF: 70, relativeHumidity: 40 }),
        airQuality: { usAqi: 175 },
        profile: HEALTHY,
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('red');
    expect(v.bindingSignal).toBe('airQuality');
  });

  it('comfortable everything → green', () => {
    const v = computeVerdict(
      input({
        weather: weather({ airTempF: 65, relativeHumidity: 40 }),
        airQuality: { usAqi: 30 },
        profile: HEALTHY,
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('green');
    expect(v.bindingSignal).toBe('none');
    expect(v.recommendedMaxMinutes).toBe(45);
  });
});

describe('computeVerdict — air quality signal', () => {
  it('AQI 120 is yellow for a healthy dog', () => {
    const v = computeVerdict(
      input({ airQuality: { usAqi: 120 }, profile: HEALTHY, sunFactor: 0 }),
    );
    expect(v.level).toBe('yellow');
  });

  it('AQI 120 is RED for a respiratory-sensitive dog', () => {
    const v = computeVerdict(
      input({
        airQuality: { usAqi: 120 },
        profile: BRACHY_SENIOR,
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('red');
    expect(v.bindingSignal).toBe('airQuality');
  });

  it('null AQI drops the signal entirely (no block)', () => {
    const v = computeVerdict(
      input({
        airQuality: { usAqi: null },
        weather: weather({ airTempF: 65 }),
        profile: HEALTHY,
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('green');
  });

  it('undefined AQI (data-layer omission) also drops the signal — no green-with-undefined slip', () => {
    const v = computeVerdict(
      input({
        // A realistic mapping omission: usAqi never set.
        airQuality: { usAqi: undefined } as unknown as AirQuality,
        weather: weather({ airTempF: 65 }),
        profile: HEALTHY,
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('green');
    expect(v.bindingSignal).toBe('none');
  });

  describe('band boundaries (engine uses > AQI_RED strict, >= AQI_YELLOW)', () => {
    it('AQI exactly 100 is yellow for a healthy dog', () => {
      const v = computeVerdict(
        input({ airQuality: { usAqi: 100 }, profile: HEALTHY, sunFactor: 0 }),
      );
      expect(v.level).toBe('yellow');
      expect(v.bindingSignal).toBe('airQuality');
    });

    it('AQI exactly 150 is yellow for a healthy dog (boundary is strict for red)', () => {
      const v = computeVerdict(
        input({ airQuality: { usAqi: 150 }, profile: HEALTHY, sunFactor: 0 }),
      );
      expect(v.level).toBe('yellow');
      expect(v.bindingSignal).toBe('airQuality');
    });

    it('AQI 151 crosses into red', () => {
      const v = computeVerdict(
        input({ airQuality: { usAqi: 151 }, profile: HEALTHY, sunFactor: 0 }),
      );
      expect(v.level).toBe('red');
      expect(v.bindingSignal).toBe('airQuality');
    });
  });
});

describe('computeVerdict — pavement signal', () => {
  it('full-sun asphalt at 90°F air pushes pavement into red', () => {
    const v = computeVerdict(
      input({
        weather: weather({ airTempF: 90, relativeHumidity: 20 }),
        sunFactor: 1,
        profile: HEALTHY,
      }),
    );
    // 90 + 50 = 140°F pavement → red.
    expect(v.pavementTempF).toBeGreaterThanOrEqual(125);
    expect(v.level).toBe('red');
  });

  it('always includes the 7-second-test note', () => {
    const v = computeVerdict(input({ sunFactor: 0, profile: HEALTHY }));
    expect(v.reasons.some((r) => /7-second test/i.test(r))).toBe(true);
  });

  it('pavement landing exactly at the 115°F yellow threshold is yellow', () => {
    // 65°F air + full sun + clear sky on asphalt = 65 + 50*1*1*1 = 115°F,
    // exactly the PAVEMENT_YELLOW_F boundary (>= is yellow, < PAVEMENT_RED_F).
    const v = computeVerdict(
      input({
        weather: weather({
          airTempF: 65,
          relativeHumidity: 20,
          skyCoverPct: 0,
        }),
        sunFactor: 1,
        profile: HEALTHY,
      }),
    );
    expect(v.pavementTempF).toBeCloseTo(115, 5);
    expect(v.level).toBe('yellow');
    expect(v.bindingSignal).toBe('pavement');
  });
});

describe('computeVerdict — cold signal', () => {
  it('25°F is yellow for a small/short-coat dog, green for a husky', () => {
    const small = computeVerdict(
      input({
        weather: weather({ airTempF: 25, relativeHumidity: 50 }),
        profile: dog({ size: 'small', coat: 'short' }),
        sunFactor: 0,
      }),
    );
    expect(small.level).toBe('yellow');
    expect(small.bindingSignal).toBe('cold');

    const husky = computeVerdict(
      input({
        weather: weather({ airTempF: 25, relativeHumidity: 50 }),
        profile: dog({ size: 'large', coat: 'double_thick' }),
        sunFactor: 0,
      }),
    );
    expect(husky.level).toBe('green');
  });

  it('below 20°F is red for a small short-coat dog', () => {
    const v = computeVerdict(
      input({
        weather: weather({ airTempF: 10, relativeHumidity: 50 }),
        profile: dog({ size: 'small', coat: 'short' }),
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('red');
    expect(v.bindingSignal).toBe('cold');
  });

  it('an active Extreme Cold Warning makes a small dog red even above 20°F', () => {
    const alert: Alert = {
      event: 'Extreme Cold Warning',
      severity: 'Severe',
      onset: null,
      ends: null,
      headline: 'Extreme Cold Warning in effect',
    };
    const v = computeVerdict(
      input({
        weather: weather({ airTempF: 28, relativeHumidity: 50 }),
        alerts: [alert],
        profile: dog({ size: 'small', coat: 'short' }),
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('red');
  });
});

describe('computeVerdict — alert signal', () => {
  it('a thunderstorm alert forces red', () => {
    const alert: Alert = {
      event: 'Severe Thunderstorm Warning',
      severity: 'Severe',
      onset: null,
      ends: null,
      headline: 'Severe Thunderstorm Warning',
    };
    const v = computeVerdict(
      input({
        weather: weather({ airTempF: 68, relativeHumidity: 40 }),
        alerts: [alert],
        profile: HEALTHY,
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('red');
    expect(v.bindingSignal).toBe('alert');
  });

  it('a Heat Advisory is yellow', () => {
    const alert: Alert = {
      event: 'Heat Advisory',
      severity: 'Moderate',
      onset: null,
      ends: null,
      headline: 'Heat Advisory',
    };
    const v = computeVerdict(
      input({
        weather: weather({ airTempF: 72, relativeHumidity: 40 }),
        alerts: [alert],
        profile: HEALTHY,
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('yellow');
    expect(v.bindingSignal).toBe('alert');
  });

  it('an Extreme Heat Warning is red', () => {
    const alert: Alert = {
      event: 'Extreme Heat Warning',
      severity: 'Extreme',
      onset: null,
      ends: null,
      headline: 'Extreme Heat Warning',
    };
    const v = computeVerdict(
      input({
        weather: weather({ airTempF: 78, relativeHumidity: 30 }),
        alerts: [alert],
        profile: HEALTHY,
        sunFactor: 0,
      }),
    );
    expect(v.level).toBe('red');
  });

  it('a bare "Air Quality Alert" (relevant domain, neither warning nor advisory) still escalates to at least yellow', () => {
    // Appendix B lists "Air Quality Alert" as a relevant event. It matches the
    // relevant-domain regex via "air" but is neither a Warning nor an
    // Advisory/Watch — it must NOT be silently dropped. Worst case is null AQI
    // (no air signal at all), so this alert is the only air hazard signal.
    const alert: Alert = {
      event: 'Air Quality Alert',
      severity: 'Unknown',
      onset: null,
      ends: null,
      headline: 'Air Quality Alert in effect',
    };
    const v = computeVerdict(
      input({
        weather: weather({ airTempF: 70, relativeHumidity: 40 }),
        airQuality: noAqi,
        alerts: [alert],
        profile: HEALTHY,
        sunFactor: 0,
      }),
    );
    expect(['yellow', 'red']).toContain(v.level);
    expect(v.bindingSignal).toBe('alert');
  });
});

describe('computeVerdict — output shape', () => {
  it('always returns a finite pavementTempF, a level, reasons, and minutes', () => {
    const v = computeVerdict(input({ profile: HEALTHY }));
    expect(['green', 'yellow', 'red']).toContain(v.level);
    expect(Number.isFinite(v.pavementTempF)).toBe(true);
    expect(v.reasons.length).toBeGreaterThan(0);
    expect([0, 12, 45]).toContain(v.recommendedMaxMinutes);
  });
});

describe('computeVerdict — purity (autonomous-loop safety)', () => {
  it('does not throw or mutate a deep-frozen input', () => {
    const alert: Alert = {
      event: 'Heat Advisory',
      severity: 'Moderate',
      onset: null,
      ends: null,
      headline: 'Heat Advisory',
    };
    const frozenInput: VerdictInput = {
      weather: Object.freeze(
        weather({ airTempF: 88, relativeHumidity: 55 }),
      ) as WeatherSnapshot,
      airQuality: Object.freeze({ usAqi: 120 }) as AirQuality,
      alerts: Object.freeze([Object.freeze(alert)]) as unknown as Alert[],
      profile: Object.freeze(BRACHY_SENIOR) as DogProfile,
      sunFactor: 0.8,
    };
    Object.freeze(frozenInput);

    // A deep clone captured BEFORE the call — used to prove nothing changed.
    const before = structuredClone({
      weather: frozenInput.weather,
      airQuality: frozenInput.airQuality,
      alerts: frozenInput.alerts,
      profile: frozenInput.profile,
      sunFactor: frozenInput.sunFactor,
    });

    expect(() => computeVerdict(frozenInput)).not.toThrow();

    expect(frozenInput.weather).toEqual(before.weather);
    expect(frozenInput.airQuality).toEqual(before.airQuality);
    expect(frozenInput.alerts).toEqual(before.alerts);
    expect(frozenInput.profile).toEqual(before.profile);
    expect(frozenInput.sunFactor).toBe(before.sunFactor);
  });
});
