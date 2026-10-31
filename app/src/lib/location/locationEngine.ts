/**
 * Manhunt location engine.
 *
 * Runs the same ingestion pipeline from two sources:
 *  1. Foreground: Location.watchPositionAsync while the app is open.
 *  2. Background: a defined task via Location.startLocationUpdatesAsync
 *     (Android: foreground service with a persistent "tracking" notification;
 *      iOS: background location via Always permission).
 *
 * Fixes flow: reading -> engineCore (filter chain) -> upload queue
 * -> throttled batched INSERT into player_locations.
 *
 * This module must be imported once at app boot (app/index.ts) so that
 * TaskManager.defineTask is registered before the OS wakes the task.
 */
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import * as KeepAwake from 'expo-keep-awake';
import { DEFAULT_LOCATION_CONFIG, type EngineConfig, type LocationReading } from '@/types/location';
import { supabase } from '@/lib/supabase/client';
import {
  applyReading,
  initialFilterState,
  shouldQueueFix,
  type EngineInput,
  type FilterState,
} from './engineCore';
import { clearUploadQueue, enqueueUploads, flushUploadQueue, peekUploadQueue } from './flush';
import { toUploadRow } from './uploads';
import { getBatteryStatus, type BatteryStatus } from './battery';
import { patchTrackingState, useTrackingStore } from './useTrackingStore';
import { resolvePermissionState } from './permissions';

export const LOCATION_TASK_NAME = 'manhunt-location-tracking';

const PERSISTED_KEY = 'manhunt.location.persisted';
const ROOM_KEY = 'manhunt.location.room';

interface PersistedEngineState {
  filter: FilterState;
  lastQueuedAt: number | null;
  lastQueuedPosition: { latitude: number; longitude: number } | null;
  lastMovementTimestamp: number | null;
  lastFlushAt: number | null;
  lastHeartbeatAt: number | null;
  failedFlushStreak: number;
  mockReported: boolean;
  batteryLevel: number | null;
  /** Whether the foreground service is currently running in low-battery mode. */
  serviceLowBattery: boolean;
  startedAt: number | null;
}

interface TrackingRoom {
  gameId: string;
  userId: string;
}

const emptyPersisted = (): PersistedEngineState => ({
  filter: initialFilterState(),
  lastQueuedAt: null,
  lastQueuedPosition: null,
  lastMovementTimestamp: null,
  lastFlushAt: null,
  lastHeartbeatAt: null,
  failedFlushStreak: 0,
  mockReported: false,
  batteryLevel: null,
  serviceLowBattery: false,
  startedAt: null,
});

async function readPersisted(): Promise<PersistedEngineState> {
  try {
    const raw = await AsyncStorage.getItem(PERSISTED_KEY);
    if (!raw) return emptyPersisted();
    const parsed = JSON.parse(raw) as Partial<PersistedEngineState>;
    return {
      ...emptyPersisted(),
      ...parsed,
      filter: { ...initialFilterState(), ...(parsed.filter ?? {}) },
    };
  } catch {
    return emptyPersisted();
  }
}

async function writePersisted(state: PersistedEngineState): Promise<void> {
  try {
    await AsyncStorage.setItem(PERSISTED_KEY, JSON.stringify(state));
  } catch {
    // Storage failure is non-fatal; the next fix rewrites it.
  }
}

