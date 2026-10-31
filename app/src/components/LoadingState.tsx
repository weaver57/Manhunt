import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, stroke, typography, fontSize, lineHeight } from '@/constants/theme';
import { Screen } from './ui';

export default function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <Screen contentStyle={styles.screen}>
      <Text accessibilityRole="text" style={styles.label}>{label}</Text>
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonCard}>
        <View style={styles.skeletonLine} />
        <View style={styles.skeletonLineShort} />
        <View style={styles.skeletonAction} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center', gap: spacing[4] },
  label: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.base, lineHeight: lineHeight.base },
  skeletonTitle: { width: '64%', height: lineHeight.xl, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  skeletonCard: { minHeight: spacing[16], justifyContent: 'center', gap: spacing[3], padding: spacing[4], borderRadius: radius.lg, backgroundColor: colors.surfaceBase, borderWidth: stroke.border, borderColor: colors.border },
  skeletonLine: { width: '76%', height: lineHeight.base, borderRadius: radius.full, backgroundColor: colors.surfaceAlt },
  skeletonLineShort: { width: '48%', height: lineHeight.sm, borderRadius: radius.full, backgroundColor: colors.surfaceAlt },
  skeletonAction: { width: '100%', height: spacing[12], marginTop: spacing[2], borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
});
