import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, size } from '@/constants/theme';
import { Avatar } from '@/components/ui';
import type { PlayerRole } from '@/types/database';
import type { MarkerFreshness } from '@/lib/map/mapModel';

const ROLE_COLOR: Record<PlayerRole, string> = {
  chaser: colors.role.chaser,
  runner: colors.role.runner,
  spectator: colors.role.spectator,
};

const OPACITY: Record<MarkerFreshness, number> = {
  live: 1,
  recent: 0.75,
  stale: 0.45,
  offline: 0.25,
};

export interface PlayerMarkerProps {
  name: string;
  role: PlayerRole;
  avatarUrl: string | null;
  fresh: MarkerFreshness;
  /** "40s ago" etc., computed by the screen from the real fix age. */
  lastSeen: string | null;
  /** Diameter of the uncertainty ring in pixels. */
  uncertaintyDiameterPx: number;
  headingDeg: number | null;
  isSelf: boolean;
  /** Own marker only: draw the heading cone (north-up camera only). */
  showCone: boolean;
}

/**
 * One map marker: uncertainty circle behind, heading cone for the self slot,
 * avatar bubble + name + role-coloured ring. Fades with staleness.
 */
export function PlayerMarker({ name, role, avatarUrl, fresh, lastSeen, uncertaintyDiameterPx, headingDeg, isSelf, showCone }: PlayerMarkerProps) {
  const ringColor = ROLE_COLOR[role];
  const uncertainty = uncertaintyDiameterPx > 0 ? Math.max(uncertaintyDiameterPx, 26) : 0;

  return (
    <View style={[styles.root, { opacity: OPACITY[fresh] }]} pointerEvents="none">
      {uncertainty > 0 ? (
        <View
          style={[
            styles.uncertainty,
            {
              width: uncertainty,
              height: uncertainty,
              marginLeft: -(uncertainty / 2),
              marginTop: -(uncertainty / 2),
            },
          ]}
        />
      ) : null}
      {isSelf && showCone && headingDeg !== null ? (
        <View style={[styles.cone, { transform: [{ rotate: `${headingDeg}deg` }] }]} pointerEvents="none" />
      ) : null}
      <View style={[styles.bubble, { borderColor: ringColor }]}>
        <Avatar name={name} imageUrl={avatarUrl} size={size.avatarSmall} color={ringColor} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {name}
        {isSelf ? ' · You' : ''}
      </Text>
      {lastSeen ? <Text style={styles.lastSeen}>{lastSeen}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uncertainty: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    backgroundColor: 'rgba(142,124,255,0.10)',
    borderColor: 'rgba(142,124,255,0.30)',
  },
  cone: {
    position: 'absolute',
    top: -42,
    left: 0,
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'transparent',
    borderLeftWidth: 20,
    borderRightWidth: 20,
    borderBottomWidth: 80,
    borderBottomColor: 'rgba(142,124,255,0.30)',
  },
  bubble: {
    padding: 2,
    borderRadius: 999,
    borderWidth: 2,
    backgroundColor: colors.bg.base,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  name: {
    position: 'absolute',
    top: size.avatarSmall + 8,
    color: colors.text.primary,
    fontSize: fontSize.xs,
    backgroundColor: 'rgba(9,11,20,0.72)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: 'hidden',
    maxWidth: 120,
  },
  lastSeen: {
    position: 'absolute',
    top: size.avatarSmall + 24,
    color: colors.text.secondary,
    fontSize: fontSize.xs,
    backgroundColor: 'rgba(9,11,20,0.72)',
    paddingHorizontal: 4,
    borderRadius: 5,
    overflow: 'hidden',
  },
});
