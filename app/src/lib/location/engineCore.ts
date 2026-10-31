import {
  DEFAULT_LOCATION_CONFIG,
  type EngineConfig,
  type FilterReason,
  type LocationReading,
  type ProcessedLocation,
} from '@/types/location';

export { DEFAULT_LOCATION_CONFIG };

const EARTH_RADIUS_M = 6_371_008.8;
/** Haversine distance in metres. Pure and exact enough for < km scales. */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const latRad = (aLat - bLat) * (Math.PI / 180);
  const lngRad = (aLng - bLng) * (Math.PI / 180);
  const aLatRad = aLat * (Math.PI / 180);
  const bLatRad = bLat * (Math.PI / 180);
  const h =
    Math.sin(latRad / 2) ** 2 +
    Math.cos(aLatRad) * Math.cos(bLatRad) * Math.sin(lngRad / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface EngineDiagnostics {
  accepted: number;
  rejectedAccuracy: number;
  rejectedJump: number;
  rejectedMock: number;
  rejectedStale: number;
}

/**
 * Persistent state of the location filter. Kept tiny so it can be
 * serialised to AsyncStorage and survive a JS restart of the background task.
 */
export interface FilterState {
  phase: 'idle' | 'warming' | 'ready';
  warmup: Pick<LocationReading, 'latitude' | 'longitude' | 'accuracy' | 'timestamp'>[];
  /** Accuracy-weighted EMA of accepted fixes (latitude). */
  smoothLat: number | null;
  smoothLng: number | null;
  /** Accuracy of the last accepted *raw* fix. */
  lastAccuracy: number | null;
  /** Last fix that was accepted (pre-smoothing judge), used for jump checks. */
  lastAccepted: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    timestamp: number;
  } | null;
  /** Fix that is currently considered "the position" for jump checks. */
  lastGood: {
    latitude: number;
    longitude: number;
    timestamp: number;
  } | null;
  diagnostics: EngineDiagnostics;
}

export function initialFilterState(): FilterState {
  return {
    phase: 'idle',
    warmup: [],
    smoothLat: null,
    smoothLng: null,
    lastAccuracy: null,
    lastAccepted: null,
    lastGood: null,
    diagnostics: {
      accepted: 0,
      rejectedAccuracy: 0,
      rejectedJump: 0,
      rejectedMock: 0,
      rejectedStale: 0,
    },
  };
}

