import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { QrCode } from 'lucide-react-native';
import { useJoinGame } from '@/lib/games/useGameLobby';
import { colors, fontSize, lineHeight, radius, size, spacing, stroke, tracking, typography } from '@/constants/theme';
import { AppIcon, Button, Field, InlineNotice, PageHeader, Screen } from '@/components/ui';

export default function JoinGameScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const joinGame = useJoinGame();
  const [code, setCode] = useState(params.code?.toUpperCase() ?? '');
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);

  async function join(value = code) {
    const fromLink = value.match(/[?&]code=([A-Za-z2-9]{6})/i)?.[1];
    const normalized = (fromLink ?? value).replace(/[^A-Za-z2-9]/g, '').toUpperCase();
    if (normalized.length !== 6) {
      setMessage('Enter the six-character lobby code.');
      return;
    }
    setMessage(null);
    try {
      const game = await joinGame.mutateAsync(normalized);
      router.replace({ pathname: '/(root)/lobby/[gameId]', params: { gameId: game.id } });
    } catch {
      setMessage('Could not join. Check the code and your connection, then try again.');
    }
  }

  async function openScanner() {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setMessage('Allow camera access to scan a lobby QR code.');
        return;
      }
    }
    setMessage(null);
    setScanning(true);
  }

  if (scanning) {
    return (
      <SafeAreaView style={styles.safe}>
        <Screen contentStyle={styles.scanScreen}>
          <PageHeader title="Scan invite" subtitle="Hold the QR code inside the frame." onBack={() => setScanning(false)} />
          <View style={styles.cameraWrap}>
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => { setScanning(false); void join(data); }}
            />
          </View>
          <Button label="Cancel scan" variant="secondary" onPress={() => setScanning(false)} />
        </Screen>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Screen contentStyle={styles.content}>
        <PageHeader title="Join a game" subtitle="Enter the invite code or scan the host's QR." onBack={() => router.back()} />
        <Field
          label="Lobby code" value={code}
          onChangeText={(value) => { setCode(value.toUpperCase()); setMessage(null); }}
          autoCapitalize="characters" autoCorrect={false} maxLength={6} placeholder="ABC234"
          style={styles.codeInput} accessibilityLabel="Six-character lobby code"
        />
        {message ? <InlineNotice message={message} tone="danger" /> : null}
        <View style={styles.actions}>
          <Button label="Join lobby" onPress={() => void join()} loading={joinGame.isPending} />
          <Button label="Scan QR code" variant="secondary" left={<AppIcon icon={QrCode} />} onPress={() => void openScanner()} />
        </View>
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  content: { paddingTop: spacing[3], gap: spacing[4] },
  codeInput: { minHeight: size.avatarLarge, fontFamily: typography.mono, fontSize: fontSize['2xl'], lineHeight: lineHeight['2xl'], letterSpacing: tracking.spaced, textAlign: 'center' },
  actions: { gap: spacing[3], marginTop: spacing[3] },
  scanScreen: { flex: 1, gap: spacing[4] },
  cameraWrap: { flex: 1, minHeight: size.scannerMinHeight, overflow: 'hidden', borderRadius: radius.lg, borderWidth: stroke.border, borderColor: colors.borderSubtle },
  camera: { flex: 1 },
});
