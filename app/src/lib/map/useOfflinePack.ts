import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineManager, type OfflinePack } from '@maplibre/maplibre-react-native';
import type { TileBounds } from './mapModel';

/**
 * Offline tile pack pre-download ("map tiles fail to load" edge case).
 * The pack persists on disk so the game map still renders with no data
 * connection. Download progress arrives asynchronously via the pack's
 * progress listener, so state moves downloading -> ready only when the
 * native pack reports completion (state 2) or 100%.
 */
export type PackState = 'idle' | 'downloading' | 'ready' | 'error' | 'unavailable';

export interface OfflinePackOptions {
  gameId: string | undefined;
  styleUrl: string | undefined;
  bounds: TileBounds | undefined;
  minZoom?: number;
  maxZoom?: number;
}

const COMPLETE_STATE = 2;

function recordKey(gameId: string, styleUrl: string): string {
  return `manhunt.map.pack.${gameId}.${styleUrl}`;
}

/** Style-distinguishing pack name so dark/light packs never collide. */
function packName(gameId: string, styleUrl: string): string {
  return `${gameId}-${styleUrl.slice(-12)}`;
}

export function useOfflinePack({ gameId, styleUrl, bounds, minZoom = 8, maxZoom = 14 }: OfflinePackOptions): { state: PackState; retry: () => void } {
  const [state, setState] = useState<PackState>('idle');
  const attempt = useRef(0);

  useEffect(() => {
    if (!gameId || !styleUrl || !bounds) {
      setState('idle');
      return;
    }
    const thisAttempt = ++attempt.current;
    let cancelled = false;

    (async () => {
      try {
        // Already downloaded in a previous session -> skip native work.
        const recorded = await AsyncStorage.getItem(recordKey(gameId, styleUrl));
        if (cancelled || thisAttempt !== attempt.current) return;
        if (recorded === 'ok') {
          setState('ready');
          return;
        }

        const name = packName(gameId, styleUrl);
        const packs = await OfflineManager.getPacks().catch(() => []);
        if (cancelled || thisAttempt !== attempt.current) return;
        const existing = packs.find((pack: OfflinePack) => pack.name === name);
        if (existing) {
          const status = await existing.status().catch(() => null);
          if (status && (status.state === COMPLETE_STATE || status.percentage >= 100)) {
            await AsyncStorage.setItem(recordKey(gameId, styleUrl), 'ok');
            setState('ready');
          } else {
            // Interrupted mid-download in a previous session -> resume.
            setState('downloading');
            await existing.resume().catch(() => undefined);
          }
          return;
        }

        setState('downloading');
        await OfflineManager.createPack(
          {
            name,
            styleURL: styleUrl,
            bounds,
            minZoom,
            maxZoom,
            metadata: { name, game: gameId },
          },
          (pack, status) => {
            if (cancelled || pack.metadata?.name !== name) return;
            if (status.state === COMPLETE_STATE || status.percentage >= 100) {
              void AsyncStorage.setItem(recordKey(gameId, styleUrl), 'ok')
                .then(() => setState('ready'))
                .catch(() => setState('ready'));
            }
          },
          () => {
            if (!cancelled) setState('error');
          },
        );
      } catch {
        if (!cancelled && thisAttempt === attempt.current) setState('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId, styleUrl, bounds, minZoom, maxZoom]);

  const retry = useCallback(() => {
    attempt.current += 1;
    setState('idle');
  }, []);

  return { state, retry };
}
