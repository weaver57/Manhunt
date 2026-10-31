import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronRight, Compass, LogOut, ScanLine, Trophy } from 'lucide-react-native';
import { colors, size, spacing } from '@/constants/theme';
import { AppIcon, Avatar, Button, Card, InlineNotice, ListRow, PageHeader, Screen } from '@/components/ui';
import { useSession } from '@/lib/auth/useSession';
import { useProfile } from '@/lib/profiles/useProfile';
import { useGoogleSignIn } from '@/lib/auth/useGoogleSignIn';
import { resumeTrackingFromRoom } from '@/lib/location/locationEngine';

export default function HomeScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { data: profile, isLoading, error, refetch } = useProfile(session?.user.id ?? null);
  const { signOut } = useGoogleSignIn();

  // Cold-start recovery: if the app was killed mid-game and reopened here
  // (not into the lobby), the engine restarts itself for a still-active game
  // or clears the stale service binding for an ended one.
  useEffect(() => {
    if (!session?.user.id) return;
    void resumeTrackingFromRoom();
  }, [session?.user.id]);

  async function handleSignOut() {
    await signOut();
    router.replace('/(auth)/sign-in');
  }

  const name = profile?.display_name ?? 'Operative';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Screen atmosphere="home" contentStyle={styles.content}>
        <View style={styles.profileLine}>
          <View style={styles.brandMark}><AppIcon icon={Compass} color={colors.brand.primary} /></View>
          <ListRow
            title={name}
            subtitle={isLoading ? 'Loading profile' : 'Your field profile'}
            leading={<Avatar name={name} imageUrl={profile?.avatar_url} color={profile?.marker_color ?? colors.surfaceAlt} size={size.avatarSmall} />}
            onPress={() => router.push('/(root)/profile')}
            trailing={<AppIcon icon={ChevronRight} />}
            style={styles.profileRow}
          />
        </View>

        <PageHeader eyebrow="Field desk" title="Make a move." subtitle="Build a lobby or join your crew." />

        <Card padding="none" tone="hero">
          <ListRow
            title="Create a game"
            subtitle="Choose a mode and invite players."
            leading={<AppIcon icon={Compass} color={colors.brand.primary} />}
            trailing={<AppIcon icon={ChevronRight} color={colors.brand.primary} />}
            onPress={() => router.push('/(root)/create-game')}
            style={styles.actionRow}
          />
        </Card>
        <Card padding="none">
          <ListRow
            title="Join a game"
            subtitle="Enter a lobby code or scan a QR."
            leading={<AppIcon icon={ScanLine} />}
            trailing={<AppIcon icon={ChevronRight} />}
            onPress={() => router.push('/(root)/join-game')}
            style={styles.actionRow}
          />
        </Card>
        <Card padding="none">
          <ListRow
            title="Record"
            subtitle="Review your stats and past games."
            leading={<AppIcon icon={Trophy} />}
            trailing={<AppIcon icon={ChevronRight} />}
            onPress={() => router.push('/(root)/leaderboard')}
            style={styles.actionRow}
          />
        </Card>
        {error ? <InlineNotice message="Profile unavailable." tone="warning" action={<Button label="Retry" size="sm" block={false} onPress={() => { void refetch(); }} />} /> : null}
        <View style={styles.footer}>
          <Button label="Sign out" variant="ghost" size="md" left={<AppIcon icon={LogOut} />} onPress={() => void handleSignOut()} />
        </View>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  content: { paddingTop: spacing[4], gap: spacing[3] },
  profileLine: { minHeight: size.row, flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[4] },
  brandMark: { width: size.avatarMedium, height: size.avatarMedium, alignItems: 'center', justifyContent: 'center', borderRadius: spacing[4], backgroundColor: colors.surfaceBase },
  profileRow: { flex: 1, minHeight: size.row, paddingVertical: spacing[1] },
  actionRow: { paddingHorizontal: spacing[4], minHeight: size.row + spacing[4] },
  footer: { marginTop: 'auto', paddingTop: spacing[6], alignItems: 'flex-start' },
});
