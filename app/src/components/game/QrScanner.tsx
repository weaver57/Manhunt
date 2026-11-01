/**
 * Full-screen QR scanner used by the chaser in QR-tag mode. Scans the
 * runner's rotating 8-character token; permission is requested inline.
 */
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { BarcodeScanningResult } from 'expo-camera';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { colors, fontSize, lineHeight, spacing, typography } from '@/constants/theme';
import { AppIcon, Button } from '@/components/ui';

export function QrScannerSheet({ onClose, onScanned }: {
  onClose: () => void;
  onScanned: (token: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const lockRef = useRef(false);

  const handleBarcode = (event: BarcodeScanningResult) => {
    if (lockRef.current) return;
    const token = (event.data ?? '').trim().toUpperCase();
    if (!/^[A-F0-9]{8}$/.test(token)) return; // not a tag token
    lockRef.current = true;
    onScanned(token);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.top}>
        <Text style={styles.title}>Scan the runner's code</Text>
        <Button
          variant="ghost"
          label="Close"
          left={<AppIcon icon={X} color={colors.text.secondary} />}
          onPress={onClose}
          size="sm"
          block={false}
        />
      </View>
      <View style={styles.cameraHost}>
        {permission?.granted ? (
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcode}
          />
        ) : permission ? (
          <View style={styles.center}>
            <Text style={styles.note}>Camera access is off. Enable it to scan the runner's code.</Text>
            <Button variant="secondary" label="Enable camera" onPress={() => { void requestPermission(); }} />
          </View>
        ) : (
          <View style={styles.center}>
            <Text style={styles.note}>Opening camera…</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base, padding: spacing[3], gap: spacing[3] },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.md, lineHeight: lineHeight.md },
  cameraHost: { flex: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  camera: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3] },
  note: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, textAlign: 'center', maxWidth: 260 },
});
