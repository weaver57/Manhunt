export interface LocationReading {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number; // milliseconds since epoch
}

/**
 * A GPS fix focused for game use. `smoothed` positions are derived from the
 * accuracy-weighted average of accepted fixes and are what gets uploaded.
 */
export interface ProcessedLocation {
  latitude: number;
  longitude: number;
  /** Reported GPS accuracy in metres. */
  accuracy: number | null;
  /** Accuracy of the smoothed fix (rises when smoothing pulls it). */
  smoothedAccuracy: number | null;
  altitude: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
  isMocked: boolean;
}

export type FilterReason =
  | 'ok'              // accepted into the smoothing pipeline
  | 'warming'         // cold start: not enough consistent fixes yet
  | 'low_accuracy'    // accuracy worse than the configured limit
  | 'jump'            // impossible displacement (GPS teleport / drift)
  | 'stale'           // fix older than the freshness window
  | 'mocked'          // fake-GPS fix (Android)
  | 'duplicate';      // identical time/position burst from the provider

export interface EngineConfig {
  // Accuracy thresholds
  maxAccuracyM: number; // reject fixes worse than this (server uses 30 too)
  minAccuracyM: number; // ideal accuracy reference for smoothing weight
  smoothingTargetM: number; // accuracy where the EMA gain saturates

  // Smoothing (accuracy-weighted exponential moving average)
  smoothingWindowSize: number; // hires: 1/size weight per fix
  maxJumpSpeedMs: number; // reject fixes implying faster movement than this
  maxJumpDistanceM: number; // hard jump rejection inside a single interval

  // Cold start: N consistent fixes needed before "GPS ready"
  minWarmupFixes: number;
  warmupConsistencyM: number; // fixes this far apart break the warm-up chain
  warmupWindowMs: number; // fixes spaced further apart reset the chain

  // Upload
  uploadIntervalS: number;       // minimum time between uploads
  movingIntervalS: number;       // upload cadence while moving
  stationaryIntervalS: number;   // upload cadence while stationary
  batchSize: number;             // max rows per INSERT
  maxFlushDelayS: number;        // never let queued fixes sit longer than this
  maxUploadAgeS: number;         // drop fixes older than this from the queue

  // Thresholds
  lowBatteryPercent: number;
  lowBatteryIntervalS: number;   // upload cadence when battery is low
  speedThresholdMs: number;      // above this considered moving
  stationaryTimeMs: number;      // stationary for this long = stationary
}

export const DEFAULT_LOCATION_CONFIG: EngineConfig = {
  maxAccuracyM: 30,        // server attempt_tag also rejects accuracy > 30
  minAccuracyM: 5,
  smoothingTargetM: 12,
  smoothingWindowSize: 5,
  maxJumpSpeedMs: 40,      // 144 km/h — city game, no vehicles allowed
  maxJumpDistanceM: 100,
  minWarmupFixes: 3,
  warmupConsistencyM: 40,
  warmupWindowMs: 20_000,
  uploadIntervalS: 5,      // hard floor: never upload more often than this
  movingIntervalS: 8,
  stationaryIntervalS: 15,
  batchSize: 10,
  maxFlushDelayS: 15,
  maxUploadAgeS: 900,      // 15 minutes
  lowBatteryPercent: 15,
  lowBatteryIntervalS: 30,
  speedThresholdMs: 0.5,
  stationaryTimeMs: 30_000,
};

export interface LocationPermissionState {
  foregroundGranted: boolean;
  /** iOS Always / Android ACCESS_BACKGROUND_LOCATION. */
  backgroundGranted: boolean;
  canAskAgain: boolean;
  /** iOS "while using" — tracking pauses when the app is closed. */
  foregroundIOSWhileOnly: boolean;
  status: 'undetermined' | 'granted' | 'denied' | 'restricted';
}

export interface TrackingUiState {
  phase: 'idle' | 'warming' | 'ready' | 'error';
  /** Progress towards "GPS ready" — accepted fixes / minWarmupFixes. */
  warmupCount: number;
  lastFix: ProcessedLocation | null;
  /** Last accepted fix is fresh (newer than 30 s ago). */
  isGpsFresh: boolean;
  mocked: boolean;
  batteryLevel: number | null;
  lowPower: boolean;
  /** Android only; true = the OS may kill the tracking service. */
  batteryOptimizationOn: boolean;
  serviceActive: boolean; // foreground service / background task running
  pendingUploads: number;
  lastUploadAt: number | null;
  errorMessage: string | null;
}

export function initialTrackingUiState(): TrackingUiState {
  return {
    phase: 'idle',
    warmupCount: 0,
    lastFix: null,
    isGpsFresh: false,
    mocked: false,
    batteryLevel: null,
    lowPower: false,
    batteryOptimizationOn: false,
    serviceActive: false,
    pendingUploads: 0,
    lastUploadAt: null,
    errorMessage: null,
  };
}