async function readRoom(): Promise<TrackingRoom | null> {
  try {
    const raw = await AsyncStorage.getItem(ROOM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TrackingRoom>;
    return parsed.gameId && parsed.userId ? (parsed as TrackingRoom) : null;
  } catch {
    return null;
  }
}

async function writeRoom(room: TrackingRoom | null): Promise<void> {
  if (!room) {
    await AsyncStorage.removeItem(ROOM_KEY).catch(() => {});
    return;
  }
  await AsyncStorage.setItem(ROOM_KEY, JSON.stringify(room));
}

// ---------------------------------------------------------------------------
// Ingestion (single pipeline for foreground + background)
// ---------------------------------------------------------------------------

interface IngestContext {
  persisted: PersistedEngineState;
  config: EngineConfig;
  now: number;
  battery: BatteryStatus;
  room: TrackingRoom | null;
}

async function buildContext(): Promise<IngestContext> {
  const [persisted, room, battery] = await Promise.all([
    readPersisted(),
    readRoom(),
    getBatteryStatus(),
  ]);
  return { persisted, config: DEFAULT_LOCATION_CONFIG, now: Date.now(), battery, room };
}

/**
 * Process one GPS reading: filter, queue if due, flush if due, refresh the
 * zustand store, optionally report mock-location usage.
 */
export async function ingestReading(reading: EngineInput): Promise<void> {
  const ctx = await buildContext();
  const decision = applyReading(ctx.persisted.filter, reading, ctx.now, ctx.config);

  const { state: filter, fix } = decision;
  const next: PersistedEngineState = { ...ctx.persisted, filter, batteryLevel: ctx.battery.level };

  // Movement tracking for the adaptive cadence.
  const readingSpeed = reading.speed ?? null;
  if (readingSpeed !== null && readingSpeed > ctx.config.speedThresholdMs) {
    next.lastMovementTimestamp = reading.timestamp;
  }

  if (fix) {
    const shouldQueue = shouldQueueFix({
      fix,
      lastQueuedAt: next.lastQueuedAt,
      lastQueuedPosition: next.lastQueuedPosition,
      lastMovementTimestamp: next.lastMovementTimestamp,
      batteryLevel: ctx.battery.level,
      now: ctx.now,
      config: ctx.config,
    });

    if (shouldQueue) {
      if (ctx.room) {
        await enqueueUploads([toUploadRow(ctx.room.gameId, ctx.room.userId, fix)]);
      }
      next.lastQueuedAt = ctx.now;
      next.lastQueuedPosition = { latitude: fix.latitude, longitude: fix.longitude };
    }

    patchTrackingState({
      phase: 'ready',
      warmupCount: ctx.config.minWarmupFixes,
      lastFix: fix,
      isGpsFresh: true,
    });
  } else {
    const warmupCount = Math.min(filter.warmup.length, ctx.config.minWarmupFixes);
    patchTrackingState({
      phase: filter.phase === 'idle' ? 'warming' : filter.phase,
      warmupCount,
      isGpsFresh: refreshFreshness(next.filter.lastAccepted?.timestamp ?? null, ctx.now),
    });
  }

  if (decision.reason === 'mocked') {
    patchTrackingState({ mocked: true });
    await maybeReportMock(ctx, next);
  }

  // Battery/thermal awareness: reconfigure the service when crossing the
  // low-battery threshold (plugged in or battery drained mid-game).
  if (ctx.room && ctx.battery.level !== null && ctx.battery.level >= 0) {
    const nowLowBattery = ctx.battery.level < ctx.config.lowBatteryPercent;
    if (nowLowBattery !== next.serviceLowBattery) {
      next.serviceLowBattery = nowLowBattery;
      try {
        await restartService(nowLowBattery, ctx.config);
      } catch {
        // Keep the previous configuration; the next crossing retries.
        next.serviceLowBattery = !nowLowBattery;
      }
    }
  }

  await writePersisted(next);
  await maybeFlush(ctx.now, next, ctx.room, ctx.config);
}

function refreshFreshness(timestampMs: number | null, now: number): boolean {
  return timestampMs !== null && now - timestampMs < 30_000;
}

// ---------------------------------------------------------------------------
// Flush scheduling
// ---------------------------------------------------------------------------

function flushBackoffMs(streak: number): number {
  return Math.min(60_000, 5_000 * 2 ** Math.min(4, streak));
}

function isFlushDue(now: number, state: PersistedEngineState, config: EngineConfig): boolean {
  if (state.lastFlushAt === null) return true;
  const sinceFlush = now - state.lastFlushAt;
  // Back off when the network keeps failing (poor-network hardening).
  if (state.failedFlushStreak > 0 && sinceFlush < flushBackoffMs(state.failedFlushStreak)) return false;
  // Hard throttle floor between server writes.
  return sinceFlush >= config.uploadIntervalS * 1000;
}

async function maybeFlush(
  now: number,
  state: PersistedEngineState,
  room: TrackingRoom | null,
  config: EngineConfig,
): Promise<void> {
  if (!isFlushDue(now, state, config)) return;

  const result = await flushUploadQueue({
    now,
    batchSize: config.batchSize,
    maxAgeMs: config.maxUploadAgeS * 1000,
  });

  const heartbeatDue = room !== null && (state.lastHeartbeatAt === null || now - state.lastHeartbeatAt > HEARTBEAT_MS);

  // Heartbeat advances the server-side offline clock; throttle it to its own
  // cadence so a burst of fixes doesn't spam the server every few seconds.
  const updated: PersistedEngineState = {
    ...state,
    lastFlushAt: now,
    failedFlushStreak: result.failed ? state.failedFlushStreak + 1 : 0,
    lastHeartbeatAt: heartbeatDue ? now : state.lastHeartbeatAt,
  };
  await writePersisted(updated);

  if (result.uploaded > 0) {
    patchTrackingState({ pendingUploads: result.remaining, lastUploadAt: now });
  }

  if (heartbeatDue && room) {
    await callHeartbeat(room);
  }
}

// ---------------------------------------------------------------------------
// Heartbeat + mock reporting
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 45_000;

async function callHeartbeat(room: TrackingRoom): Promise<void> {
  try {
    await supabase.rpc('heartbeat_game', { p_game_id: room.gameId });
  } catch {
    // Offline: the player simply appears with a stale last_seen_at until
    // the next flush succeeds ("phone dies" edge case).
  }
}

export async function forceHeartbeat(): Promise<void> {
  const room = await readRoom();
  if (!room) return;
  await callHeartbeat(room);
}

async function maybeReportMock(ctx: IngestContext, next: PersistedEngineState): Promise<void> {
  if (!ctx.room || next.mockReported) return;
  next.mockReported = true;
  try {
    const { error } = await supabase.rpc('report_mock_location', { p_game_id: ctx.room.gameId });
    if (error) throw error;
  } catch {
    // Best-effort: the local flagged chip already shows; the next mocked
    // reading retries because mockReported only guards duplicates in-flight.
    next.mockReported = false;
  }
}

// ---------------------------------------------------------------------------
// Foreground watch
// ---------------------------------------------------------------------------

  let foregroundWatcher: Location.LocationSubscription | null = null;

async function startForegroundWatch(config: EngineConfig): Promise<void> {
  if (foregroundWatcher) return;
  try {
    foregroundWatcher = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: false,
      },
      (location) => void ingestReading(toEngineInput(location)),
    );
  } catch {
    foregroundWatcher = null;
    patchTrackingState({ errorMessage: 'Location stream failed. Reopen the screen to retry.' });
  }
  void config;
}

