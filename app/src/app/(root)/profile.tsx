import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check, LogOut } from 'lucide-react-native';
import { colors, fontSize, lineHeight, radius, size, spacing, stroke, typography } from '@/constants/theme';
import { AppIcon, Avatar, Button, Card, Field, InlineNotice, PageHeader, Screen, SectionLabel } from '@/components/ui';
import { useSession } from '@/lib/auth/useSession';
import { useProfile, useUpdateProfile } from '@/lib/profiles/useProfile';
import { useGoogleSignIn } from '@/lib/auth/useGoogleSignIn';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';

const MARKER_COLORS = [
  { value: colors.role.runner, label: 'Runner' },
  { value: colors.role.chaser, label: 'Chaser' },
  { value: colors.brand.primary, label: 'Signal' },
  { value: colors.status.success, label: 'Ready' },
  { value: colors.status.warning, label: 'Caution' },
  { value: colors.text.primary, label: 'Neutral' },
];

function saveMessage(message?: string) {
  if (message?.includes('marker_color')) return 'Choose a colour from this palette.';
  if (message?.includes('nickname')) return 'Nicknames can be up to 30 characters.';
  return 'Could not save. Check your connection and try again.';
}

export default function ProfileScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { data: profile, isLoading, error, refetch } = useProfile(session?.user.id ?? null);
  const updateProfile = useUpdateProfile(session?.user.id ?? null);
  const { signOut } = useGoogleSignIn();
  const [nickname, setNickname] = useState('');
  const [markerColor, setMarkerColor] = useState<string>(MARKER_COLORS[0].value);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname ?? '');
      setMarkerColor(profile.marker_color ?? MARKER_COLORS[0].value);
    }
  }, [profile]);

  if (isLoading) return <LoadingState label="Loading profile" />;
  if (error || !profile) {
    return <ErrorState message="We couldn't load your profile. Check your connection and try again." onRetry={() => { void refetch(); }} />;
  }

  async function save() {
    if (!profile) return;
    setSaved(false);
    try {
      await updateProfile.mutateAsync({ nickname: nickname.trim() || null, marker_color: markerColor });
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.replace('/(auth)/sign-in');
  }

  const initial = profile.display_name.trim().slice(0, 1) || 'M';
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Screen atmosphere="quiet" contentStyle={styles.content}>
        <PageHeader title="Profile" subtitle="Your identity on the field." onBack={() => router.back()} />

        <Card tone="outline">
          <View style={styles.identityContent}>
            <View style={[styles.avatarRing, { borderColor: markerColor }]}>
              <Avatar name={initial} imageUrl={profile.avatar_url} color={colors.surfaceAlt} size={size.avatarLarge} />
            </View>
            <View style={styles.identityCopy}>
              <Text style={styles.displayName}>{profile.display_name}</Text>
              <Text style={styles.email}>{session?.user.email ?? ''}</Text>
            </View>
          </View>
        </Card>

        <Card>
          <View style={styles.editor}>
            <Field label="Nickname" value={nickname} onChangeText={setNickname} placeholder="Optional callsign" maxLength={30} autoCapitalize="none" />
            <SectionLabel>Map marker</SectionLabel>
            <View style={styles.swatches}>
              {MARKER_COLORS.map((item) => {
                const selected = item.value === markerColor;
                return (
                  <Pressable
                    key={item.label} onPress={() => setMarkerColor(item.value)}
                    accessibilityRole="radio" accessibilityLabel={`${item.label} marker colour`}
                    accessibilityState={{ selected }} style={styles.swatchTarget}
                  >
                    <View style={[styles.swatch, { backgroundColor: item.value }, selected && styles.swatchSelected]}>
                      {selected ? <AppIcon icon={Check} size={size.iconSmall} color={colors.bg.base} /> : null}
                    </View>
                    <Text style={styles.swatchLabel}>{item.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Button label="Save changes" loading={updateProfile.isPending} onPress={() => void save()} />
            {updateProfile.isError ? <InlineNotice message={saveMessage((updateProfile.error as { message?: string })?.message)} tone="danger" /> : null}
            {saved ? <InlineNotice message="Profile saved." tone="success" /> : null}
          </View>
        </Card>

        <SectionLabel>Lifetime record</SectionLabel>
        <View style={styles.statsGrid}>
          <StatCard value={String(profile.total_games)} label="Games" />
          <StatCard value={String(profile.games_won)} label="Wins" />
          <StatCard value={String(profile.total_tags)} label="Tags" />
          <StatCard value={(profile.total_distance_m / 1000).toFixed(1)} label="Distance · km" />
        </View>
        {/* Sign-out lives down here, past the scrollable content, so stray
            taps on the home screen can never log the player out. */}
        <Button label="Sign out" variant="ghost" size="md" left={<AppIcon icon={LogOut} />} onPress={() => void handleSignOut()} />
      </Screen>
    </SafeAreaView>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return <Card tone="outline" style={styles.statCard}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></Card>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  content: { paddingTop: spacing[3], gap: spacing[4] },
  identityContent: { width: '100%', alignItems: 'center', gap: spacing[4] },
  avatarRing: {
    width: size.avatarLarge + spacing[6],
    height: size.avatarLarge + spacing[6],
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: stroke.border,
    borderRadius: radius.full,
    padding: spacing[2],
  },
  identityCopy: { alignItems: 'center', gap: spacing[1], width: '100%' },
  displayName: { color: colors.text.primary, fontFamily: typography.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeight.lg, textAlign: 'center' },
  email: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, textAlign: 'center' },
  editor: { gap: spacing[4] },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  swatchTarget: { width: '30%', minHeight: size.touch, alignItems: 'center', justifyContent: 'center', gap: spacing[1] },
  swatch: { width: size.buttonMedium, height: size.buttonMedium, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', borderWidth: stroke.border, borderColor: colors.borderSubtle },
  swatchSelected: { borderWidth: spacing[1], borderColor: colors.text.primary },
  swatchLabel: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.xs, lineHeight: lineHeight.xs, textAlign: 'center' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: spacing[3] },
  statCard: { flexGrow: 0, flexBasis: '47%', minHeight: spacing[16] + spacing[4], alignItems: 'stretch', justifyContent: 'center', gap: spacing[1] },
  statValue: { color: colors.text.primary, fontFamily: typography.mono, fontSize: fontSize.lg, lineHeight: lineHeight.lg, fontVariant: ['tabular-nums'], textAlign: 'left' },
  statLabel: { color: colors.text.secondary, fontFamily: typography.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeight.xs, textAlign: 'left' },
});
