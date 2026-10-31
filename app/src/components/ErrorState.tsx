import { View, StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { colors, spacing } from '@/constants/theme';
import { Button, EmptyState, Screen } from './ui';
import { RefreshCw } from 'lucide-react-native';

export default function ErrorState({ message, onRetry, style }: {
  message?: string; onRetry?: () => void; style?: StyleProp<ViewStyle>;
}) {
  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      <View style={[styles.inner, style]}>
        <EmptyState title="Couldn't load this" message={message ?? 'Check your connection, then try again.'} />
        {onRetry ? <Button label="Try again" onPress={onRetry} left={<RefreshCw color={colors.text.primary} />} /> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { justifyContent: 'center' },
  inner: { width: '100%', alignItems: 'stretch', gap: spacing[3] },
});
