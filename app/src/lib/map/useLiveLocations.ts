import { useEffect, useState } from 'react';
import type { PlayerRole } from '@/types/database';
import { supabase } from '@/lib/supabase/client';
import type { MarkerFix } from './mapModel';

/**
 * Live player positions for a game.
 *
 * Supabase Realtime forwards every INSERT on player_locations; we keep the
 * latest two fixes per user so the renderer can interpolate movement instead
 * of teleporting dots (marker jitter edge case).
 */
export interface PlayerTrack {
  current: MarkerFix;
  previous: MarkerFix | null;
  role?: PlayerRole;
}

/** Entries older than this are dropped from the in-memory map. */
const PRUNE_MS = 20 * 60_000;
const BACKFILL_ROWS = 600;

function toFix(row: {
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  speed_ms: number | null;
  heading: number | null;
  recorded_at: string;
}, role?: PlayerRole): MarkerFix | null {
  const latitude = row.latitude;
  const longitude = row.longitude;
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  const timestamp = Date.parse(row.recorded_at);
  if (!Number.isFinite(timestamp)) return null;
  return {
    latitude,
    longitude,
    accuracy: row.accuracy_m,
    speed: row.speed_ms,
    heading: row.heading,
    timestamp,
    ...(role ? { role } : {}),
  } as MarkerFix;
}

export type TrackMap = Record<string, PlayerTrack>;

/**
 * Stream latest fixes per user. `roles` is optional and only used for HUD
 * hints (the role is stamped onto each fix).
 */
export function useLiveLocations(gameId: string | undefined, roles?: Record<string, PlayerRole>): TrackMap {
  const [tracks, setTracks] = useState<TrackMap>({});

  useEffect(() => {
    if (!gameId) {
      setTracks({});
      return;
    }
    let cancelled = false;

    // Backfill: latest two fixes per user in the last while, so a fresh
    // map open draws everyone immediately (stale data gets greaded down by
    // the renderer, not hidden).
    (async () => {
      try {
        const cutoff = new Date(Date.now() - PRUNE_MS).toISOString();
        const { data } = await supabase
          .from('player_locations')
          .select('user_id, latitude, longitude, accuracy_m, speed_ms, heading, recorded_at')
          .eq('game_id', gameId)
          .gte('recorded_at', cutoff)
          .order('recorded_at', { ascending: false })
          .limit(BACKFILL_ROWS);
        if (cancelled || !data) return;
        const seeded: TrackMap = {};
        for (const row of data as unknown as Record<string, string | number | null>[]) {
          const userId = row.user_id as string | undefined;
          if (!userId) continue;
          const fix = toFix(row as never, roles?.[userId]);
          if (!fix) continue;
          const existing = seeded[userId];
          if (!existing) {
            seeded[userId] = { current: fix, previous: null };
          } else if (!existing.previous) {
            existing.previous = fix;
          }
        }
        setTracks(seeded);
      } catch {
        // Backfill is best-effort; realtime still updates live.
      }
    })();

    const channel = supabase.channel(`locations:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'player_locations', filter: `game_id=eq.${gameId}` },
        (payload) => {
          const row = payload.new as Record<string, string | number | null> | null;
          if (!row || typeof row.user_id !== 'string') return;
          const fix = toFix(row as never, roles?.[String(row.user_id)]);
          if (!fix) return;
          const userId = String(row.user_id);
          setTracks((prev) => {
            const last = prev[userId];
            if (last && last.current.timestamp >= fix.timestamp) return prev; // out-of-order/duplicate
            return {
              ...prev,
              [userId]: { current: fix, previous: last?.current ?? null, role: roles?.[userId] },
            };
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // roles object identity changes every parent render; read it via ref-free
    // closure with the current value from the render map being optional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Roll pruning + role stamping into the exposed value without an extra effect.
  const result: TrackMap = {};
  for (const [userId, track] of Object.entries(tracks)) {
    result[userId] = { ...track, role: roles?.[userId] };
  }
  for (const [userId, track] of Object.entries(result)) {
    if (Date.now() - track.current.timestamp > PRUNE_MS) delete result[userId];
    else if (track.previous && Date.now() - track.previous.timestamp > PRUNE_MS) {
      result[userId] = { ...track, previous: null };
    }
  }
  return result;
}
