// src/data/airQuality.test.ts — Open-Meteo client + AirNow stub. NO REAL NETWORK.

import aqFixture from './__fixtures__/open-meteo-air-quality.json';
import aqMissingFixture from './__fixtures__/open-meteo-air-quality-missing.json';

import {
  CURRENT_FIELDS,
  OPEN_METEO_AIR_QUALITY_URL,
  fetchAirQuality,
  fetchAirQualityAirNow,
  toAirQuality,
} from './airQuality';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('toAirQuality', () => {
  it('maps a numeric us_aqi', () => {
    expect(toAirQuality(aqFixture)).toEqual({ usAqi: 42 });
  });
  it('maps a null us_aqi to { usAqi: null }', () => {
    expect(toAirQuality(aqMissingFixture)).toEqual({ usAqi: null });
  });
  it('maps an absent current to { usAqi: null }', () => {
    expect(toAirQuality({})).toEqual({ usAqi: null });
  });
});

describe('fetchAirQuality', () => {
  it('requests the Open-Meteo URL with the right query and returns the AQI', async () => {
    const mock = jest.fn().mockResolvedValue(jsonResponse(aqFixture));
    global.fetch = mock as unknown as typeof fetch;

    const res = await fetchAirQuality(44.96, -93.27);
    expect(res).toEqual({ ok: true, data: { usAqi: 42 } });

    const url = mock.mock.calls[0][0] as string;
    expect(url.startsWith(OPEN_METEO_AIR_QUALITY_URL)).toBe(true);
    expect(url).toContain('latitude=44.96');
    expect(url).toContain('longitude=-93.27');
    // Assert against the exported constant, not a re-hardcoded literal, so the
    // requested fields have ONE source of truth (duplicate-shape-constant rule).
    expect(url).toContain(`current=${CURRENT_FIELDS}`);
  });

  it('degrades a missing/null AQI to { usAqi: null } without throwing', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse(aqMissingFixture)) as unknown as typeof fetch;
    const res = await fetchAirQuality(44.96, -93.27);
    expect(res).toEqual({ ok: true, data: { usAqi: null } });
  });

  it('returns bad-response when current is missing entirely', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ latitude: 1 })) as unknown as typeof fetch;
    const res = await fetchAirQuality(1, 2);
    expect(res).toEqual({ ok: false, reason: 'bad-response' });
  });

  it('surfaces a network failure as a recoverable result (no throw)', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('offline')) as unknown as typeof fetch;
    const res = await fetchAirQuality(1, 2);
    expect(res).toEqual({ ok: false, reason: 'network-error' });
  });
});

describe('fetchAirQualityAirNow (stub seam)', () => {
  it('throws "not implemented" until the EPA upgrade lands', async () => {
    await expect(
      fetchAirQualityAirNow(44.96, -93.27, { proxyBaseUrl: 'https://proxy' }),
    ).rejects.toThrow(/not implemented/i);
  });
});
