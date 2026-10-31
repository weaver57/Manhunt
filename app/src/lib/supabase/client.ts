import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Database } from '../../types/database';

const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl as string;
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env.local and fill in your values.'
  );
}

/**
 * Auth token storage. Supabase refresh/access tokens are secrets, so they are
 * stored in the platform keystore (iOS Keychain / Android Keystore) rather
 * than AsyncStorage plaintext. Supabase sessions can exceed SecureStore's
 * per-value limit, so values are split into small, versioned chunks. Keeping them here also satisfies the
 * "relaunch keeps you signed in" exit criterion: getSession() reads from
 * this store on every cold start.
 */
const META_SUFFIX = '.secure-meta';
const CHUNK_CODEPOINT_LIMIT = 400;

type SecureStoreMetadata = { generation: string; count: number };

function parseMetadata(value: string | null): SecureStoreMetadata | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<SecureStoreMetadata>;
    return typeof parsed.generation === 'string' && Number.isInteger(parsed.count) && (parsed.count ?? 0) > 0
      ? { generation: parsed.generation, count: parsed.count as number }
      : null;
  } catch {
    return null;
  }
}

function chunkValue(value: string): string[] {
  const points = Array.from(value);
  const chunks: string[] = [];
  for (let offset = 0; offset < points.length; offset += CHUNK_CODEPOINT_LIMIT) {
    chunks.push(points.slice(offset, offset + CHUNK_CODEPOINT_LIMIT).join(''));
  }
  return chunks.length ? chunks : [''];
}

function chunkKey(key: string, generation: string, index: number) {
  return `${key}.secure-${generation}-${index}`;
}

async function deleteGeneration(key: string, metadata: SecureStoreMetadata) {
  await Promise.all(
    Array.from({ length: metadata.count }, (_, index) =>
      SecureStore.deleteItemAsync(chunkKey(key, metadata.generation, index)).catch(() => {}),
    ),
  );
}

export const secureStoreAdapter = {
  async getItem(key: string) {
    const metadata = parseMetadata(await SecureStore.getItemAsync(`${key}${META_SUFFIX}`));
    if (!metadata) return SecureStore.getItemAsync(key); // Read values written by the previous single-key adapter.

    const chunks = await Promise.all(
      Array.from({ length: metadata.count }, (_, index) =>
        SecureStore.getItemAsync(chunkKey(key, metadata.generation, index)),
      ),
    );
    return chunks.every((chunk): chunk is string => chunk !== null) ? chunks.join('') : null;
  },

  async setItem(key: string, value: string) {
    const metadataKey = `${key}${META_SUFFIX}`;
    const previous = parseMetadata(await SecureStore.getItemAsync(metadataKey));
    const generation = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const chunks = chunkValue(value);

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        await SecureStore.setItemAsync(chunkKey(key, generation, index), chunks[index]);
      }
      // Commit only after every chunk is safely stored. Readers keep using the
      // previous complete generation if a write fails halfway through.
      await SecureStore.setItemAsync(metadataKey, JSON.stringify({ generation, count: chunks.length }));
    } catch (error) {
      await deleteGeneration(key, { generation, count: chunks.length });
      throw error;
    }

    if (previous) await deleteGeneration(key, previous);
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },

  async removeItem(key: string) {
    const metadataKey = `${key}${META_SUFFIX}`;
    const metadata = parseMetadata(await SecureStore.getItemAsync(metadataKey));
    if (metadata) await deleteGeneration(key, metadata);
    await SecureStore.deleteItemAsync(metadataKey).catch(() => {});
    await SecureStore.deleteItemAsync(key).catch(() => {});
  },
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true, // refreshes on a timer; session survives offline periods
    persistSession: true,
    detectSessionInUrl: false,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
