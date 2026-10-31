import AsyncStorage from '@react-native-async-storage/async-storage';
import { flushUploadQueue, enqueueUploads, clearUploadQueue, peekUploadQueue, QUEUE_KEY, type PlayerLocationRow } from '../flush';
import { pruneQueue, takeBatch, toUploadRow, type UploadRow } from '../uploads';
import type { ProcessedLocation } from '@/types/location';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (key: string) => Promise.resolve(store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, value); return Promise.resolve(); },
      removeItem: (key: string) => { store.delete(key); return Promise.resolve(); },
      clear: () => { store.clear(); return Promise.resolve(); },
    },
  };
});

jest.mock('@/lib/supabase/client', () => ({
  supabase: { from: jest.fn(() => ({ insert: jest.fn(() => Promise.resolve({ error: null })) })) },
}));

function row(overrides: Partial<UploadRow> = {}): UploadRow {
  const base: UploadRow = {
    game_id: 'game-1',
    user_id: 'user-1',
    latitude: 52.52,
    longitude: 13.405,
    accuracy_m: 8,
    speed_ms: null,
    heading: null,
    recorded_at: new Date(1_700_000_000_000).toISOString(),
  };
  return { ...base, ...overrides };
}

describe('uploads pure helpers', () => {
  const now = 1_700_000_000_000 + 5 * 60_000; // 5 minutes after the fix

  it('pruneQueue drops stale rows', () => {
    const stale = { row: row({ recorded_at: new Date(now - 20 * 60_000).toISOString() }), attempts: 0 };
    const fresh = { row: row(), attempts: 0 };
    expect(pruneQueue([stale, fresh], now, 15 * 60_000)).toEqual([fresh]);
  });

  it('pruneQueue drops poison rows after six attempts', () => {
    const poisoned = { row: row({ recorded_at: new Date(now).toISOString() }), attempts: 6 };
    const healthy = { row: row({ recorded_at: new Date(now).toISOString() }), attempts: 5 };
    expect(pruneQueue([poisoned, healthy], now, 15 * 60_000)).toEqual([healthy]);
  });

  it('pruneQueue drops malformed rows', () => {
    const malformed = { row: row({ latitude: Number.NaN }), attempts: 0 };
    const badLng = { row: row({ longitude: 500 }), attempts: 0 };
    const missingGame = { row: row({ game_id: '' }), attempts: 0 };
    expect(pruneQueue([malformed, badLng, missingGame], now, 15 * 60_000)).toEqual([]);
  });

  it('takeBatch splits FIFO', () => {
    const queue = [1, 2, 3, 4, 5];
    expect(takeBatch(queue, 2)).toEqual({ batch: [1, 2], rest: [3, 4, 5] });
    expect(takeBatch(queue, 10)).toEqual({ batch: [1, 2, 3, 4, 5], rest: [] });
  });

  it('toUploadRow maps a processed fix', () => {
    const fix: ProcessedLocation = {
      latitude: 52.5, longitude: 13.4, accuracy: 9, smoothedAccuracy: 6,
      altitude: null, heading: 90, speed: 1.2, timestamp: 1_700_000_000_000, isMocked: false,
    };
    expect(toUploadRow('g', 'u', fix)).toEqual({
      game_id: 'g', user_id: 'u', latitude: 52.5, longitude: 13.4,
      accuracy_m: 6, speed_ms: 1.2, heading: 90, recorded_at: new Date(1_700_000_000_000).toISOString(),
    });
  });
});

describe('queue persistence', () => {
  afterEach(async () => {
    await clearUploadQueue();
  });

  it('enqueue, peek and clear', async () => {
    expect(await peekUploadQueue()).toBe(0);
    await enqueueUploads([row(), row({ latitude: 52.51 })]);
    expect(await peekUploadQueue()).toBe(2);
    await clearUploadQueue();
    expect(await peekUploadQueue()).toBe(0);
  });
});

describe('flushUploadQueue', () => {
  // `now` must be within maxAge of the row timestamps the helpers produce.
  const NOW = 1_700_000_000_000 + 60_000;

  afterEach(async () => {
    await clearUploadQueue();
  });

  it('uploads a batch and keeps the remainder', async () => {
    await enqueueUploads(Array.from({ length: 12 }, (_, i) => row({ latitude: 52.5 + i / 1000 })));
    const inserted: PlayerLocationRow[] = [];
    const result = await flushUploadQueue({ now: NOW, insertRows: async (rows) => { inserted.push(...rows); } });
    expect(result.uploaded).toBe(10);
    expect(inserted).toHaveLength(10);
    expect(result.remaining).toBe(2);
    expect(await peekUploadQueue()).toBe(2);
  });

  it('keeps rows queued (attempts++) when the insert fails', async () => {
    await enqueueUploads([row(), row({ latitude: 52.6 })]);
    const result = await flushUploadQueue({
      now: NOW,
      insertRows: async () => { throw new Error('network down'); },
    });
    expect(result.uploaded).toBe(0);
    expect(result.failed).toBe(true);
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = JSON.parse(raw!) as { attempts: number }[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0].attempts).toBe(1);
  });

  it('prevents a second concurrent flush from double-inserting', async () => {
    await enqueueUploads(Array.from({ length: 12 }, (_, i) => row({ latitude: 52.5 + i / 1000 })));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inserted: PlayerLocationRow[] = [];

    const memoryStore = {
      read: async () => JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]'),
      write: async (queue: unknown[]) => { await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); },
    };
    const first = flushUploadQueue({
      now: NOW,
      storage: memoryStore,
      insertRows: async (rows) => { await gate; inserted.push(...rows); },
    });

    // Let the first flush acquire the lease and reach the pending insert.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = flushUploadQueue({ now: NOW, storage: memoryStore });
    const secondResult = await second;
    expect(secondResult.uploaded).toBe(0);

    // Release the gate: the first flush completes and writes the remainder.
    release();
    const firstResult = await first;
    expect(firstResult.uploaded).toBe(10);
    expect(inserted).toHaveLength(10);
  });

  it('clears everything when the queue is empty', async () => {
    await AsyncStorage.setItem(QUEUE_KEY, '[]');
    const result = await flushUploadQueue({});
    expect(result).toEqual({ uploaded: 0, failed: false, remaining: 0 });
  });

  it('repairs a corrupted queue store without crashing', async () => {
    await AsyncStorage.setItem(QUEUE_KEY, 'not-json{');
    const result = await flushUploadQueue({});
    expect(result.uploaded).toBe(0);
    expect(await AsyncStorage.getItem(QUEUE_KEY)).toBe('[]');
  });
});