function stopForegroundWatch(): void {
  foregroundWatcher?.remove();
  foregroundWatcher = null;
}

export function toEngineInput(location: Location.LocationObject): EngineInput {
  const reading: LocationReading = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? null,
    altitude: location.coords.altitude ?? null,
    altitudeAccuracy: location.coords.altitudeAccuracy ?? null,
    heading: location.coords.heading ?? null,
    speed: location.coords.speed ?? null,
    timestamp: location.timestamp,
  };
  return { ...reading, isMocked: (location as { mocked?: boolean }).mocked === true };
}

// ---------------------------------------------------------------------------
// Background service
// ---------------------------------------------------------------------------

export interface TrackingServiceNotification {
  title: string;
  body: string;
  color: string;
}

const serviceNotification: TrackingServiceNotification = {
  title: 'Manhunt is tracking your location',
  body: 'Keep this on to stay visible to your crew.',
  color: '#E8350E',
};

/** Highest accuracy supported when the battery is healthy; adaptive below. */
function serviceOptions(config: EngineConfig, lowBattery: boolean): Location.LocationTaskOptions {
  return {
    accuracy: Location.Accuracy.High,
    distanceInterval: lowBattery ? 30 : 10,
    deferredUpdatesInterval: lowBattery
      ? config.lowBatteryIntervalS * 1000
      : config.movingIntervalS * 1000,
    pausesUpdatesAutomatically: false, // critical for pocket/locked-screen play
    showsBackgroundLocationIndicator: true,
    activityType: Location.LocationActivityType.OtherNavigation,
    foregroundService: {
      notificationTitle: serviceNotification.title,
      notificationBody: serviceNotification.body,
      notificationColor: serviceNotification.color,
      killServiceOnDestroy: false,
    },
  };
}

