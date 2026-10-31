import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import type { GameStatus, PlayerRole } from '@/types/database';
import type { LocationPermissionState } from '@/types/location';
import { useTrackingStore } from './useTrackingStore';
import {
  forceFlushUploads,
  refreshTrackingEnvironment,
  startEngineListeners,
  startTracking,
  stopTracking,
} from './locationEngine';
import { classifyBlock, toPermissionState, type PermissionBlockReason } from './permissions';
import * as Location from 'expo-location';

/** Game statuses where the device must be uploading its position. */
export const TRACKING_STATUSES: GameStatus[] = ['countdown', 'head_start', 'active', 'paused'];

/**
 * Bridges a game's lifecycle to the location engine:
 * - starts the engine (background service + foreground watch) when the game
 *   enters countdown/head_start/active/paused;
 * - stops it in lobby/ended;
 * - keeps battery + permission info fresh;
 * - exposes a permission "gate" the lobby screen renders.
 */
export function useGameTracking(
  gameId: string | undefined,
  status: GameStatus | undefined,
  userId: string | undefined,
  role: PlayerRole | undefined,
) {
  const tracking = useTrackingStore();
  const [permissions, setPermissions] = useState<LocationPermissionState | null>(null);
  const startedForRef = useRef<string | null>(null);

  const resolvePermissions = useCallback(async () => {
    try {
      const foreground = await Location.getForegroundPermissionsAsync();
      const background = await Location.getBackgroundPermissionsAsync().catch(() => null);
      if (!foreground) return;
      setPermissions(toPermissionState(foreground, background));
    } catch {
      setPermissions(null);
    }
  }, []);

  // Engine AppState listener: flush + heartbeat whenever the app is woken up
  // ("phone dies / auto-rejoin" edge case). Idempotent; never removed.
  useEffect(() => {
    startEngineListeners();
  }, []);

  // Re-check permissions on every focus (returning from the setup screen,
  // or from the OS settings app).
  useFocusEffect(
    useCallback(() => {
      void resolvePermissions();
      void refreshTrackingEnvironment();
    }, [resolvePermissions]),
  );

  useEffect(() => {
    void resolvePermissions();
    const interval = setInterval(() => {
      void resolvePermissions();
      void refreshTrackingEnvironment();
    }, 15_000);
    return () => clearInterval(interval);
  }, [resolvePermissions]);

  const shouldTrack = useMemo(
    () => !!gameId && !!userId && !!status && TRACKING_STATUSES.includes(status) && role !== 'spectator',
    [gameId, userId, status, role],
  );

  // Did the user reject the foreground permission (retry only after the env changes)?
  const permGateLocked = permissions?.foregroundGranted === false;

  useEffect(() => {
    if (!gameId || !userId) return;
    if (shouldTrack && !permGateLocked) {
      if (startedForRef.current === gameId) return;
      startedForRef.current = gameId;
      void startTracking({ gameId, userId }).then((result) => {
        // Failed to start (permission/services): retry when the environment
        // changes (permission re-resolved, focus regained, etc.).
        if (!result.started) startedForRef.current = null;
      });
    } else if (startedForRef.current === gameId) {
      // Game ended or returned to lobby in the same session.
      startedForRef.current = null;
      void stopTracking();
    } else if (!shouldTrack) {
      // App opened into a non-tracking screen: stop any stale service from an
      // earlier run so it does not keep uploading for an ended game.
      void stopTracking();
    }
  }, [gameId, userId, shouldTrack, permGateLocked]);

  const gate: PermissionBlockReason = permissions ? classifyBlock(permissions) : 'ok';

  const flush = useCallback(() => forceFlushUploads(), []);

  return { tracking, permissions, gate, resolvePermissions, flush };
}

export type { PermissionBlockReason };
