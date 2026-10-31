/**
 * Map tile sources. Free vector tiles come from MapTiler's free tier; set
 * EXPO_PUBLIC_MAPTILER_KEY (via env.local -> app.config extra) to use them.
 *
 * Without a key the map falls back to free OpenStreetMap RASTER tiles at
 * street level. (The previous fallback, MapLibre demotiles, only covers the
 * world at zoom <= 6, which renders as a blank map at the game's follow zoom
 * of 16.)
 */
import Constants from 'expo-constants';

export type MapStyleSource = string | object;

export interface MapStyles {
  dark: MapStyleSource;
  light: MapStyleSource;
}

export const DEMOTILES_FALLBACK = 'https://demotiles.maplibre.org/style.json';

/** Inline MapLibre style JSON rendering free OSM raster tiles. */
function osmRasterStyle(tint: 'dark' | 'light'): object {
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': tint === 'dark' ? '#0b0e17' : '#e8eef4' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: tint === 'dark' ? { 'raster-brightness-max': 0.85 } : {} },
    ],
  };
}

export function stylesForKey(mapTilerKey: string | null | undefined): MapStyles {
  if (!mapTilerKey) {
    return { dark: osmRasterStyle('dark'), light: osmRasterStyle('light') };
  }
  return {
    dark: `https://api.maptiler.com/maps/dark-v2/style.json?key=${mapTilerKey}`,
    light: `https://api.maptiler.com/maps/basic-v2/style.json?key=${mapTilerKey}`,
  };
}

/** True when the style can be used with OfflineManager (URL-based only). */
export function isUrlStyle(style: MapStyleSource): style is string {
  return typeof style === 'string';
}

export function stylesForKeyUrl(mapTilerKey: string | null | undefined): { dark: string; light: string } {
  const styles = stylesForKey(mapTilerKey);
  return {
    dark: isUrlStyle(styles.dark) ? styles.dark : DEMOTILES_FALLBACK,
    light: isUrlStyle(styles.light) ? styles.light : DEMOTILES_FALLBACK,
  };
}

/** Key injected through app.config extra (EXPO_PUBLIC_MAPTILER_KEY). */
export function configuredMapTilerKey(): string | null {
  const fromExtra = Constants.expoConfig?.extra?.mapTilerKey;
  if (typeof fromExtra === 'string' && fromExtra.trim()) return fromExtra.trim();
  const fromEnv = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_MAPTILER_KEY : undefined;
  return typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : null;
}
