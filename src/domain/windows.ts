// src/domain/windows.ts — "best windows today" scan (§4.3). PURE.
// Run the verdict engine on each of the next ~12 hourly snapshots and return
// contiguous green/yellow runs as walkable windows. Drives the Home strip and
// the scheduled notifications.

import { sunFactor as computeSunFactor } from './sunPosition';
import { computeVerdict } from './verdict';
import type {
  AirQuality,
  Alert,
  DogProfile,
  GeoPoint,
  Verdict,
  VerdictLevel,
  WeatherSnapshot,
} from './types';

/** One walkable window: a contiguous run of green/yellow hours. */
export interface WalkWindow {
  /** Index of the first hour in this run (into the input array). */
  startIndex: number;
  /** Index of the last hour in this run (inclusive). */
  endIndex: number;
  /** ISO startTime of the first hour. */
  startTime: string;
  /** ISO startTime of the last hour. */
  endTime: string;
  /** Worst level within the run ('green' if every hour is green). */
  level: VerdictLevel;
  /** Human label, e.g. "after 7:15 PM" derived from startTime. */
  label: string;
}

export interface WindowScanInput {
  /** The next ~12 hourly snapshots, in chronological order. */
  hours: WeatherSnapshot[];
  airQuality: AirQuality;
  alerts: Alert[];
  profile: DogProfile;
  /** Location, used to compute per-hour sun factor. */
  location: GeoPoint;
}

export interface WindowScanResult {
  /** Per-hour verdict, aligned to `hours`. */
  hourlyVerdicts: Verdict[];
  /** Contiguous green/yellow runs (red hours break a run). */
  windows: WalkWindow[];
}

function labelFor(startTime: string): string {
  const d = new Date(startTime);
  if (Number.isNaN(d.getTime())) {
    return 'later';
  }
  const time = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `after ${time}`;
}

/**
 * Scan up to 12 hourly snapshots, compute the verdict for each, and group the
 * non-red (green/yellow) hours into contiguous walkable windows.
 *
 * @param input hours + AQI + alerts + profile + location
 * @returns per-hour verdicts and the list of contiguous green/yellow windows
 */
export function scanWindows(input: WindowScanInput): WindowScanResult {
  const { hours, airQuality, alerts, profile, location } = input;
  const horizon = hours.slice(0, 12);

  const hourlyVerdicts: Verdict[] = horizon.map((hour) => {
    const sf = computeSunFactor(
      location.lat,
      location.lon,
      new Date(hour.startTime),
    );
    return computeVerdict({
      weather: hour,
      airQuality,
      alerts,
      profile,
      sunFactor: sf,
    });
  });

  const windows: WalkWindow[] = [];
  let run: { start: number; level: VerdictLevel } | null = null;

  const flush = (endIndex: number) => {
    if (run === null) {
      return;
    }
    windows.push({
      startIndex: run.start,
      endIndex,
      startTime: horizon[run.start].startTime,
      endTime: horizon[endIndex].startTime,
      level: run.level,
      label: labelFor(horizon[run.start].startTime),
    });
    run = null;
  };

  hourlyVerdicts.forEach((v, i) => {
    if (v.level === 'red') {
      // Red breaks the run.
      flush(i - 1);
      return;
    }
    if (run === null) {
      run = { start: i, level: v.level };
    } else if (v.level === 'yellow') {
      // A yellow hour makes the whole window at worst yellow.
      run.level = 'yellow';
    }
  });
  // Flush a trailing open run.
  if (run !== null) {
    flush(horizon.length - 1);
  }

  return { hourlyVerdicts, windows };
}
