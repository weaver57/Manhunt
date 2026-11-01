/**
 * Numeric stepper row shared by the host settings sheet and the area editor.
 */
import { Text, View } from 'react-native';
import { colors, fontSize, lineHeight, spacing, typography } from '@/constants/theme';
import { Button } from '@/components/ui';

export function Stepper({ label, value, step, onChange, unit, min = 0, max = 100_000, hint }: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
  unit: string;
  min?: number;
  max?: number;
  hint?: string;
}) {
  return (
    <View style={styles.stepper}>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <View style={styles.controls}>
        <Button variant="ghost" size="sm" block={false} label="−" onPress={() => onChange(Math.max(min, value - step))} />
        <Text style={styles.value}>{value}{unit}</Text>
        <Button variant="ghost" size="sm" block={false} label="+" onPress={() => onChange(Math.min(max, value + step))} />
      </View>
    </View>
  );
}

const styles = {
  stepper: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingVertical: spacing[1],
  },
  copy: { flexShrink: 1, paddingRight: spacing[2] },
  label: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  hint: { color: colors.text.tertiary, fontFamily: typography.body, fontSize: fontSize.xs, lineHeight: lineHeight.xs, marginTop: 2 },
  controls: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing[1] },
  value: {
    color: colors.text.primary,
    fontFamily: typography.bodySemiBold,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    minWidth: 64,
    textAlign: 'right' as const,
  },
};
