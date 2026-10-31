import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { BatteryLow, MapPinOff, Navigation, Layers, ShieldAlert } from 'lucide-react-native';
import { colors, fontSize, lineHeight, spacing, typography } from '@/constants/theme';
import { Button, InlineNotice, PageHeader, Screen, SectionLabel } from '@/components/ui';
import {
  openSystemSettings,
  requestGamePermissions,
  resolvePermissionState,
} from '@/lib/location/permissions';
import { getBatteryStatus, type BatteryStatus } from '@/lib/location/battery';

/**
 * Location gate: blocking explanation + recovery flow.
 * Rendered whenever a lobby needs tracking but permissions are missing,
 * and reachable from the profile/home screens for pre-flight setup.
 */
export default function LocationSetupScreen() {
  const router = useRouter();
  const [state, setState] = useState<Awaited<ReturnType<typeof resolvePermissionState>> | null>(null);
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  const [requesting, setRequesting] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    const [nextState, nextBattery] = await Promise.all([
      resolvePermissionState().catch(() => null),
      getBatteryStatus().catch(() => null),
    ]);
    if (nextState) setState(nextState);
    setBattery(nextBattery);
  }

  async function request() {
    setRequesting(true);
    try {
      const next = await requestGamePermissions();
      setState(next);
      if (next.foregroundGranted) {
        // User resolved the issue — return to the lobby which re-checks the gate.
        router.back();
      }
    } finally {
      setRequesting(false);
    }
  }

  const foregroundBlocked = state ? !state.foregroundGranted : false;
  const backgroundMissingIOS = Platform.OS === 'ios' && state?.foregroundGranted === true && state?.backgroundGranted === false;
  const backgroundMissingAndroid = Platform.OS === 'android' && state?.foregroundGranted === true && state?.backgroundGranted === false;
  const showBattery = Platform.OS === 'android' && battery?.optimizationOn === true;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Screen scroll contentStyle={styles.content}>
        <PageHeader
          eyebrow="Location is required"
          title="Manhunt runs on your GPS"
          subtitle="Your position makes the live map work — chasers find you, teammates see progress, and tags are validated with the same fixes."
        />

        {foregroundBlocked ? (
          <InlineNotice message="Location is currently denied, so no game can start on this phone." tone="danger" />
        ) : null}

        <CardBlock
          icon={Navigation}
          title="Track my position"
          body="While you are in a game, Manhunt reads your GPS so everyone can see you on the map. It checks accuracy, ignores unrealistic jumps, and never stores your location after the game ends."
        />

        <CardBlock
          icon={MapPinOff}
          title="Background location"
          body={
            Platform.OS === 'android'
              ? 'The app keeps tracking in the background through a notification that says "Manhunt is tracking your location". Allow "All the time" if asked.'
              : 'Allow "Always" so the app keeps tracking with the screen locked and the phone in your pocket.'
          }
        />

        {backgroundMissingIOS ? (
          <InlineNotice message="You granted “While using”. Tracking pauses when the app is closed — keep the screen on during the game, or set location to “Always” for proper pocket play." tone="warning" />
        ) : null}

        {showBattery ? (
          <CardBlock
            icon={BatteryLow}
            title="Battery optimization"
            body="Android may close the tracker to save power. Go to Settings → Apps → Manhunt → Battery and choose “Unrestricted” so tracking survives the whole game."
          />
        ) : null}

        <CardBlock
          icon={Layers}
          title="Accuracy"
          body="Urban canyons and tall buildings drift your dot. Poor fixes are dropped above 30 m accuracy, and the map keeps your last good fix. GPS needs a short warm-up before the game counts you as ready."
        />

        <SectionLabel>Privacy</SectionLabel>
        <CardBlock
          icon={ShieldAlert}
          title="Mock GPS detection"
          body="If a fake-GPS app is detected while a game is running, your row is flagged and visible to the host. Mocked positions are never uploaded."
        />

        {backgroundMissingIOS ? (
          <InlineNotice message="You granted “While using”. Tracking pauses when the app is closed — keep the screen on during the game, or set location to “Always” for proper pocket play." tone="warning" />
        ) : null}
        {backgroundMissingAndroid ? (
          <InlineNotice message="Background permission was not granted. The app can still track while it stays open, and the location notification keeps the tracker alive when started from the game screen." tone="warning" />
        ) : null}

        <View style={styles.actions}>
          <Button
            label={foregroundBlocked ? 'Enable location' : 'Re-check permissions'}
            onPress={() => {
              if (foregroundBlocked && (state?.canAskAgain ?? true)) {
                void request();
              } else {
                openSystemSettings();
              }
            }}
            loading={requesting}
          />
          <Button variant="secondary" label="Open app settings" onPress={openSystemSettings} />
          <Button variant="ghost" label="Back" onPress={() => router.back()} />
        </View>
      </Screen>
    </SafeAreaView>
  );
}

function CardBlock({ icon: Icon, title, body }: { icon: typeof Navigation; title: string; body: string }) {
  return (
    <View style={styles.block}>
      <View style={styles.iconBox}><Icon size={22} color={colors.brand.primary} /></View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  content: { gap: spacing[3] },
  block: { flexDirection: 'row', gap: spacing[3], alignItems: 'flex-start' },
  iconBox: { minWidth: spacing[12], alignItems: 'center', paddingTop: spacing[1] },
  copy: { flex: 1, gap: spacing[1] },
  title: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.md, lineHeight: lineHeight.md },
  subtitle: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.base, lineHeight: lineHeight.base },
  actions: { gap: spacing[3], marginTop: spacing[6] },
});