async function restartService(lowBattery: boolean, config: EngineConfig): Promise<void> {
  // startLocationUpdatesAsync replaces any previously registered options.
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, serviceOptions(config, lowBattery));
}

// ---------------------------------------------------------------------------
// Public IIFE: task definition (must run at import time)
// ---------------------------------------------------------------------------

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) {
    patchTrackingState({ errorMessage: error.message, serviceActive: false });
    return;
  }
  const { locations } = data as { locations?: Location.LocationObject[] };
  if (!locations?.length) return;
  patchTrackingState({ serviceActive: true });
  for (const location of locations) {
    await ingestReading(toEngineInput(location));
  }
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StartTrackingOptions {
  gameId: string;
  userId: string;
}

export async function startTracking(options: StartTrackingOptions): Promise<{ started: boolean; reason?: string }> {
  const permissions = await resolvePermissionState();
  if (!permissions.foregroundGranted) {
    patchTrackingState({ phase: 'idle', errorMessage: 'Location permission is off. Enable it in App settings.' });
    return { started: false, reason: 'permission_foreground' };
  }

  const services = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!services) {
    patchTrackingState({ phase: 'idle', errorMessage: 'Device location is turned off. Enable GPS in system settings.' });
    return { started: false, reason: 'services_off' };
  }

  const battery = await getBatteryStatus();
  const lowBattery = battery.level !== null && battery.level < DEFAULT_LOCATION_CONFIG.lowBatteryPercent;
  const config = DEFAULT_LOCATION_CONFIG;

  // Fresh game -> fresh pipeline; but navigating away/back to the same game
  // must NOT re-warm GPS or lose the flush cadence bookkeeping.
  const previousRoom = await readRoom();
  const sameRoom =
    previousRoom !== null &&
    previousRoom.gameId === options.gameId &&
    previousRoom.userId === options.userId;
  const persisted = sameRoom
    ? { ...(await readPersisted()), batteryLevel: battery.level }
    : { ...emptyPersisted(), batteryLevel: battery.level, startedAt: Date.now(), serviceLowBattery: lowBattery };

  await writeRoom({ gameId: options.gameId, userId: options.userId });
  await writePersisted(persisted);
  patchTrackingState({
    // For the same game we know the filter state (GPS may already be ready).
    phase: sameRoom ? persisted.filter.phase === 'ready' ? 'ready' : 'warming' : 'warming',
    warmupCount: Math.min(persisted.filter.warmup.length, config.minWarmupFixes),
    mocked: sameRoom ? persisted.mockReported : false,
    batteryLevel: battery.level,
    lowPower: battery.lowPower,
    batteryOptimizationOn: battery.optimizationOn ?? false,
    errorMessage: null,
    pendingUploads: await peekUploadQueue(),
  });

  let started = true;
  let reason: string | undefined;

  // Android: starting the foreground service while a screen is open lets it
  // keep running with while-in-use permission (background permission is only
  // required when the service is *started* with the app already backgrounded).
  // iOS: requires Always permission for background task execution.
  const canRunService = permissions.backgroundGranted || Platform.OS !== 'ios';
  const alreadyRunning = sameRoom
    ? await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false)
    : false;
  if (canRunService && !alreadyRunning) {
    try {
      await restartService(lowBattery, config);
    } catch {
      started = false;
      reason = 'service_start_failed';
      patchTrackingState({ serviceActive: false, errorMessage: 'Background tracking could not start. Grant location permission and try again.' });
    }
  } else {
    patchTrackingState({ serviceActive: false });
  }

  // Foreground watch always on: it feeds the store even when the app is open
  // and covers the no-background-permission fallback.
  await startForegroundWatch(config);

  if (started) {
    patchTrackingState({ serviceActive: canRunService, errorMessage: null });
    if (Platform.OS === 'ios' && !permissions.backgroundGranted) {
      // "While using" only: keep the screen on so tracking survives the
      // pocket — the wake-lock fallback for players who never upgrade.
      void KeepAwake.activateKeepAwakeAsync('manhunt-tracking');
    }
  }
  return { started, reason };
}

