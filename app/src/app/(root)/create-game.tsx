import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Compass, Shield, Users } from 'lucide-react-native';
import { DEFAULT_GAME_SETTINGS, type GameMode } from '@/types/database';
import { useCreateGame } from '@/lib/games/useGameLobby';
import { colors, fontSize, lineHeight, spacing, typography } from '@/constants/theme';
import { AppIcon, Button, Card, Field, InlineNotice, PageHeader, Screen, SectionLabel } from '@/components/ui';

const MODES: { value: GameMode; label: string; hint: string; icon: typeof Compass }[] = [
  { value: 'classic', label: 'Classic', hint: 'Chasers hunt runners until the clock ends.', icon: Compass },
  { value: 'infection', label: 'Infection', hint: 'Tagged runners join the chase.', icon: Shield },
  { value: 'team', label: 'Teams', hint: 'Two squads compete across the city.', icon: Users },
];

export default function CreateGameScreen() {
  const router = useRouter();
  const createGame = useCreateGame();
  const [name, setName] = useState('Friday Manhunt');
  const [mode, setMode] = useState<GameMode>('classic');
  const [duration, setDuration] = useState('30');
  const [headStart, setHeadStart] = useState('30');
  const [formError, setFormError] = useState<string | null>(null);

  async function create() {
    const trimmed = name.trim();
    const durationMinutes = Number(duration);
    const headStartSeconds = Number(headStart);
    if (!trimmed || trimmed.length > 40 || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 240 || !Number.isInteger(headStartSeconds) || headStartSeconds < 0 || headStartSeconds > 600) {
      setFormError('Use a name up to 40 characters, a 5–240 minute duration, and a 0–600 second head start.');
      return;
    }
    setFormError(null);
    try {
      const game = await createGame.mutateAsync({
        name: trimmed, mode,
        settings: { ...DEFAULT_GAME_SETTINGS, durationMinutes, headStartSeconds, infectionMode: mode === 'infection' },
      });
      router.replace({ pathname: '/(root)/lobby/[gameId]', params: { gameId: game.id } });
    } catch {
      setFormError('Could not create the game. Check your connection, then try again.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Screen atmosphere="home" contentStyle={styles.content}>
        <PageHeader title="Create a game" subtitle="Set the basics. You can tune the details later." onBack={() => router.back()} />
        <Field label="Game name" value={name} onChangeText={setName} maxLength={40} placeholder="Friday Manhunt" returnKeyType="done" />

        <View style={styles.modeSection}>
          <SectionLabel>Choose a mode</SectionLabel>
          {MODES.map((item) => {
            const selected = mode === item.value;
            return (
              <Card key={item.value} padding="none" style={selected && styles.selectedCard}>
                <View style={styles.modeRow}>
                  <AppIcon icon={item.icon} color={selected ? colors.brand.primary : colors.text.secondary} />
                  <View style={styles.modeCopy}>
                    <Text style={styles.modeTitle}>{item.label}</Text>
                    <Text style={styles.modeHint}>{item.hint}</Text>
                  </View>
                  <Button
                    label={selected ? 'Selected' : 'Choose'} variant={selected ? 'primary' : 'secondary'} size="sm" block={false}
                    onPress={() => setMode(item.value)} accessibilityLabel={`Select ${item.label} mode`}
                  />
                </View>
              </Card>
            );
          })}
        </View>

        <Field label="Duration (minutes)" value={duration} onChangeText={setDuration} keyboardType="number-pad" maxLength={3} />
        <Field label="Runner head start (seconds)" value={headStart} onChangeText={setHeadStart} keyboardType="number-pad" maxLength={3} />

        <Card><Text style={styles.rules}>15 m catch radius · Location updates every 2 min</Text></Card>
        {formError ? <InlineNotice message={formError} tone="danger" /> : null}
        <View style={styles.footer}>
          <Button label="Create lobby" onPress={() => void create()} loading={createGame.isPending} />
        </View>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  content: { paddingTop: spacing[3], gap: spacing[4] },
  modeSection: { gap: spacing[2] },
  modeRow: { minHeight: spacing[16], flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4] },
  modeCopy: { flex: 1, gap: spacing[1] },
  modeTitle: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.md, lineHeight: lineHeight.md },
  modeHint: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  selectedCard: { borderColor: colors.brand.primary },
  rules: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  footer: { marginTop: spacing[4], paddingBottom: spacing[2] },
});
