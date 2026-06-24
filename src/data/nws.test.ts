// src/data/nws.test.ts — NWS client tests against hand-crafted fixtures faithful
// to Appendix B. NO REAL NETWORK: global.fetch is mocked per test.

import pointsFixture from './__fixtures__/nws-points.json';
import hourlyFixture from './__fixtures__/nws-hourly.json';
import gridpointFixture from './__fixtures__/nws-gridpoint.json';
import alertsFixture from './__fixtures__/nws-alerts.json';
import alertsEmptyFixture from './__fixtures__/nws-alerts-empty.json';

import {
  NWS_USER_AGENT,
  fetchAlerts,
  fetchForecast,
  fetchHourly,
  fetchPoints,
  parseValidTimeInterval,
  parseWindSpeedMph,
  periodTempF,
  skyCoverAt,
  toAlert,
  toWeatherSnapshot,
} from './nws';

/** Build a Response-like object for a JSON fixture. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A fetch mock that routes by URL substring to the right fixture. */
function routedFetch(): jest.Mock {
  return jest.fn(async (url: string) => {
    if (url.includes('/points/')) return jsonResponse(pointsFixture);
    if (url.includes('/forecast/hourly')) return jsonResponse(hourlyFixture);
    if (url.includes('/alerts/active')) return jsonResponse(alertsFixture);
    // The bare gridpoint URL (skyCover) — must be checked AFTER /forecast/hourly.
    if (url.includes('/gridpoints/')) return jsonResponse(gridpointFixture);
    throw new Error(`unexpected url ${url}`);
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('parseWindSpeedMph', () => {
  it('extracts the first integer from "5 mph"', () => {
    expect(parseWindSpeedMph('5 mph')).toBe(5);
  });
  it('extracts the first integer from a range "5 to 10 mph"', () => {
    expect(parseWindSpeedMph('5 to 10 mph')).toBe(5);
  });
  it('extracts the first integer from "10 to 15 mph"', () => {
    expect(parseWindSpeedMph('10 to 15 mph')).toBe(10);
  });
  it('returns 0 for an empty / undefined string', () => {
    expect(parseWindSpeedMph('')).toBe(0);
    expect(parseWindSpeedMph(undefined)).toBe(0);
  });
  it('returns 0 for "Light and variable" (no integer present)', () => {
    expect(parseWindSpeedMph('Light and variable')).toBe(0);
  });
});

describe('parseValidTimeInterval', () => {
  it('parses an instant + PT1H duration', () => {
    const r = parseValidTimeInterval('2025-06-21T17:00:00+00:00/PT1H');
    expect(r).not.toBeNull();
    expect(r!.endMs - r!.startMs).toBe(60 * 60 * 1000);
  });
  it('parses a multi-part P1DT6H duration', () => {
    const r = parseValidTimeInterval('2025-06-21T00:00:00+00:00/P1DT6H');
    expect(r!.endMs - r!.startMs).toBe(30 * 60 * 60 * 1000);
  });
  it('returns null with no slash', () => {
    expect(parseValidTimeInterval('2025-06-21T00:00:00+00:00')).toBeNull();
  });
});

describe('periodTempF', () => {
  it('passes a Fahrenheit period through unchanged', () => {
    expect(periodTempF({ temperature: 88, temperatureUnit: 'F' })).toBe(88);
  });
  it('treats an absent temperatureUnit as Fahrenheit (NWS default)', () => {
    expect(periodTempF({ temperature: 72 })).toBe(72);
  });
  it('converts a Celsius period to Fahrenheit (30C -> 86F)', () => {
    expect(periodTempF({ temperature: 30, temperatureUnit: 'C' })).toBeCloseTo(
      86,
      1,
    );
    // lowercase unit honored too.
    expect(periodTempF({ temperature: 0, temperatureUnit: 'c' })).toBeCloseTo(
      32,
      1,
    );
  });
  it('returns null for a missing / non-finite temperature', () => {
    expect(periodTempF({})).toBeNull();
    expect(periodTempF({ temperature: Number.NaN })).toBeNull();
  });
});

describe('skyCoverAt', () => {
  const values = gridpointFixture.properties.skyCover.values;
  it('returns the value of the interval containing the instant', () => {
    // 17:30Z falls in [17:00Z, 18:00Z) -> 20.
    expect(skyCoverAt(values, Date.parse('2025-06-21T17:30:00Z'))).toBe(20);
    // 19:00Z falls in [18:00Z, 20:00Z) -> 40.
    expect(skyCoverAt(values, Date.parse('2025-06-21T19:00:00Z'))).toBe(40);
  });
  it('defaults to 0 when no interval matches', () => {
    expect(skyCoverAt(values, Date.parse('2030-01-01T00:00:00Z'))).toBe(0);
  });
  it('defaults a matched interval with value:null to 0', () => {
    const nullValues = [
      { validTime: '2025-06-21T17:00:00+00:00/PT1H', value: null },
    ];
    expect(skyCoverAt(nullValues, Date.parse('2025-06-21T17:30:00Z'))).toBe(0);
  });
});

describe('toWeatherSnapshot', () => {
  const periods = hourlyFixture.properties.periods;
  const skyValues = gridpointFixture.properties.skyCover.values;

  it('maps temp / humidity / wind / precip / isDaytime', () => {
    const s = toWeatherSnapshot(periods[0], skyValues);
    expect(s).not.toBeNull();
    expect(s!.airTempF).toBe(88);
    expect(s!.relativeHumidity).toBe(55);
    expect(s!.windSpeedMph).toBe(5);
    expect(s!.precipProbability).toBe(10);
    expect(s!.isDaytime).toBe(true);
    expect(s!.startTime).toBe('2025-06-21T12:00:00-05:00');
  });

  it('honors temperatureUnit:"C" -> airTempF in Fahrenheit (30C -> 86F)', () => {
    const celsius = { ...periods[0], temperature: 30, temperatureUnit: 'C' };
    const s = toWeatherSnapshot(celsius, skyValues);
    expect(s).not.toBeNull();
    expect(s!.airTempF).toBeCloseTo(86, 1);
  });

  it('returns null for a period with no finite temperature', () => {
    const templess = { ...periods[0], temperature: undefined };
    expect(toWeatherSnapshot(templess, skyValues)).toBeNull();
  });

  it('merges skyCover by matching startTime to the validTime interval', () => {
    // Period 0 start 12:00-05:00 = 17:00Z -> interval [17:00Z,18:00Z) -> 20.
    expect(toWeatherSnapshot(periods[0], skyValues)!.skyCoverPct).toBe(20);
    // Period 1 start 13:00-05:00 = 18:00Z -> interval [18:00Z,20:00Z) -> 40.
    expect(toWeatherSnapshot(periods[1], skyValues)!.skyCoverPct).toBe(40);
    // Period 2 start 23:00-05:00 = next-day 04:00Z -> [00:00Z,06:00Z) -> 75.
    expect(toWeatherSnapshot(periods[2], skyValues)!.skyCoverPct).toBe(75);
  });

  it('defaults null humidity/precip to 0 and parses range wind speed', () => {
    const s = toWeatherSnapshot(periods[2], skyValues);
    expect(s).not.toBeNull();
    expect(s!.relativeHumidity).toBe(0);
    expect(s!.precipProbability).toBe(0);
    expect(s!.windSpeedMph).toBe(10); // "10 to 15 mph"
    expect(s!.isDaytime).toBe(false);
  });

  it('defaults skyCover to 0 when no interval matches', () => {
    const orphan = { ...periods[0], startTime: '2030-01-01T00:00:00Z' };
    expect(toWeatherSnapshot(orphan, skyValues)!.skyCoverPct).toBe(0);
  });
});

describe('toAlert', () => {
  it('maps event / severity / headline / onset / ends', () => {
    const a = toAlert(alertsFixture.features[0]);
    expect(a.event).toBe('Heat Advisory');
    expect(a.severity).toBe('Moderate');
    expect(a.headline).toContain('Heat Advisory');
    expect(a.onset).toBe('2025-06-21T11:00:00-05:00');
    expect(a.ends).toBe('2025-06-21T20:00:00-05:00');
  });
});

describe('fetchPoints', () => {
  it('sends the required User-Agent header and returns the grid', async () => {
    const mock = routedFetch();
    global.fetch = mock as unknown as typeof fetch;

    const res = await fetchPoints(44.96, -93.27);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.gridId).toBe('MPX');
      expect(res.data.gridX).toBe(107);
      expect(res.data.gridY).toBe(71);
    }

    // Assert the User-Agent header was supplied on the request.
    const [, init] = mock.mock.calls[0];
    expect(init.headers['User-Agent']).toBe(NWS_USER_AGENT);
  });

  it('classifies HTTP 403 as recoverable "forbidden" (no throw)', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 403)) as unknown as typeof fetch;
    const res = await fetchPoints(44.96, -93.27);
    expect(res).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('classifies HTTP 404 (non-US coords) as "unsupported-location"', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;
    const res = await fetchPoints(51.5, -0.12); // London — non-US.
    expect(res).toEqual({ ok: false, reason: 'unsupported-location' });
  });
});