export interface FilterDecision {
  reason: FilterReason;
  /** Smoothed fix ready to upload — present only when reason === 'ok'. */
  fix: ProcessedLocation | null;
  state: FilterState;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function accuracyOf(read: { accuracy: number | null }, fallback: number, config: EngineConfig): number {
  if (read.accuracy === null || !Number.isFinite(read.accuracy)) return fallback;
  return clamp(read.accuracy, 0, config.maxAccuracyM);
}

function reject(reason: FilterReason, state: FilterState, diagnosticsPatch?: Partial<EngineDiagnostics>): FilterDecision {
  return {
    reason,
    fix: null,
    state: {
      ...state,
      diagnostics: { ...state.diagnostics, ...diagnosticsPatch },
    },
  };
}

function isMocked(reading: Partial<LocationReading> & { isMocked?: boolean }): boolean {
  return reading.isMocked === true || (reading as { mocked?: boolean }).mocked === true;
}

export interface EngineInput extends LocationReading {
  /** Android fake-GPS flag; expo-location exposes it as `mocked` on Android. */
  isMocked?: boolean;
}
/**
 * Process one GPS reading through the filter chain:
 * mock detection -> staleness -> accuracy -> warm-up -> jump rejection ->
 * accuracy-weighted EMA smoothing.
 *
 * Pure: the caller owns and persists the returned state.
 */
export function applyReading(
  state: FilterState,
  reading: EngineInput,
  now: number,
  config: EngineConfig = DEFAULT_LOCATION_CONFIG,
): FilterDecision {
  const mocked = isMocked(reading);
  if (mocked) {
    return reject('mocked', state, { rejectedMock: state.diagnostics.rejectedMock + 1 });
  }

  if (reading.timestamp < now - 10 * 60_000) {
    // Extremely old fix (device clock drift or blocked queue): useless now.
    return reject('stale', state, { rejectedStale: state.diagnostics.rejectedStale + 1 });
  }

  const rawAccuracy = accuracyOf(reading, config.maxAccuracyM + 1, config);
  if (reading.accuracy !== null && reading.accuracy > config.maxAccuracyM) {
    return reject('low_accuracy', state, { rejectedAccuracy: state.diagnostics.rejectedAccuracy + 1 });
  }

  const candidate = {
    latitude: reading.latitude,
    longitude: reading.longitude,
    accuracy: rawAccuracy,
    timestamp: reading.timestamp,
  };

  // ---- Cold start warm-up -------------------------------------------------
  if (state.phase !== 'ready') {
    const pos = state.warmup[state.warmup.length - 1];
    if (!pos) {
      // First fix ever: start the warm-up chain.
      return {
        reason: 'warming',
        fix: null,
        state: { ...state, phase: 'warming', warmup: [candidate], smoothLat: null, smoothLng: null, lastAccuracy: candidate.accuracy },
      };
    }
    const withinWindow = candidate.timestamp - pos.timestamp <= config.warmupWindowMs;
    const withinConsistency =
      distanceMeters(pos.latitude, pos.longitude, candidate.latitude, candidate.longitude) <=
      (pos.accuracy ?? 25) + candidate.accuracy + config.warmupConsistencyM;
    // A fix outside the window/consistency breaks the chain: restart warm-up.
    const warmup = withinWindow && withinConsistency ? [...state.warmup, candidate] : [candidate];

    if (warmup.length < config.minWarmupFixes) {
      return {
        reason: 'warming',
        fix: null,
        state: { ...state, phase: 'warming', warmup, smoothLat: null, smoothLng: null, lastAccuracy: candidate.accuracy },
      };
    }

    // Enough consistent fixes — seed the EMA with their weighted average and
    // start flowing; the seeded "last good fix" anchors future jump checks.
    let lat = 0;
    let lng = 0;
    let weightSum = 0;
    for (const fix of warmup) {
      const acc = fix.accuracy ?? 25;
      const weight = clamp((config.smoothingTargetM / Math.max(1, acc)) ** 2, 0.05, 1);
      lat += fix.latitude * weight;
      lng += fix.longitude * weight;
      weightSum += weight;
    }
    lat /= weightSum;
    lng /= weightSum;
    const accepted: FilterDecision = {
      reason: 'ok',
      fix: {
        latitude: lat,
        longitude: lng,
        accuracy: rawAccuracy,
        smoothedAccuracy: Math.max(rawAccuracy, config.minAccuracyM),
        altitude: reading.altitude ?? null,
        heading: reading.heading ?? null,
        speed: reading.speed ?? null,
        timestamp: reading.timestamp,
        isMocked: false,
      },
      state: {
        ...state,
        phase: 'ready',
        warmup: [],
        smoothLat: lat,
        smoothLng: lng,
        lastAccuracy: candidate.accuracy,
        lastAccepted: candidate,
        lastGood: { latitude: lat, longitude: lng, timestamp: reading.timestamp },
        diagnostics: { ...state.diagnostics, accepted: state.diagnostics.accepted + 1 },
      },
    };
    return accepted;
  }

  // ---- Established tracking: jump rejection against last good fix ---------
  const lastGood = state.lastGood;
  if (lastGood) {
    const elapsed = Math.max(0.001, (candidate.timestamp - lastGood.timestamp) / 1000);
    const distance = distanceMeters(lastGood.latitude, lastGood.longitude, candidate.latitude, candidate.longitude);
    const uncertainty = (state.lastAccuracy ?? 15) + candidate.accuracy + 10;
    // Small displacements inside combined GPS uncertainty always pass.
    if (distance > uncertainty) {
      const speed = distance / elapsed;
      if (speed > config.maxJumpSpeedMs || (distance > config.maxJumpDistanceM && elapsed < 2)) {
        return reject('jump', state, { rejectedJump: state.diagnostics.rejectedJump + 1 });
      }
    }
  }

  // ---- Accuracy-weighted EMA smoothing ------------------------------------
  const prevLat = state.smoothLat ?? candidate.latitude;
  const prevLng = state.smoothLng ?? candidate.longitude;
  const gain = clamp(
    (config.smoothingTargetM / Math.max(1, candidate.accuracy)) ** 2,
    0.05,
    1,
  );
  const smoothedLat = prevLat + (candidate.latitude - prevLat) * gain;
  const smoothedLng = prevLng + (candidate.longitude - prevLng) * gain;

  // Good fix: becomes the new "last good" anchor.
  return {
    reason: 'ok',
    fix: {
      latitude: smoothedLat,
      longitude: smoothedLng,
      accuracy: rawAccuracy,
      smoothedAccuracy: Math.max(Math.min(rawAccuracy, config.smoothingTargetM), config.minAccuracyM),
      altitude: reading.altitude ?? null,
      heading: reading.heading ?? null,
      speed: reading.speed ?? null,
      timestamp: reading.timestamp,
      isMocked: false,
    },
    state: {
      ...state,
      lastAccuracy: candidate.accuracy,
      lastAccepted: candidate,
      lastGood: { latitude: smoothedLat, longitude: smoothedLng, timestamp: reading.timestamp },
      diagnostics: { ...state.diagnostics, accepted: state.diagnostics.accepted + 1 },
    },
  };
}

/**
 * Should this accepted fix actually be pushed to the upload queue?
 * Rules:
 *  - hard floor: never more often than `uploadIntervalS` (server churn guard)
 *  - adaptive cadence: moving (8 s) / stationary (15 s) / low battery (>= 30 s)
 *  - a meaningful move (>= 5 m) skips the adaptive delay, so runs stay live
 */
export function shouldQueueFix(input: {
  fix: ProcessedLocation;
  lastQueuedAt: number | null;
  lastQueuedPosition: { latitude: number; longitude: number } | null;
  lastMovementTimestamp: number | null;
  batteryLevel: number | null;
  now: number;
  config: EngineConfig;
}): boolean {
  const { fix, lastQueuedAt, lastQueuedPosition, lastMovementTimestamp, batteryLevel, now, config } = input;

  if (lastQueuedAt === null) return true;
  const sinceMs = now - lastQueuedAt;
  if (sinceMs < config.uploadIntervalS * 1000) return false;

  const moved =
    lastQueuedPosition === null
      ? Number.POSITIVE_INFINITY
      : distanceMeters(lastQueuedPosition.latitude, lastQueuedPosition.longitude, fix.latitude, fix.longitude);
  if (moved >= 5) return true;

  const isMoving =
    lastMovementTimestamp !== null && now - lastMovementTimestamp < config.stationaryTimeMs;
  let intervalS = isMoving ? config.movingIntervalS : config.stationaryIntervalS;
  if (batteryLevel !== null && batteryLevel >= 0 && batteryLevel < config.lowBatteryPercent) {
    intervalS = Math.max(intervalS, config.lowBatteryIntervalS);
  }
  return sinceMs >= intervalS * 1000;
}