export async function stopTracking(options: { clearQueue?: boolean } = {}): Promise<void> {
  stopForegroundWatch();
  try {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    // Task may not be registered — safe to ignore.
  }
  const room = await readRoom();
  if (room) {
    // Best-effort final flush so the last stretch of play is not lost.
    try {
      await flushUploadQueue({});
    } catch {
      // Ignore; queued rows expire on their own.
    }
  }
  await writeRoom(null);
  await writePersisted(emptyPersisted());
  if (options.clearQueue !== false) await clearUploadQueue();
  KeepAwake.deactivateKeepAwake('manhunt-tracking');
  patchTrackingState({ serviceActive: false, phase: 'idle', warmupCount: 0, lastFix: null, isGpsFresh: false, pendingUploads: 0, mocked: false });
}

/**
 * Cold-start recovery ("phone dies" edge case): if the app was killed during a
 * game and reopened, the lobby hook never mounted, so the engine must decide
 * by itself whether the game is still live. Restarts tracking when the
 * persisted room points at an active game; otherwise stops and clears.
 */
export async function resumeTrackingFromRoom(): Promise<void> {
  const room = await readRoom();
  if (!room) return;
  try {
    const { data, error } = await supabase
      .from('games')
      .select('status')
      .eq('id', room.gameId)
      .single();
    if (error) throw error;
    const status = (data as { status: string } | null)?.status;
    if (status && (['countdown', 'head_start', 'active', 'paused'] as string[]).includes(status)) {
      await startTracking({ gameId: room.gameId, userId: room.userId });
      return;
    }
  } catch {
    // Offline or game row unreadable: keep the room; the lobby hook will
    // reconcile once the user opens the game.
    return;
  }
  // Game over/never started: drop the stale service and room binding.
  await stopTracking();
}

/** Refresh battery/reactive info for the visibility chips. */
export async function refreshTrackingEnvironment(): Promise<void> {
  const battery = await getBatteryStatus();
  patchTrackingState({
    batteryLevel: battery.level,
    lowPower: battery.lowPower,
    batteryOptimizationOn: battery.optimizationOn ?? false,
  });
}

export async function forceFlushUploads(): Promise<number> {
  const result = await flushUploadQueue({});
  patchTrackingState({ pendingUploads: result.remaining });
  return result.uploaded;
}

export function isTrackingForGame(gameId: string | undefined): boolean {
  return !!gameId && useTrackingStore.getState().serviceActive;
}

// ---------------------------------------------------------------------------
// App-wake listener (process-lifetime, idempotent)
// ---------------------------------------------------------------------------

let engineListenersBound = false;

/**
 * On every wake-up: flush the queue, refresh battery info and prove liveness
 * ("phone dies / auto-rejoin when the app returns" edge case). The listener is
 * idempotent: safe to call from any screen, runs for the process lifetime.
 */
export function startEngineListeners(): void {
  if (engineListenersBound) return;
  engineListenersBound = true;
  AppState.addEventListener('change', (status) => {
    if (status === 'active') {
      void refreshTrackingEnvironment();
      void forceFlushUploads().then(() => forceHeartbeat());
    }
  });
}