describe('fetchHourly', () => {
  it('returns WeatherSnapshot[] with skyCover merged', async () => {
    global.fetch = routedFetch() as unknown as typeof fetch;
    const res = await fetchHourly({
      gridId: 'MPX',
      gridX: 107,
      gridY: 71,
      forecastHourly: 'x',
      forecastGridData: 'y',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(3);
      expect(res.data[0].skyCoverPct).toBe(20);
      expect(res.data[1].windSpeedMph).toBe(5);
    }
  });

  it('still returns hourly with skyCover=0 when the skyCover fetch fails', async () => {
    const mock = jest.fn(async (url: string) => {
      if (url.includes('/forecast/hourly')) return jsonResponse(hourlyFixture);
      if (url.includes('/gridpoints/')) return jsonResponse({}, 500); // skyCover fails
      throw new Error('unexpected');
    });
    global.fetch = mock as unknown as typeof fetch;
    const res = await fetchHourly({
      gridId: 'MPX',
      gridX: 107,
      gridY: 71,
      forecastHourly: 'x',
      forecastGridData: 'y',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data[0].skyCoverPct).toBe(0);
    }
  });

  it('excludes a temp-less period instead of fabricating 0F', async () => {
    // One of three periods has no temperature → only 2 valid snapshots remain.
    const { temperature, ...templessPeriod } =
      hourlyFixture.properties.periods[0];
    void temperature;
    const mixed = {
      properties: {
        periods: [
          templessPeriod,
          hourlyFixture.properties.periods[1],
          hourlyFixture.properties.periods[2],
        ],
      },
    };
    const mock = jest.fn(async (url: string) => {
      if (url.includes('/forecast/hourly')) return jsonResponse(mixed);
      if (url.includes('/gridpoints/')) return jsonResponse(gridpointFixture);
      throw new Error('unexpected');
    });
    global.fetch = mock as unknown as typeof fetch;
    const res = await fetchHourly({
      gridId: 'MPX',
      gridX: 107,
      gridY: 71,
      forecastHourly: 'x',
      forecastGridData: 'y',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(2); // temp-less period dropped
      expect(res.data.every((s) => Number.isFinite(s.airTempF))).toBe(true);
    }
  });

  it('returns bad-response when EVERY period lacks a temperature', async () => {
    const allTempless = {
      properties: {
        periods: hourlyFixture.properties.periods.map((p) => {
          const { temperature, ...rest } = p;
          void temperature;
          return rest;
        }),
      },
    };
    const mock = jest.fn(async (url: string) => {
      if (url.includes('/forecast/hourly')) return jsonResponse(allTempless);
      if (url.includes('/gridpoints/')) return jsonResponse(gridpointFixture);
      throw new Error('unexpected');
    });
    global.fetch = mock as unknown as typeof fetch;
    const res = await fetchHourly({
      gridId: 'MPX',
      gridX: 107,
      gridY: 71,
      forecastHourly: 'x',
      forecastGridData: 'y',
    });
    expect(res).toEqual({ ok: false, reason: 'bad-response' });
  });

  it('classifies a 404 on the hourly endpoint as http-error, NOT unsupported-location', async () => {
    // Location was already validated at /points; a transient 404 on the grid
    // forecast must not be mis-reported as "US-only" (plan §9).
    const mock = jest.fn(async (url: string) => {
      if (url.includes('/forecast/hourly')) return jsonResponse({}, 404);
      if (url.includes('/gridpoints/')) return jsonResponse(gridpointFixture);
      throw new Error('unexpected');
    });
    global.fetch = mock as unknown as typeof fetch;
    const res = await fetchHourly({
      gridId: 'MPX',
      gridX: 107,
      gridY: 71,
      forecastHourly: 'x',
      forecastGridData: 'y',
    });
    expect(res).toEqual({ ok: false, reason: 'http-error' });
  });
});

describe('fetchAlerts', () => {
  it('maps features to Alert[] including an event', async () => {
    global.fetch = routedFetch() as unknown as typeof fetch;
    const res = await fetchAlerts(44.96, -93.27);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(1);
      expect(res.data[0].event).toBe('Heat Advisory');
    }
  });

  it('returns an empty array (success) when there are no alerts', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        jsonResponse(alertsEmptyFixture),
      ) as unknown as typeof fetch;
    const res = await fetchAlerts(44.96, -93.27);
    expect(res).toEqual({ ok: true, data: [] });
  });
});

describe('fetchForecast (full flow)', () => {
  it('bundles points + hourly + alerts', async () => {
    global.fetch = routedFetch() as unknown as typeof fetch;
    const res = await fetchForecast(44.96, -93.27);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.points.gridId).toBe('MPX');
      expect(res.data.hourly).toHaveLength(3);
      expect(res.data.alerts).toHaveLength(1);
    }
  });

  it('propagates a non-US (404) points failure without throwing', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({}, 404)) as unknown as typeof fetch;
    const res = await fetchForecast(51.5, -0.12);
    expect(res).toEqual({ ok: false, reason: 'unsupported-location' });
  });

  it('degrades alerts to [] when the alerts fetch fails', async () => {
    const mock = jest.fn(async (url: string) => {
      if (url.includes('/points/')) return jsonResponse(pointsFixture);
      if (url.includes('/forecast/hourly')) return jsonResponse(hourlyFixture);
      if (url.includes('/alerts/active')) return jsonResponse({}, 500);
      if (url.includes('/gridpoints/')) return jsonResponse(gridpointFixture);
      throw new Error('unexpected');
    });
    global.fetch = mock as unknown as typeof fetch;
    const res = await fetchForecast(44.96, -93.27);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.alerts).toEqual([]);
    }
  });
});
