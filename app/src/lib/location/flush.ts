/**
 * Persistence and flushing of the upload queue shared between the foreground
 * app process and the background location task (both execute the same JS
 * bundle, so AsyncStorage is the shared bus).
 *
 * A lease prevents two concurrent contexts (foreground + headless task) from
 * inserting the same batches twice.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Database } from '@/types/database';
import { supabase } from '@/lib/supabase/client';
import { pruneQueue, takeBatch, type UploadRow } from './uploads';

export const QUEUE_KEY = 'manhunt.location.uploadQueue';
const LEASE_KEY = 'manhunt.location.uploadLease';
const LEASE_MS = 20_000;

export interface QueueEntry {
  row: UploadRow;
  attempts: number;
}

export interface UploadFlushResult {
  uploaded: number;
  failed: boolean;
  remaining: number;
}

async function readQueue(): Promise<QueueEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueueEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: QueueEntry[]): Promise<void> {
  // Cap memory/storage: the queue is for offline resilience, not history.
  const trimmed = queue.slice(-200);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
}

async function acquireLease(nowMs: number): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(LEASE_KEY);
    if (raw) {
      const lease = JSON.parse(raw) as { expiresAt: number };
      if (typeof lease.expiresAt === 'number' && lease.expiresAt > nowMs) return false;
    }
    await AsyncStorage.setItem(LEASE_KEY, JSON.stringify({ expiresAt: nowMs + LEASE_MS }));
    return true;
  } catch {
    return true; // Storage failure: prefer flushing over starving.
  }
}

export type PlayerLocationRow = Database['public']['Tables']['player_locations']['Insert'];

export interface FlushDeps {
  now?: number;
  batchSize?: number;
  maxAgeMs?: number;
  /** Test seam: replaces the Supabase insert. */
  insertRows?: (rows: PlayerLocationRow[]) => Promise<void>;
  /** Test seam: replaces storage helpers. */
  storage?: { read: () => Promise<QueueEntry[]>; write: (queue: QueueEntry[]) => Promise<void> };
}

/**
 * Flush due fixes from the shared queue into player_locations. Returns how
 * many rows were uploaded; failed rows stay queued (attempts incremented) so
 * a later flush retries them.
 */
export async function flushUploadQueue(options: FlushDeps = {}): Promise<UploadFlushResult> {
  const now = options.now ?? Date.now();
  const batchSize = options.batchSize ?? 10;
  const maxAgeMs = options.maxAgeMs ?? 15 * 60_000;
  const store = options.storage ?? { read: readQueue, write: writeQueue };

  if (!(await acquireLease(now))) {
    const queue = await store.read();
    return { uploaded: 0, failed: false, remaining: queue.length };
  }

  try {
    const queue = pruneQueue(await store.read(), now, maxAgeMs);
    if (!queue.length) {
      await store.write([]);
      return { uploaded: 0, failed: false, remaining: 0 };
    }

    const { batch, rest } = takeBatch(queue, batchSize);
    const batchSet = new Set(batch);
    const inserts = batch.map(({ row }) => row);

    try {
      const insert = options.insertRows ?? (async (rows) => {
        const { error } = await supabase.from('player_locations').insert(rows);
        if (error) throw error;
      });
      await insert(inserts);
      await store.write(rest);
      return { uploaded: batch.length, failed: false, remaining: rest.length };
    } catch {
      // Bump attempts so poison rows eventually drop out; keep for retry.
      const retry = queue.map((entry) =>
        batchSet.has(entry) ? { ...entry, attempts: entry.attempts + 1 } : entry,
      );
      await store.write(retry);
      return { uploaded: 0, failed: true, remaining: retry.length };
    }
  } finally {
    // Release the lease so the next context can flush immediately.
    await AsyncStorage.removeItem(LEASE_KEY).catch(() => {});
  }
}

/** Push one or more fully-formed rows into the shared queue. */
export async function enqueueUploads(rows: UploadRow[]): Promise<number> {
  const queue = await readQueue();
  await writeQueue([...queue, ...rows.map((row) => ({ row, attempts: 0 }))]);
  return queue.length + rows.length;
}

/** Read the current queue depth (for UI counters). */
export async function peekUploadQueue(): Promise<number> {
  return (await readQueue()).length;
}

/** Clear the queue (game ended / signed out). */
export async function clearUploadQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
  await AsyncStorage.removeItem(LEASE_KEY);
}
