/**
 * Phase 6 play area overlay: renders the host's chosen boundary (circle,
 * shrinking circle, rectangle, custom polygon) and no-go zones as MapLibre
 * fill/line layers, plus the dashed next-circle outline while a zone shrinks.
 * Pure child content — drop inside <LiveMap>.
 */
import { useMemo } from 'react';
import { ShapeSource, FillLayer, LineLayer } from '@maplibre/maplibre-react-native';
import { colors, stroke } from '@/constants/theme';
import { shrinkNext, shrinkRadiusM } from '@/lib/area/areaModel';
import type { GameSettings } from '@/types/database';

/** Ring of a circle as GeoJSON polygon coordinates (lon,lat order). */
function circleRing(centerLat: number, centerLng: number, radiusM: number, steps = 64): number[][] {
  const ring: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    // degree approximations (metres): equirectangular — fine for rendering
    const dLat = (radiusM / 111_320) * Math.cos(angle);
    const dLng = (radiusM / (111_320 * Math.max(0.01, Math.cos((centerLat * Math.PI) / 180)))) * Math.sin(angle);
    ring.push([centerLng + dLng, centerLat + dLat]);
  }
  return ring;
}

function polygonFeature(ring: number[][]) {
  return { type: 'Polygon' as const, coordinates: [ring] };
}

export function PlayAreaOverlay({ settings, startedAtMs, nowMs }: {
  settings: GameSettings;
  startedAtMs: number | null;
  nowMs: number;
}) {
  const area = settings.playArea;
  const empty = !area || area.type === 'none' || area.type === 'city_wide';

  const currentRadius = useMemo(() => {
    if (!area || (area.type !== 'circle' && area.type !== 'shrinking')) return null;
    return area.type === 'shrinking'
      ? shrinkRadiusM(settings, area.radiusM ?? 500, startedAtMs, nowMs)
      : (area.radiusM ?? 0);
  }, [area, settings, startedAtMs, nowMs]);

  const next = useMemo(() => {
    if (!area || area.type !== 'shrinking') return null;
    return shrinkNext(settings, area.radiusM ?? 500, startedAtMs, nowMs);
  }, [area, settings, startedAtMs, nowMs]);

  const mainShape = useMemo(() => {
    if (!area || empty) return null;
    if (currentRadius !== null && area.center) {
      return polygonFeature(circleRing(area.center.latitude, area.center.longitude, currentRadius));
    }
    if (area.type === 'polygon' && area.vertices?.length) {
      const ring = area.vertices.map((v) => [v.longitude, v.latitude]);
      ring.push(ring[0]); // close
      return polygonFeature(ring);
    }
    if (area.type === 'rectangle' && area.corners) {
      const [a, b] = area.corners;
      const ring = [
        [a.longitude, a.latitude],
        [b.longitude, a.latitude],
        [b.longitude, b.latitude],
        [a.longitude, b.latitude],
        [a.longitude, a.latitude],
      ];
      return polygonFeature(ring);
    }
    return null;
  }, [area, currentRadius, empty]);

  const nextShape = useMemo(() => {
    if (!next || next.nextAtMs === null || !area?.center) return null;
    return polygonFeature(circleRing(area.center.latitude, area.center.longitude, next.nextRadiusM));
  }, [next, area?.center]);

  const noGoShapes = useMemo(() => {
    const zones: { feature: GeoJSON.Feature; key: string }[] = [];
    (settings.noGoZones ?? []).forEach((zone, idx) => {
      if (zone.type !== 'polygon' || !zone.vertices?.length) return;
      const ring = zone.vertices.map((v) => [v.longitude, v.latitude]);
      ring.push(ring[0]);
      zones.push({ feature: { type: 'Feature', geometry: polygonFeature(ring), properties: {} }, key: `nogo-${idx}` });
    });
    return zones;
  }, [settings.noGoZones]);

  if (!mainShape) return null;

  return (
    <>
      <ShapeSource id="play-area" shape={mainShape as never}>
        <FillLayer
          id="play-area-fill"
          style={{
            fillColor: colors.status.warning,
            fillOpacity: 0.08,
          }}
        />
        <LineLayer
          id="play-area-line"
          style={{
            lineColor: colors.status.warning,
            lineWidth: 2,
          }}
        />
      </ShapeSource>
      {nextShape ? (
        <ShapeSource id="play-area-next" shape={nextShape as never}>
          <LineLayer
            id="play-area-next-line"
            style={{
              lineColor: colors.status.info,
              lineWidth: 1.5,
              lineDasharray: [2, 2],
            }}
          />
        </ShapeSource>
      ) : null}
      {noGoShapes.map((z) => (
        <ShapeSource key={z.key} id={z.key} shape={z.feature as never}>
          <FillLayer id={`${z.key}-fill`} style={{ fillColor: colors.status.danger, fillOpacity: 0.15 }} />
          <LineLayer id={`${z.key}-line`} style={{ lineColor: colors.status.danger, lineWidth: stroke.border + 1 }} />
        </ShapeSource>
      ))}
    </>
  );
}
