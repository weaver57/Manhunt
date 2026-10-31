import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Camera, MapView, MarkerView, UserTrackingMode } from '@maplibre/maplibre-react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import { PlayerMarker } from './PlayerMarker';
import {
  FOLLOW_ZOOM,
  headingRotationDeg,
  lastSeenLabel,
  markerFreshness,
  metersPerPixel,
  renderPosition,
  uncertaintyRadiusM,
  type MarkerFix,
} from '@/lib/map/mapModel';

export interface LiveMapMarker {
  id: string;
  name: string;
  role: 'runner' | 'chaser' | 'spectator';
  avatarUrl: string | null;
  current: MarkerFix;
  previous: MarkerFix | null;
  isSelf: boolean;
}

export interface LiveMapProps {
  styleUrl: string | object;
  markers: LiveMapMarker[];
  /** Auto-follow: the native camera tracks the device location. */
  follow: boolean;
  onUserPan: () => void;
  /** Bumping this flies the camera to the newest self fix (re-center button). */
  recenterSignal: number;
  headingUp: boolean;
  lowPower: boolean;
}

/**
 * MapLibre map with player markers. Follow mode uses the native
 * UserTrackingMode; manual pans pause follow (marker jitter and
 * never-teleport edge cases handled by renderPosition + staleness fading).
 */
export function LiveMap({ styleUrl, markers, follow, onUserPan, recenterSignal, headingUp, lowPower }: LiveMapProps) {
  const cameraRef = useRef<CameraRef>(null);
  const [zoomLevel, setZoomLevel] = useState(FOLLOW_ZOOM);

  // Re-center: fly to the newest self fix even when follow is off.
  const selfMarker = markers.find((m) => m.isSelf);
  useEffect(() => {
    if (!recenterSignal || !cameraRef.current) return;
    if (!selfMarker) return;
    const target = [selfMarker.current.longitude, selfMarker.current.latitude] as [number, number];
    cameraRef.current.flyTo(target, lowPower ? 200 : 500);
  }, [recenterSignal, selfMarker, lowPower]);

  const markerViews = useMemo(
    () =>
      markers.map((marker) => {
        const rendered = renderPosition({ previous: marker.previous, current: marker.current, now: Date.now() });
        const ageMs = Date.now() - marker.current.timestamp;
        const fresh = markerFreshness(ageMs);
        const radiusM = uncertaintyRadiusM(ageMs, marker.current.accuracy);
        const metersPerPx = metersPerPixel(zoomLevel, rendered.latitude);
        const uncertaintyPx = metersPerPx > 0 ? Math.round((radiusM * 2) / metersPerPx) : 0;
        return (
          <MarkerView key={marker.id} coordinate={[rendered.longitude, rendered.latitude]} anchor={{ x: 0.5, y: 0.5 }} allowOverlap>
            <PlayerMarker
              name={marker.name}
              role={marker.role}
              avatarUrl={marker.avatarUrl}
              fresh={fresh}
              lastSeen={fresh === 'live' ? null : lastSeenLabel(ageMs)}
              uncertaintyDiameterPx={marker.isSelf && fresh === 'live' ? 0 : uncertaintyPx}
              headingDeg={headingRotationDeg(marker.current.heading, headingUp)}
              isSelf={marker.isSelf}
              showCone={marker.isSelf && !headingUp}
            />
          </MarkerView>
        );
      }),
    // zoomLevel changes re-scale uncertainty rings; markers change reshuffles dots.
    [markers, headingUp, zoomLevel],
  );

  return (
    <View style={styles.container}>
      <MapView
        style={styles.map}
        mapStyle={styleUrl}
        attributionEnabled
        logoEnabled={false}
        compassEnabled={false}
        pitchEnabled={!lowPower}
        rotateEnabled={!lowPower}
        onRegionDidChange={(region) => {
          if (region.properties.zoomLevel && region.properties.zoomLevel !== zoomLevel) {
            setZoomLevel(Math.round(region.properties.zoomLevel * 10) / 10);
          }
          if (region.properties.isUserInteraction) onUserPan();
        }}
      >
        <Camera
          ref={cameraRef}
          followUserLocation={follow}
          followUserMode={headingUp ? UserTrackingMode.FollowWithHeading : UserTrackingMode.FollowWithCourse}
          zoomLevel={FOLLOW_ZOOM}
          animationDuration={lowPower ? 0 : 400}
        />
        {markerViews}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});
