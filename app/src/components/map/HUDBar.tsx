import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Compass, Download, Ghost, Pause, Play } from 'lucide-react-native';
import { colors, fontSize, lineHeight, mapGlass, radius, size, spacing, stroke, typography } from '@/constants/theme';
import { AppIcon } from '@/components/ui';
import { formatRemaining, type HudStats } from '@/lib/map/hudModel';

const ROLE_LABEL: Record<string, string> = {
  runner: 'Runner',
  chaser: 'Chaser',
  spectator: 'Spectator',
};

/** Live-connection state shown as the HUD status dot (spec §HUD). */
export type ConnectionStatus = 'ok' | 'syncing' | 'offline';

const CONNECTION_COLOR: Record<ConnectionStatus, string> = {
  ok: colors.status.success,
  syncing: colors.status.warning,
  offline: colors.status.danger,
};

export interface HUDBarProps {
  stats: HudStats;
  follow: boolean;
  onRecenter: () => void;
  headingUp: boolean;
  onToggleHeadingUp: () => void;
  lowPower: boolean;
  onToggleLowPower: () => void;
  paused: boolean;
  packState: string;
  onRetryPack?: () => void;
  offline?: boolean;
  connection?: ConnectionStatus;
}

/**
 * Fixed HUD overlay: timer chip, role badge, players left, nearest-opponent
 * hint plus the camera/typing controls. mode change: uses live bus to allow
 * pausing with timer frozen.
 */
export function HUDBar({ stats, follow, onRecenter, headingUp, onToggleHeadingUp, lowPower, onToggleLowPower, paused, packState, onRetryPack, offline = false, connection = 'ok' }: HUDBarProps) {
  const closeOpponent = stats.nearest?.label.endsWith(' m') && Number.parseInt(stats.nearest.label, 10) <= 100;
  const urgentRole = closeOpponent && stats.nearest?.role === 'chaser' ? 'chaser' : closeOpponent && stats.nearest?.role === 'runner' ? 'runner' : undefined;
  const connectionColor = offline ? CONNECTION_COLOR.offline : CONNECTION_COLOR[connection];
  return (
    <>
      <View style={[styles.topRow, offline && styles.topRowOffline]} pointerEvents="box-none">
        {stats.role ? (
          <View style={styles.chip} accessibilityLabel={`${ROLE_LABEL[stats.role]} — ${offline ? 'offline' : connection === 'syncing' ? 'syncing' : 'live'}`}>
            <View style={[styles.connectionDot, { backgroundColor: connectionColor }]} />
            <Text style={styles.roleText}>{ROLE_LABEL[stats.role]}</Text>
            <View style={[styles.roleStem, { backgroundColor: colors.role[stats.role] }]} />
          </View>
        ) : (
          <View style={styles.chip}>
            <View style={[styles.connectionDot, { backgroundColor: connectionColor }]} />
          </View>
        )}
        <View style={[styles.chip, styles.timerChip]}>
          <Text style={styles.timer}>
            {paused ? 'PAUSED' : formatRemaining(stats.timer.seconds)}
          </Text>
          <Text style={styles.timerLabel}>{stats.timer.label}</Text>
        </View>
        <View style={styles.chip}>
          <Text style={styles.leftText}>{stats.left} left</Text>
        </View>
      </View>
      {stats.nearest ? (
        <View
          style={[
            styles.nearestChip,
            offline && styles.nearestChipOffline,
            urgentRole === 'chaser' && styles.nearestChaser,
            urgentRole === 'runner' && styles.nearestRunner,
          ]}
          accessibilityRole="text"
        >
          <Text style={styles.nearestText} numberOfLines={1}>{stats.nearest.role} · {stats.nearest.label}</Text>
        </View>
      ) : null}
      <View style={styles.controls} pointerEvents="box-none">
        <ControlButton icon={Compass} label="Center" active={follow} onPress={onRecenter} />
        <ControlButton icon={Ghost} label={headingUp ? 'Heading' : 'North'} active={headingUp} onPress={onToggleHeadingUp} />
        <ControlButton icon={lowPower ? Play : Pause} label={lowPower ? 'Low power' : 'Full'} active={lowPower} onPress={onToggleLowPower} />
      </View>
      {packState === 'downloading' && !offline ? (
        <View style={styles.packChip} accessibilityRole="text">
          <AppIcon icon={Download} size={size.iconSmall} color={colors.text.secondary} />
          <Text style={styles.packText} numberOfLines={1}>Saving map tiles</Text>
        </View>
      ) : packState === 'error' ? (
        <Pressable onPress={onRetryPack} accessibilityRole="button" accessibilityLabel="Retry map tile download" style={[styles.packChip, styles.packError, offline && styles.packChipOffline]}>
          <AppIcon icon={AlertTriangle} size={size.iconSmall} color={colors.status.warning} />
          <Text style={[styles.packText, styles.packErrorText]} numberOfLines={1}>Tiles failed · Retry</Text>
        </Pressable>
      ) : null}
    </>
  );
}

