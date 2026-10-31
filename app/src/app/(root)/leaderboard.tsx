import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowRight, Trophy } from 'lucide-react-native';
import { colors, spacing } from '@/constants/theme';
import { AppIcon, Button, Card, EmptyState, PageHeader, Screen } from '@/components/ui';

export default function LeaderboardScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Screen atmosphere="quiet" contentStyle={styles.content}>
        <PageHeader title="Record" subtitle="Your crew's history and standings." onBack={() => router.back()} />
        <Card style={styles.emptyCard}>
          <EmptyState
            title="Your record starts here"
            message="Finish your first game to see wins, tags, distance, and crew standings."
            action={<AppIcon icon={Trophy} color={colors.brand.primary} />}
          />
        </Card>
        <View style={styles.footer}>
          <Button label="Create a game" left={<AppIcon icon={ArrowRight} color={colors.accentText} />} onPress={() => router.push('/(root)/create-game')} />
        </View>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  content: { paddingTop: spacing[3], flex: 1 },
  emptyCard: { flex: 1, justifyContent: 'center' },
  footer: { marginTop: 'auto', paddingTop: spacing[4] },
});
