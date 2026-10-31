import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { colors, fontSize, lineHeight, spacing } from '@/constants/theme';
import { Button, InlineNotice, Screen } from '@/components/ui';
import LoadingState from '@/components/LoadingState';
import { useSession } from '@/lib/auth/useSession';
import { useGameLobby } from '@/lib/games/useGameLobby';
import { useTrackingStore } from '@/lib/location/useTrackingStore';
import { useGameClock } from '@/lib/map/useGameClock';
import { useLiveLocations, type PlayerTrack } from '@/lib/map/useLiveLocations';
import { useEventFeed } from '@/lib/map/useEventFeed';
import { useOfflinePack } from '@/lib/map/useOfflinePack';
import { stylesForKey, configuredMapTilerKey } from '@/lib/map/styles';
import { buildFeed } from '@/lib/map/feedModel';
import { hudStats } from '@/lib/map/hudModel';
import {
  boundsAround,
  isVisibleTo,
  stackMarkers,
  type LatLng,
  type MarkerFix,
  type TileBounds,
} from '@/lib/map/mapModel';
import { LiveMap, type LiveMapMarker } from '@/components/map/LiveMap';
import { HUDBar } from '@/components/map/HUDBar';
import { EventFeed } from '@/components/map/EventFeed';

/**
 * Live game screen (Phase 4): MapLibre map + HUD + event feed.
 * Reuses useGameLobby so role/game realtime and heartbeats keep working.
 */
