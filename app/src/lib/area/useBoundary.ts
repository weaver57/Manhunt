/**
 * Runtime boundary judgement (Phase 6).
 *
 * The phone evaluates locally on every GPS fix for instant warnings
 * (offline-safe); every few seconds it also calls the server's judge_bounds
 * RPC which is the final judge and the only thing that fires penalties.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTrackingStore } from '@/lib/location/useTrackingStore';
import { supabase } from '@/lib/supabase/client';
import type { BoundaryEval } from '@/lib/area/areaModel';
import { evaluateBoundary, zoneContains } from '@/lib/area/areaModel';
import type { GameSettings } from '@/types/database';

export interface BoundaryUiState {
  /** Latest local verdict (instant, follows every fix). */
  local: BoundaryEval | null;
  /** Server's verdict where available (authoritative penalty trigger). */
  serverState: string | null;
  graceRemainingS: number | null;
  /** Seconds still owed before the server would fire a penalty. */
  penaltyCountdownS: number | null;
  accuracyPaused: boolean;
}

export function useBoundary(input: {
  gameId: string | undefined;
  settings: GameSettings | null;
  startedAtMs: number | null;
  active: boolean;
  /** Interval for the server sync (ms). */
  judgeIntervalMs?: number;
}): BoundaryUiState {
  const { gameId, settings, startedAtMs, active, judgeIntervalMs = 5000 } = input;
  const lastFix = useTrackingStore((s) => s.lastFix);

  // Local mirror of game_players.boundary_state / out_of_bounds_since. Reset
  // per game so stale dwell from a previous session never leaks in.
  const previousStateRef = useRef<string>('inside');
  const oobSinceRef = useRef<number | null>(null);
  const [gameKey, setGameKey] = useState(gameId);
  const [local, setLocal] = useState<BoundaryEval | null>(null);
  const [server, setServer] = useState<{
    state: string | null;
    graceRemainingS: number | null;
  }>({ state: null, graceRemainingS: null });

  useEffect(() => {
    if (gameKey !== gameId) {
      setGameKey(gameId);
      previousStateRef.current = 'inside';
      oobSinceRef.current = null;
      setLocal(null);
      setServer({ state: null, graceRemainingS: null });
    }
  }, [gameId, gameKey]);

  // -- local eval on each fix ------------------------------------------------
  useEffect(() => {
    if (!settings || !active || !lastFix) return;
    const point = { latitude: lastFix.latitude, longitude: lastFix.longitude };
    const evalResult = evaluateBoundary({
      settings,
      startedAtMs,
      point,
      accuracyM: lastFix.accuracy,
      previousState: previousStateRef.current as never,
      outOfBoundsSinceMs: oobSinceRef.current,
      nowMs: lastFix.timestamp,
    });
    // mirror: keep dwell frozen (as the server does) while accuracy is poor
    if (!evalResult.inside || evalResult.noGo) {
      if (oobSinceRef.current === null) oobSinceRef.current = lastFix.timestamp;
    } else {
      oobSinceRef.current = null;
    }
    if (evalResult.state !== 'grace' && evalResult.state !== 'grace_paused') {
      previousStateRef.current = evalResult.state;
    }
    setLocal(evalResult);
  }, [settings, active, lastFix, startedAtMs]);

  // -- server sync every few seconds ------------------------------------------
  useEffect(() => {
    if (!gameId || !active || !settings) return;
    let cancelled = false;
    const judge = async () => {
      const fix = useTrackingStore.getState().lastFix;
      if (!fix) return;
      try {
        const { data } = await supabase.rpc('judge_bounds', {
          p_game_id: gameId,
          p_lat: fix.latitude,
          p_lng: fix.longitude,
          p_accuracy_m: fix.accuracy,
        });
        if (cancelled || !data) return;
        const result = data as {
          state?: string;
          graceRemainingS?: number | null;
          inside?: boolean;
        };
        setServer({ state: result.state ?? null, graceRemainingS: result.graceRemainingS ?? null });
        if (result.state) {
          previousStateRef.current = result.state;
          // the server owns the dwell clock; keep the local mirror naive
          if (!result.inside && oobSinceRef.current === null) oobSinceRef.current = Date.now();
        }
      } catch {
        // offline: local warnings keep running; the server syncs later.
      }
    };
    void judge();
    const t = setInterval(() => { void judge(); }, judgeIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [gameId, active, settings, judgeIntervalMs]);

  // no-go check must also work when offline (zoneContains is cheap)
  const inNoGo = useMemo(() => {
    if (!settings || !lastFix) return false;
    return (settings.noGoZones ?? []).some((z) => zoneContains(z, {
      latitude: lastFix.latitude,
      longitude: lastFix.longitude,
    }));
  }, [settings, lastFix]);

  const ui = useMemo<BoundaryUiState>(() => {
    if (local && inNoGo) local.noGo = true; // keep the eval object honest for offline no-go zones
    return {
      local,
      serverState: server.state,
      graceRemainingS: server.graceRemainingS ?? local?.graceRemainingS ?? null,
      penaltyCountdownS:
        server.graceRemainingS != null && local && (local.state === 'grace' || local.state === 'grace_paused')
          ? server.graceRemainingS
          : null,
      accuracyPaused: local?.accuracyPaused ?? false,
    };
  }, [local, server.graceRemainingS, server.state, inNoGo]);

  return ui;
}
