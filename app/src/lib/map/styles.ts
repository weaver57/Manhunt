/**
 * Map tile sources. Free vector tiles come from MapTiler's free tier; set
 * EXPO_PUBLIC_MAPTILER_KEY (via env.local -> app.config extra) to use them.
 * Without a key the map falls back to the public MapLibre demo style —
 * world-wide, zoom <= 6, good enough to keep the game playable while a key
 * is being arranged.
 */
import Constants from 'expo-constants';

export interface MapStyles {
  dark: string;
  light: string;
}

export const DEMOTILES_FALLBACK = 'https://demotiles.maplibre.org/style.json';

export function stylesForKey(mapTilerKey: string | null | undefined): MapStyles {
  if (!mapTilerKey) {
    return { dark: DEMOTILES_FALLBACK, light: DEMOTILES_FALLBACK };
  }
  return {
    dark: `https://api.maptiler.com/maps/dark-v2/style.json?key=${mapTilerKey}`,
    light: `https://api.maptiler.com/maps/basic-v2/style.json?key=${mapTilerKey}`,
  };
}

/** Key injected through app.config extra (EXPO_PUBLIC_MAPTILER_KEY). */
export function configuredMapTilerKey(): string | null {
  const fromExtra = Constants.expoConfig?.extra?.mapTilerKey;
  if (typeof fromExtra === 'string' && fromExtra.trim()) return fromExtra.trim();
  const fromEnv = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_MAPTILER_KEY : undefined;
  return typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : null;
}
