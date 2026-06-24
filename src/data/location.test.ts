// src/data/location.test.ts — expo-location wrapper. expo-location is mocked.
// Imports stay at the top (jest hoists the jest.mock call above them).

import * as Location from 'expo-location';

import { getCurrentLocation } from './location';

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const mockRequest =
  Location.requestForegroundPermissionsAsync as unknown as jest.Mock;
const mockPosition = Location.getCurrentPositionAsync as unknown as jest.Mock;

afterEach(() => {
  jest.clearAllMocks();
});

describe('getCurrentLocation', () => {
  it('returns {lat, lon} when permission is granted and a fix is available', async () => {
    mockRequest.mockResolvedValue({ granted: true, status: 'granted' });
    mockPosition.mockResolvedValue({
      coords: { latitude: 44.96, longitude: -93.27 },
    });

    const res = await getCurrentLocation();
    expect(res).toEqual({ ok: true, data: { lat: 44.96, lon: -93.27 } });
  });

  it('returns permission-denied (no throw) when permission is refused', async () => {
    mockRequest.mockResolvedValue({ granted: false, status: 'denied' });
    const res = await getCurrentLocation();
    expect(res).toEqual({ ok: false, reason: 'permission-denied' });
    expect(mockPosition).not.toHaveBeenCalled();
  });

  it('returns permission-denied (no throw) when the permission request throws', async () => {
    mockRequest.mockRejectedValue(new Error('boom'));
    const res = await getCurrentLocation();
    expect(res).toEqual({ ok: false, reason: 'permission-denied' });
  });

  it('returns unavailable (no throw) when the position fix fails', async () => {
    mockRequest.mockResolvedValue({ granted: true, status: 'granted' });
    mockPosition.mockRejectedValue(new Error('no fix'));
    const res = await getCurrentLocation();
    expect(res).toEqual({ ok: false, reason: 'unavailable' });
  });
});
