/**
 * Phase 6 boundary banners: instant local warnings over the map, powered by
 * the useBoundary evaluation (server judge_bounds stays the final judge).
 */
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AlertTriangle, Compass, Snowflake, XOctagon } from 'lucide-react-native';
import { colors, fontSize, lineHeight, spacing, stroke, typography, mapGlass, radius } from '@/constants/theme';
import { AppIcon } from '@/components/ui';
import type { BoundaryUiState } from '@/lib/area/useBoundary';

export function BoundaryBanner({ boundary }: { boundary: BoundaryUiState | null }) {
  const local = boundary?.local;
  // warning beat when the state changes (must run before any early return)
  const lastStateRef = useRef<string>('inside');
  const state = local?.state ?? 'inside';
  useEffect(() => {
    if (state === lastStateRef.current) return;
    lastStateRef.current = state;
    if (state === 'near_edge' || state === 'grace' || state === 'oob_penalized') {
      void Haptics.notificationAsync(
        state === 'oob_penalized'
          ? Haptics.NotificationFeedbackType.Error
          : Haptics.NotificationFeedbackType.Warning,
      ).catch(() => undefined);
    }
  }, [state]);

  if (!local || local.edgeM === null) return null; // boundless area

  if (state === 'inside') return null;

  if (state === 'near_edge') {
    const edge = Math.max(0, Math.round(local.edgeM ?? 0));
    return (
      <View style={[styles.banner, styles.warn]} accessibilityRole="alert">
        <AppIcon icon={Compass} size={16} color={colors.status.warning} />
        <Text style={styles.text}>
          {local.noGo ? 'Out of bounds zone ahead' : edge > 0 ? `Boundary in ${edge} m — turn back` : 'You are at the boundary'}
        </Text>
      </View>
    );
  }

  if (state === 'grace' || state === 'grace_paused') {
    const remain = boundary?.graceRemainingS ?? 0;
    return (
      <View style={[styles.banner, styles.grace]} accessibilityRole="alert">
        <AppIcon icon={state === 'grace_paused' ? Snowflake : AlertTriangle} size={16} color={colors.status.warning} />
        <Text style={styles.text}>
          {state === 'grace_paused'
            ? 'Outside the area — GPS too weak to count the clock. Get a better fix.'
            : `Outside the play area — back within ${remain}s or face a penalty`}
        </Text>
      </View>
    );
  }

  if (state === 'oob_penalized') {
    return (
      <View style={[styles.banner, styles.penalty]} accessibilityRole="alert">
        <AppIcon icon={XOctagon} size={16} color={colors.status.danger} />
        <Text style={styles.text}>Penalty issued — you left the play area</Text>
      </View>
    );
  }

  return null;
}

/** Thin countdown chip for a shrinking zone shown under the HUD. */
export function ShrinkCountdown({ nextAtMs, nextRadiusM, now }: {
  nextAtMs: number | null;
  nextRadiusM: number | null;
  now: number;
}) {
  if (nextAtMs === null || nextRadiusM === null) return null;
  const seconds = Math.max(0, Math.ceil((nextAtMs - now) / 1000));
  if (seconds > 600) return null; // don't nag early
  return (
    <View style={[styles.banner, styles.shrink]} accessibilityRole="text">
      <AppIcon icon={AlertTriangle} size={14} color={colors.status.info} />
      <Text style={styles.text}>
        Zone shrinks to {Math.round(nextRadiusM)} m in {formatCountdown(seconds)}
      </Text>
    </View>
  );
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: spacing[2],
    left: spacing[5],
    right: spacing[5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderWidth: stroke.border,
    backgroundColor: mapGlass.background,
  },
  warn: { borderColor: colors.status.warning },
  grace: { borderColor: colors.status.warning },
  penalty: { borderColor: colors.status.danger },
  shrink: { top: spacing[2] + 44, borderColor: colors.status.info },
  text: {
    color: colors.text.primary,
    fontFamily: typography.bodySemiBold,
    fontSize: fontSize.xs,
    lineHeight: lineHeight.xs,
    flexShrink: 1,
  },
});