export function ControlButton({ icon, label, active, onPress }: { icon: typeof Compass; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.control, active && styles.controlActive]}>
      <AppIcon icon={icon} size={size.iconSmall} color={active ? colors.brand.primary : colors.text.primary} />
      <Text style={[styles.controlLabel, active && { color: colors.brand.primary }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topRow: {
    position: 'absolute',
    top: spacing[2],
    left: spacing[2],
    right: spacing[2],
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  topRowOffline: { top: spacing[16] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderWidth: stroke.border,
    borderColor: mapGlass.border,
    backgroundColor: mapGlass.background,
  },
  connectionDot: { width: spacing[2], height: spacing[2], borderRadius: radius.full },
  roleStem: { width: spacing[1], height: spacing[4], borderRadius: radius.full },
  timerChip: { flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minWidth: spacing[16] },

  timer: { fontFamily: typography.mono, fontSize: fontSize.lg, lineHeight: lineHeight.lg, fontWeight: '700', color: colors.text.primary, fontVariant: ['tabular-nums'] },
  timerLabel: { color: colors.text.secondary, fontFamily: typography.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeight.xs, textTransform: 'uppercase' },
  roleText: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  leftText: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  nearestChip: { position: 'absolute', top: spacing[12], left: spacing[2], maxWidth: '46%', paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radius.full, borderWidth: stroke.border, borderColor: mapGlass.border, backgroundColor: mapGlass.backgroundSoft },
  nearestChipOffline: { top: spacing[16] + spacing[12] },
  nearestChaser: { borderColor: colors.role.chaser, backgroundColor: colors.glow.chaser },
  nearestRunner: { borderColor: colors.role.runner, backgroundColor: colors.glow.runner },
  nearestText: { color: colors.text.primary, fontFamily: typography.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  controls: {
    position: 'absolute',
    bottom: spacing[6],
    right: spacing[4],
    gap: spacing[3],
    alignItems: 'flex-end',
  },
  control: {
    minWidth: spacing[12],
    minHeight: size.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    backgroundColor: mapGlass.background,
    borderColor: mapGlass.border,
    borderWidth: stroke.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  controlActive: { borderColor: colors.brand.primary },
  controlLabel: { color: colors.text.primary, fontFamily: typography.bodyMedium, fontSize: fontSize.xs, lineHeight: lineHeight.xs },
  packChip: {
    position: 'absolute',
    top: spacing[16],
    right: spacing[2],
    maxWidth: '46%',
    minHeight: size.buttonSmall,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: mapGlass.background,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    borderWidth: stroke.border,
    borderColor: mapGlass.border,
  },
  packChipOffline: { top: spacing[16] + spacing[12] },
  packError: { borderColor: colors.status.warning },
  packErrorText: { color: colors.text.primary },
  packText: { flexShrink: 1, color: colors.text.secondary, fontFamily: typography.bodyMedium, fontSize: fontSize.xs, lineHeight: lineHeight.xs },
});
