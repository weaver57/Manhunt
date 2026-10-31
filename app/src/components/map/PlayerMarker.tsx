import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';
import { Circle, Diamond, Triangle } from 'lucide-react-native';
import { colors, fontSize, lineHeight, mapGlass, marker, markerFade, motion, radius, size, spacing, stroke, typography } from '@/constants/theme';
import { Avatar } from '@/components/ui';
import type { PlayerRole } from '@/types/database';
import type { MarkerFreshness } from '@/lib/map/mapModel';

const ROLE_COLOR: Record<PlayerRole, string> = {
  chaser: colors.role.chaser,
  runner: colors.role.runner,
  spectator: colors.role.spectator,
};

const ROLE_ICON = { chaser: Diamond, runner: Circle, spectator: Triangle } as const;

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
 * avatar bubble + name + role-coloured ring. Staleness eases one fade level
 * down over motion.slow (instant under reduced motion, per spec §accessibility).
 */
export function PlayerMarker({ name, role, avatarUrl, fresh, lastSeen, uncertaintyDiameterPx, headingDeg, isSelf, showCone }: PlayerMarkerProps) {
  const ringColor = ROLE_COLOR[role];
  const RoleIcon = ROLE_ICON[role];
  const uncertainty = uncertaintyDiameterPx > 0 ? Math.max(uncertaintyDiameterPx, marker.uncertaintyMinPx) : 0;

  // Staleness crossfade: animate to the markerFade level for the new state
  // instead of snapping. Reduced-motion users get the instant value.
  const target = markerFade[fresh];
  const fade = useRef<Animated.Value>(new Animated.Value(target)).current;
  const applied = useRef(target);
  useEffect(() => {
    if (applied.current === target) return;
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (!mounted) return;
        if (reduceMotion) {
          fade.setValue(target);
        } else {
          Animated.timing(fade, { toValue: target, duration: motion.slow, useNativeDriver: true }).start();
        }
        applied.current = target;
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [fade, target]);

  return (
    <Animated.View style={[styles.root, { opacity: fade }]} pointerEvents="none">
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
        <Avatar name={name} imageUrl={avatarUrl} size={size.avatarSmall} color={colors.surface[2]} />
        <View style={[styles.roleMark, { borderColor: ringColor }]} accessibilityLabel={`${role} marker`}>
          <RoleIcon size={spacing[2]} color={ringColor} strokeWidth={stroke.icon} />
        </View>
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {name}{isSelf ? ' · You' : ''}
      </Text>
      {lastSeen ? <Text style={styles.lastSeen}>{lastSeen}</Text> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: spacing[0],
    height: spacing[0],
    alignItems: 'center',
    justifyContent: 'center',
  },
  uncertainty: {
    position: 'absolute',
    borderRadius: radius.full,
    borderWidth: stroke.border,
    backgroundColor: colors.brand.soft,
    borderColor: colors.atmosphere.rings,
  },
  cone: {
    position: 'absolute',
    top: -marker.coneLift,
    left: spacing[0],
    width: spacing[0],
    height: spacing[0],
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'transparent',
    borderLeftWidth: marker.coneHalfWidth,
    borderRightWidth: marker.coneHalfWidth,
    borderBottomWidth: marker.coneHeight,
    borderBottomColor: colors.glow.brand,
  },
  bubble: {
    padding: spacing[0],
    borderRadius: radius.full,
    borderWidth: marker.ringWidth,
    backgroundColor: mapGlass.background,
  },
  roleMark: { position: 'absolute', right: -spacing[1], bottom: -spacing[1], width: spacing[4], height: spacing[4], borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: mapGlass.background, borderWidth: stroke.border },
  name: {
    position: 'absolute',
    top: size.avatarSmall + spacing[2],
    color: colors.text.primary,
    fontFamily: typography.bodySemiBold,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    backgroundColor: mapGlass.background,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[0],
    borderRadius: radius.xs,
    overflow: 'hidden',
    maxWidth: marker.labelMaxWidth,
  },
  lastSeen: {
    position: 'absolute',
    top: size.avatarSmall + spacing[6],
    color: colors.text.secondary,
    fontFamily: typography.body,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    backgroundColor: mapGlass.background,
    paddingHorizontal: spacing[1],
    borderRadius: radius.xs,
    overflow: 'hidden',
  },
});