export default function GameScreen() {
  const params = useLocalSearchParams<{ gameId: string }>();
  const gameId = typeof params.gameId === 'string' ? params.gameId : undefined;
  const router = useRouter();
  const { session } = useSession();
  const scheme = useColorScheme();
  const userId = session?.user.id;
  const lobby = useGameLobby(gameId, userId);
  const game = lobby.data?.game;
  const players = useMemo(() => lobby.data?.players ?? [], [lobby.data]);
  const tracking = useTrackingStore();
  const now = useGameClock(!!game && !['lobby', 'ended'].includes(game.status));

  // ---- Self track: streamed from the location engine's store ---------------
  const [selfTrack, setSelfTrack] = useState<PlayerTrack | null>(null);
  useEffect(() => {
    const fix = tracking.lastFix;
    if (!fix) return;
    const next: MarkerFix = {
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy,
      speed: fix.speed,
      heading: fix.heading,
      timestamp: fix.timestamp,
    };
    setSelfTrack((prev) =>
      prev && prev.current.timestamp >= next.timestamp ? prev : { current: next, previous: prev?.current ?? null },
    );
  }, [tracking.lastFix]);

  // ---- Tracks for everyone else --------------------------------------------
  const roles = useMemo<Record<string, 'runner' | 'chaser' | 'spectator'>>(
    () => Object.fromEntries(players.map((p) => [p.user_id, p.role])),
    [players],
  );
  const tracks = useLiveLocations(gameId, roles);

  // ---- HUD ------------------------------------------------------------------
  const activeFixes = useMemo<Record<string, MarkerFix>>(() => {
    const map: Record<string, MarkerFix> = {};
    if (userId && selfTrack) map[userId] = { ...selfTrack.current };
    for (const [uid, track] of Object.entries(tracks)) map[uid] = { ...track.current };
    return map;
  }, [userId, selfTrack, tracks]);

  const stats = useMemo(
    () => (game ? hudStats({ game, players, userId, fixes: activeFixes, now }) : null),
    [game, players, userId, activeFixes, now],
  );

  // ---- Markers (visibility filtered) ----------------------------------------
  const markers = useMemo<LiveMapMarker[]>(() => {
    if (!game) return [];
    const settings = game.settings;
    const out: LiveMapMarker[] = [];
    for (const player of players) {
      if (player.status === 'disconnected') continue;
      const isSelf = player.user_id === userId;
      const track = isSelf ? selfTrack : tracks[player.user_id];
      if (!track) continue;
      if (!isSelf) {
        const visible = isVisibleTo({
          viewerId: userId ?? '',
          viewerRole: userId ? roles[userId] : undefined,
          targetId: player.user_id,
          targetRole: player.role,
          settings,
        });
        if (!visible) continue;
      }
      out.push({
        id: player.user_id,
        name: player.nickname || player.display_name,
        role: player.role,
        avatarUrl: player.avatar_url,
        current: track.current,
        previous: track.previous,
        isSelf,
      });
    }
    return out;
  }, [game, players, userId, roles, selfTrack, tracks]);

  const stackedMarkers = useMemo<LiveMapMarker[]>(() => {
    if (markers.length <= 1) return markers;
    const clusters = stackMarkers(
      markers.map((m) => ({ id: m.id, position: { latitude: m.current.latitude, longitude: m.current.longitude } })),
    );
    const byId = new Map(markers.map((m) => [m.id, m]));
    const out: LiveMapMarker[] = [];
    for (const cluster of clusters) {
      const members = cluster.members.map((id) => byId.get(id)).filter((m): m is LiveMapMarker => !!m);
      if (members.length <= 1) {
        if (members[0]) out.push(members[0]);
        continue;
      }
      // Overlap -> single cluster dot: freshest member anchors the position;
      // a count badge tells the player how many are there.
      const anchor = members.slice().sort((a, b) => b.current.timestamp - a.current.timestamp)[0];
      out.push({ ...anchor, name: `${members.length} close by` });
    }
    return out;
  }, [markers]);

  // ---- Event feed -------------------------------------------------------------
  const eventRows = useEventFeed(gameId);
  const feed = useMemo(
    () => buildFeed(eventRows, players.map((p) => ({ user_id: p.user_id, display_name: p.display_name, nickname: p.nickname })), now),
    [eventRows, players, now],
  );

  // ---- Offline pack (tiles edge case) ---------------------------------------
  const frozenBounds = useRef<TileBounds | null>(null);
  const packBounds = useMemo<TileBounds | undefined>(() => {
    if (frozenBounds.current) return frozenBounds.current;
    const points: LatLng[] = [
      ...Object.values(tracks).map((t) => ({ latitude: t.current.latitude, longitude: t.current.longitude })),
    ];
    if (selfTrack) points.push({ latitude: selfTrack.current.latitude, longitude: selfTrack.current.longitude });
    const area = game?.settings?.playArea ?? null;
    const circle =
      area && (area.type === 'circle' || area.type === 'shrinking') && area.center && typeof area.radiusM === 'number'
        ? { center: { latitude: area.center.latitude, longitude: area.center.longitude }, radiusM: area.radiusM }
        : null;
    if (!points.length && !circle) return undefined;
    const computed = boundsAround({ points, playArea: circle });
    frozenBounds.current = computed;
    return computed;
  }, [tracks, selfTrack, game?.settings?.playArea]);

  const mapStyles = useMemo(() => stylesForKey(configuredMapTilerKey()), []);
  const styleUrl = scheme === 'light' ? mapStyles.light : mapStyles.dark;
  const pack = useOfflinePack({ gameId: game?.id, styleUrl, bounds: packBounds });

  // ---- Camera state -----------------------------------------------------------
  const [lowPower, setLowPower] = useState(() => tracking.batteryLevel !== null && tracking.batteryLevel < 25);
  const [follow, setFollow] = useState(true);
  const [headingUp, setHeadingUp] = useState(false);
  const [recenterSignal, setRecenterSignal] = useState(0);

  const ended = game?.status === 'ended';
  const inGamePhase = !!game && ['countdown', 'head_start', 'active', 'paused'].includes(game.status);

  if (!game) {
    return (
      <SafeAreaView style={styles.safe}>
        <Screen contentStyle={styles.center}>
          <LoadingState label="Loading the map…" />
        </Screen>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.root}>
        <View style={styles.mapHost}>
          <LiveMap
            styleUrl={styleUrl}
            markers={stackedMarkers}
            follow={follow}
            onUserPan={() => setFollow(false)}
            recenterSignal={recenterSignal}
            headingUp={headingUp}
            lowPower={lowPower}
          />
          {inGamePhase && stats ? (
            <HUDBar
              stats={stats}
              follow={follow}
              onRecenter={() => {
                setFollow(true);
                setRecenterSignal((n) => n + 1);
              }}
              headingUp={headingUp}
              onToggleHeadingUp={() => setHeadingUp((h) => !h)}
              lowPower={lowPower}
              onToggleLowPower={() => setLowPower((l) => !l)}
              paused={game.status === 'paused'}
              packState={pack.state}
            />
          ) : null}
          <EventFeed items={feed} />
        </View>
        {tracking.mocked ? (
          <View style={styles.bannerWrap}>
            <InlineNotice message="Mock GPS detected — your marker is based on a suspicious fix. The host has been flagged." tone="danger" />
          </View>
        ) : null}
        {ended ? (
          <View style={styles.endedBar}>
            <Text style={styles.endedText}>Game over</Text>
            <Button variant="secondary" label="Back to lobby" onPress={() => router.replace(`/(root)/lobby/${gameId}`)} />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  root: { flex: 1 },
  mapHost: { flex: 1 },
  center: { justifyContent: 'center' },
  bannerWrap: { paddingHorizontal: spacing[3], paddingTop: spacing[2], backgroundColor: colors.bg.base },
  endedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.bg.base,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  endedText: { color: colors.text.primary, fontSize: fontSize.md, lineHeight: lineHeight.md },
});
