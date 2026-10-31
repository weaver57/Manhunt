import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Compass } from 'lucide-react-native';
import { colors, fontSize, lineHeight, radius, size, spacing, stroke, tracking, typography } from '@/constants/theme';
import { Button, InlineNotice, Screen } from '@/components/ui';
import { useGoogleSignIn } from '@/lib/auth/useGoogleSignIn';
import { useSession } from '@/lib/auth/useSession';

export default function SignInScreen() {
  const router = useRouter();
  const { signIn, loading, error } = useGoogleSignIn();
  const { session, loading: sessionLoading } = useSession();

  useEffect(() => {
    if (!sessionLoading && session) router.replace('/(root)/home');
  }, [router, session, sessionLoading]);

  return (
    <SafeAreaView style={styles.safe}>
      <Screen scroll={false} atmosphere="hero" contentStyle={styles.screen}>
        <View style={styles.brand}>
          <View style={styles.mark}><Compass size={size.icon} color={colors.brand.primary} strokeWidth={1.75} /></View>
          <Text style={styles.wordmark}>Manhunt</Text>
          <Text style={styles.tagline}>The city is the arena.</Text>
        </View>
        <View style={styles.actions}>
          {error ? <InlineNotice message={error} tone="danger" /> : null}
          <Button label="Continue with Google" loading={loading} onPress={signIn} accessibilityLabel="Continue with Google" />
          <Text style={styles.legal}>Play safely. Respect the city and the people in it.</Text>
        </View>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  screen: { flex: 1, justifyContent: 'space-between', paddingTop: spacing[12], paddingBottom: spacing[6] },
  brand: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3] },
  mark: { width: size.avatarLarge, height: size.avatarLarge, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceBase, borderWidth: stroke.border, borderColor: colors.borderSubtle },
  wordmark: { color: colors.text.primary, fontFamily: typography.display, fontSize: fontSize['3xl'], lineHeight: lineHeight['3xl'], letterSpacing: tracking.tight },
  tagline: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.md, lineHeight: lineHeight.md },
  actions: { gap: spacing[4] },
  legal: { maxWidth: size.contentMax, alignSelf: 'center', color: colors.text.tertiary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, textAlign: 'center' },
});

