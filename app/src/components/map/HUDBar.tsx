import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Compass, Ghost, Pause, Play, WifiOff } from 'lucide-react-native';
import { colors, fontSize, lineHeight, radius, spacing } from '@/constants/theme';
import { AppIcon } from '@/components/ui';
import { formatRemaining, type HudStats } from '@/lib/map/hudModel';
import { useColorScheme } from 'react-native';

const ROLE_LABEL: Record<string, string> = {
  runner: 'Runner',
  chaser: 'Chaser',
  spectator: 'Spectator',
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
}

/**
 * Fixed HUD overlay: timer chip, role badge, players left, nearest-opponent
 * hint plus the camera/typing controls. mode change: uses live bus to allow
 * pausing with timer frozen.
 */
export function HUDBar({ stats, follow, onRecenter, headingUp, onToggleHeadingUp, lowPower, onToggleLowPower, paused, packState }: HUDBarProps) {
  const scheme = useColorScheme();
  const dark = scheme !== 'light';
  return (
    <>
      <View style={styles.topRow} pointerEvents="box-none">
        <View style={[styles.chip, dark ? styles.chipDark : styles.chipLight]}>
          <Text style={[styles.timer, { color: dark ? colors.text.primary : colors.text.primary }]}>
            {paused ? 'PAUSED' : formatRemaining(stats.timer.seconds)}
          </Text>
          <Text style={styles.timerLabel}>{stats.timer.label}</Text>
        </View>
        {stats.role ? (
          <View style={[styles.chip, dark ? styles.chipDark : styles.chipLight, { borderLeftColor: colors.role[stats.role], borderLeftWidth: 3 }]}>
            <Text style={styles.roleText}>{ROLE_LABEL[stats.role]}</Text>
          </View>
        ) : null}
        <View style={[styles.chip, dark ? styles.chipDark : styles.chipLight]}>
          <Text style={styles.leftText}>{stats.left} left</Text>
        </View>
        {stats.nearest ? (
          <View style={[styles.chip, dark ? styles.chipDark : styles.chipLight]}>
            <Text style={styles.nearestText}>
              {stats.nearest.role} · {stats.nearest.label}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.controls} pointerEvents="box-none">
        <ControlButton icon={Compass} label="Center" active={follow} onPress={onRecenter} />
        <ControlButton icon={Ghost} label={headingUp ? 'Heading' : 'North'} active={headingUp} onPress={onToggleHeadingUp} />
        <ControlButton icon={lowPower ? Play : Pause} label={lowPower ? 'Low power' : 'Full'} active={lowPower} onPress={onToggleLowPower} />
      </View>
      {packState === 'downloading' ? (
        <View style={styles.packChip}>
          <AppIcon icon={WifiOff} size={14} color={colors.text.secondary} />
          <Text style={styles.packText}>Caching map tiles…</Text>
        </View>
      ) : null}
    </>
  );
}

export function ControlButton({ icon, label, active, onPress }: { icon: typeof Compass; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={[styles.control, active && styles.controlActive]}>
      <AppIcon icon={icon} size={18} color={active ? colors.brand.primary : colors.text.primary} />
      <Text style={[styles.controlLabel, active && { color: colors.brand.primary }]}>{label}</Text>
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
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
  },
  chipDark: { backgroundColor: 'rgba(9,11,20,0.86)', borderColor: colors.borderSubtle },
  chipLight: { backgroundColor: 'rgba(0,0,0,0.5)', borderColor: 'rgba(255,255,255,0.2)' },
  timer: { fontSize: fontSize.lg, fontWeight: '700', color: colors.text.primary },
  timerLabel: { color: colors.text.secondary, fontSize: fontSize.xs },
  roleText: { color: colors.text.primary, fontSize: fontSize.sm, lineHeight: lineHeight.sm, fontWeight: '600' },
  leftText: { color: colors.text.primary, fontSize: fontSize.sm },
  nearestText: { color: colors.text.secondary, fontSize: fontSize.sm },
  controls: {
    position: 'absolute',
    bottom: spacing[6],
    right: spacing[4],
    gap: spacing[3],
    alignItems: 'flex-end',
  },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    backgroundColor: 'rgba(9,11,20,0.86)',
    borderColor: colors.borderSubtle,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  controlActive: { borderColor: colors.brand.primary },
  controlLabel: { color: colors.text.primary, fontSize: fontSize.xs },
  packChip: {
    position: 'absolute',
    bottom: spacing[2],
    left: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: 'rgba(9,11,20,0.8)',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: 999,
  },
  packText: { color: colors.text.secondary, fontSize: fontSize.xs },
});
