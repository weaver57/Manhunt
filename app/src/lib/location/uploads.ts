/**
 * Upload queue for player_locations rows.
 *
 * Background task and foreground watch both push fixes into one queue which is
 * periodically flushed in batches. Pure helpers live here so they can be unit
 * tested without React Native; the async flush runner lives in `flush.ts`.
 */
import type { ProcessedLocation } from '@/types/location';

export interface UploadRow {
  game_id: string;
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number;
  speed_ms: number | null;
  heading: number | null;
  /** ISO timestamp of the fix (client timestamp, recorded server-side). */
  recorded_at: string;
}

/** Drop malformed rows and fixes older than the freshness window. */
export function pruneQueue(
  queue: { row: UploadRow; attempts: number }[],
  nowMs: number,
  maxAgeMs: number,
): { row: UploadRow; attempts: number }[] {
  const cutoff = nowMs - maxAgeMs;
  return queue.filter((entry) => {
    const ts = Date.parse(entry.row.recorded_at);
    if (!Number.isFinite(ts) || ts < cutoff) return false;
    const { latitude, longitude, accuracy_m } = entry.row;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(accuracy_m) ||
      !entry.row.game_id ||
      !entry.row.user_id
    ) {
      return false;
    }
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return false;
    return entry.attempts < 6; // poison-row protection
  });
}

/** Split the next batch off the queue (FIFO). */
export function takeBatch<T>(queue: T[], batchSize: number): { batch: T[]; rest: T[] } {
  const size = Math.max(1, batchSize);
  return { batch: queue.slice(0, size), rest: queue.slice(size) };
}

/** Convert a processed fix to a DB row. */
export function toUploadRow(gameId: string, userId: string, fix: ProcessedLocation): UploadRow {
  return {
    game_id: gameId,
    user_id: userId,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracy_m: Math.max(1, fix.smoothedAccuracy ?? fix.accuracy ?? 30),
    speed_ms: fix.speed,
    heading: fix.heading,
    recorded_at: new Date(fix.timestamp).toISOString(),
  };
}
