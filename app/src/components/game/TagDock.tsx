/**
 * Phase 5 tag & catch dock: the big hold-to-tag button with the proximity
 * ring, haptic pulses, cooldown and failure copy — plus the variant surfaces
 * (honor "I'm caught", rotating runner QR, chaser QR scanner entry).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Svg, { Circle } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import { Fingerprint, Scan, ShieldOff, Timer } from 'lucide-react-native';
import { colors, fontSize, lineHeight, radius, size, spacing, stroke, typography } from '@/constants/theme';
import { AppIcon, Button, InlineNotice } from '@/components/ui';
import type { GameSettings, GameStatus, PlayerRole, PlayerStatus } from '@/types/database';
import {
  canTag,
  holdProgress,
  pulseIntervalMs,
  proximityProgress,
  tagEnvelopeM,
} from '@/lib/tag/tagModel';
import type { useTagging } from '@/lib/tag/useTagging';
import { useMyQrToken } from '@/lib/tag/useTagging';
import { QrScannerSheet } from './QrScanner';
import type { BoundaryUiState } from '@/lib/area/useBoundary';

export interface TagDockProps {
  gameId: string;
  gameStatus: GameStatus;
  myRole: PlayerRole | undefined;
  myStatus: PlayerStatus | undefined;
  settings: GameSettings;
  /** HUD's nearest opponent hint (targetId + distanceM). */
  target: { targetId: string; distanceM: number } | null;
  /** Accuracy of the target's latest fix (drives the envelope estimate). */
  targetAccuracyM: number | null;
  /** Latest self fix: what we submit with the tag request. */
  lastFix: {
    latitude: number;
    longitude: number;
    accuracy: number | null;
    timestamp: number;
  } | null;
  tagging: ReturnType<typeof useTagging>;
  /** Boundary state — reads the tag dock calm while paused by GPS. */
  boundary?: BoundaryUiState;
}

export function TagDock(props: TagDockProps) {
  const { gameStatus, myRole, myStatus, settings, tagging } = props;

  // -- runners (non-chasers) never see this dock; honor variant shows their button
  const isRunnerUI = myRole === 'runner';

  if (gameStatus !== 'active') {
    if (gameStatus === 'head_start' || gameStatus === 'countdown') {
      if (isRunnerUI) return null;
      return (
        <View style={styles.wrap}>
          <InlineNotice message="Head start — tagging unlocks when the game activates." tone="info" />
        </View>
      );
    }
    return null;
  }

  if (!myStatus || myStatus !== 'active') {
    if (myStatus === 'tagged') return null; // out of the hunt, stay quiet
    if (isRunnerUI && settings.tagMode === 'honor') {
      return (
        <View style={styles.wrap}>
          <Button
            variant="danger"
            label="I'm caught"
            left={<AppIcon icon={ShieldOff} color={colors.accentText} />}
            onPress={() => { void tagging.honorCatch(); }}
            disabled={tagging.submitting}
          />
          {tagging.failure ? <InlineNotice message={tagging.failure} tone="warning" /> : null}
        </View>
      );
    }
    return null;
  }

  if (isRunnerUI) {
    return <RunnerDock settings={settings} gameId={props.gameId} tagging={tagging} />;
  }
  if (myRole === 'chaser') {
    return (
      <ChaserDock
        settings={props.settings}
        gameStatus={props.gameStatus}
        myRole={props.myRole}
        myStatus={props.myStatus}
        target={props.target}
        targetAccuracyM={props.targetAccuracyM}
        lastFix={props.lastFix}
        tagging={props.tagging}
        disabled={props.myStatus !== 'active'}
        gameId={props.gameId}
      />
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Runner: honor + rotating QR
// ---------------------------------------------------------------------------

function RunnerDock({ settings, gameId, tagging }: {
  settings: TagDockProps['settings'];
  gameId: string;
  tagging: TagDockProps['tagging'];
}) {
  const qrEnabled = settings.tagMode === 'qr';
  const token = useMyQrToken(gameId, qrEnabled);

  if (settings.tagMode === 'honor') {
    return (
      <View style={styles.wrap}>
        <Button
          variant="danger"
          label="I'm caught"
          left={<AppIcon icon={ShieldOff} color={colors.accentText} />}
          onPress={() => { void tagging.honorCatch(); }}
          disabled={tagging.submitting}
        />
        {tagging.failure ? <InlineNotice message={tagging.failure} tone="warning" /> : null}
        {tagging.success ? <InlineNotice message="You tagged yourself out. Nice run." tone="success" /> : null}
      </View>
    );
  }

  if (qrEnabled) {
    return (
      <View style={styles.wrap}>
        <View style={styles.qrCard}>
          {token?.token ? (
            <>
              <QRCode
                value={token.token}
                size={120}
                color={colors.text.primary}
                backgroundColor="transparent"
              />
              <Text style={styles.qrMeta}>
                Show to the chaser · {Math.max(1, Math.ceil(token.expiresInS))}s
              </Text>
            </>
          ) : (
            <Text style={styles.qrMeta}>Getting your rotating code…</Text>
          )}
        </View>
        {tagging.failure ? <InlineNotice message={tagging.failure} tone="warning" /> : null}
      </View>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Chaser: the hold-to-tag button with proximity ring + pulses
// ---------------------------------------------------------------------------

function ChaserDock(props: ChaserDockArgs) {
  const { settings, target, targetAccuracyM, lastFix, tagging, disabled } = props;

  const envelope = useMemo(() => {
    if (!target) return settings.catchRadiusM;
    return tagEnvelopeM({
      radiusM: settings.catchRadiusM,
      chaserAccuracyM: lastFix?.accuracy ?? null,
      runnerAccuracyM: targetAccuracyM,
    });
  }, [target, settings.catchRadiusM, lastFix?.accuracy, targetAccuracyM]);

  const inRange = target !== null && canTag(target.distanceM, envelope);
  const proximity = target ? proximityProgress(target.distanceM, envelope) : 0;

  // ---- hold to tag -----------------------------------------------------------
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdStartRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const pulseTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHold = useCallback(() => {
    if (pulseTimerRef.current) { clearInterval(pulseTimerRef.current); pulseTimerRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    holdStartRef.current = null;
    firedRef.current = false;
    setHolding(false);
    setProgress(0);
  }, []);

  const fireTag = useCallback(() => {
    if (firedRef.current || !target || !lastFix) return;
    firedRef.current = true;
    stopHold();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    void tagging.tagRunner({
      runnerId: target.targetId,
      lat: lastFix.latitude,
      lng: lastFix.longitude,
      accuracyM: lastFix.accuracy,
      fixTimestampMs: lastFix.timestamp,
    });
  }, [target, lastFix, stopHold, tagging]);

  const beginHold = useCallback(() => {
    if (disabled || tagging.submitting || tagging.cooldownMs > 0) return;
    if (!target || lastFix === null || !inRange) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      return;
    }
    firedRef.current = false;
    holdStartRef.current = Date.now();
    setHolding(true);
    // haptic pulse cadence tightens as the chaser closes in
    let lastInterval = pulseIntervalMs(proximity);
    pulseTimerRef.current = setInterval(() => {
      const next = pulseIntervalMs(proximity);
      if (next !== lastInterval && pulseTimerRef.current) {
        clearInterval(pulseTimerRef.current);
        pulseTimerRef.current = setInterval(() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
        }, next);
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    }, lastInterval);
    // hold progress ticker; fires the tag at the threshold
    tickRef.current = setInterval(() => {
      if (holdStartRef.current === null) return;
      const p = holdProgress(holdStartRef.current, Date.now());
      setProgress(p);
      if (p >= 1) fireTag();
    }, 50);
  }, [disabled, tagging.submitting, tagging.cooldownMs, target, lastFix, inRange, proximity, fireTag]);

  useEffect(() => stopHold, [stopHold]);

  const cooldownLabel = tagging.cooldownMs > 0 ? `${Math.ceil(tagging.cooldownMs / 1000)}s` : null;

  return (
    <View style={styles.wrap}>
      {tagging.failure ? (
        <InlineNotice message={tagging.failure} tone="warning" />
      ) : null}
      {tagging.queued > 0 ? (
        <InlineNotice message={`${tagging.queued} tag${tagging.queued > 1 ? 's' : ''} waiting to send — you'll reconnect automatically.`} tone="info" />
      ) : null}
      <View style={styles.ringWrap}>
        <Svg width={PROXIMITY_SIZE} height={PROXIMITY_SIZE}>
          {/* track */}
          <Circle
            cx={PROXIMITY_SIZE / 2}
            cy={PROXIMITY_SIZE / 2}
            r={RING_R}
            stroke={colors.borderStrong ?? colors.borderSubtle}
            strokeWidth={stroke.border * 2}
            fill="none"
          />
          {/* proximity fill */}
          <Circle
            cx={PROXIMITY_SIZE / 2}
            cy={PROXIMITY_SIZE / 2}
            r={RING_R}
            stroke={inRange ? colors.status.danger : colors.text.secondary}
            strokeWidth={stroke.border * 3}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${proximity * CIRC} ${CIRC}`}
            transform={`rotate(-90 ${PROXIMITY_SIZE / 2} ${PROXIMITY_SIZE / 2})`}
          />
          {/* hold-to-fire inner ring */}
          <Circle
            cx={PROXIMITY_SIZE / 2}
            cy={PROXIMITY_SIZE / 2}
            r={RING_R - 10}
            stroke={colors.text.primary}
            strokeWidth={stroke.border}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${progress * (CIRC - 60)} ${CIRC}`}
            transform={`rotate(-90 ${PROXIMITY_SIZE / 2} ${PROXIMITY_SIZE / 2})`}
          />
        </Svg>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tag the runner"
          style={[
            styles.tagButton,
            inRange && !disabled && tagging.cooldownMs <= 0 ? styles.tagButtonReady : null,
          ]}
          onPressIn={beginHold}
          onPressOut={stopHold}
          disabled={disabled || tagging.submitting}
        >
          {tagging.submitting ? (
            <Text style={styles.tagButtonText}>Tagging…</Text>
          ) : cooldownLabel ? (
            <>
              <AppIcon icon={Timer} color={colors.text.primary} size={size.icon} />
              <Text style={styles.tagButtonText}>{cooldownLabel}</Text>
            </>
          ) : (
            <>
              <AppIcon icon={Fingerprint} color={colors.text.primary} size={size.icon} />
              <Text style={styles.tagButtonText}>{holding ? 'Tagging…' : 'Hold to tag'}</Text>
            </>
          )}
        </Pressable>
      </View>
      <Text style={styles.hintText}>
        {target
          ? inRange
            ? `Runner ${Math.round(target.distanceM)} m away — hold 0.5 s.`
            : `Runner ${Math.round(target.distanceM)} m away — close in to ${Math.round(settings.catchRadiusM)} m.`
          : 'No runner nearby yet.'}
      </Text>
      {settings.tagMode === 'qr' ? <QrScanFallback tagging={tagging} lastFix={lastFix} /> : null}
    </View>
  );
}

interface ChaserDockArgs extends TagDockProps {
  disabled: boolean;
}

const PROXIMITY_SIZE = 168;
const RING_R = PROXIMITY_SIZE / 2 - 8;
const CIRC = 2 * Math.PI * RING_R;

// ---------------------------------------------------------------------------
// QR: scanner sheet + manual token fallback
// ---------------------------------------------------------------------------

function QrScanFallback({ tagging, lastFix }: {
  tagging: TagDockProps['tagging'];
  lastFix: TagDockProps['lastFix'];
}) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manual, setManual] = useState(false);
  const [token, setToken] = useState('');

  const submit = (value: string) => {
    if (!lastFix) return;
    void tagging.qrTag({
      token: value,
      lat: lastFix.latitude,
      lng: lastFix.longitude,
      accuracyM: lastFix.accuracy,
      fixTimestampMs: lastFix.timestamp,
    });
  };

  return (
    <View style={styles.qrRow}>
      <View style={styles.qrButtons}>
        <Button
          variant="secondary"
          label="Scan code"
          left={<AppIcon icon={Scan} color={colors.text.primary} />}
          onPress={() => setScannerOpen(true)}
          size="sm"
          block={false}
        />
        <Button variant="ghost" label="Type code" onPress={() => setManual((m) => !m)} size="sm" block={false} />
      </View>
      {manual ? (
        <View style={styles.qrManual}>
          <TextInput
            style={styles.qrInput}
            placeholder="e.g. 4F2A91C0"
            placeholderTextColor={colors.text.tertiary}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={8}
            value={token}
            onChangeText={(t) => setToken(t.toUpperCase())}
          />
          <Button
            variant="primary"
            label="Tag"
            left={<AppIcon icon={Scan} color={colors.accentText} />}
            disabled={token.length !== 8 || tagging.submitting || !lastFix}
            onPress={() => submit(token)}
            size="sm"
            block={false}
          />
        </View>
      ) : null}
      <Modal visible={scannerOpen} transparent={false} animationType="slide">
        <QrScannerSheet
          onClose={() => setScannerOpen(false)}
          onScanned={(value) => {
            setScannerOpen(false);
            submit(value);
          }}
        />
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  ringWrap: { alignItems: 'center', justifyContent: 'center', width: PROXIMITY_SIZE, height: PROXIMITY_SIZE },
  tagButton: {
    position: 'absolute',
    width: PROXIMITY_SIZE - 56,
    height: PROXIMITY_SIZE - 56,
    borderRadius: (PROXIMITY_SIZE - 56) / 2,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    borderWidth: 2,
    borderColor: colors.borderSubtle,
  },
  tagButtonReady: { borderColor: colors.status.danger },
  tagButtonText: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  hintText: { color: colors.text.tertiary, fontFamily: typography.body, fontSize: fontSize.xs, lineHeight: lineHeight.xs, textAlign: 'center' },
  qrCard: { alignItems: 'center', gap: spacing[2], backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: stroke.border, borderColor: colors.borderSubtle, padding: spacing[3] },
  qrMeta: { color: colors.text.tertiary, fontFamily: typography.body, fontSize: fontSize.xs, lineHeight: lineHeight.xs },
  qrRow: { alignItems: 'center', gap: spacing[2], width: '100%' },
  qrButtons: { flexDirection: 'row', gap: spacing[2] },
  qrManual: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], width: '100%' },
  qrInput: {
    flex: 1,
    minHeight: size.buttonSmall,
    borderRadius: radius.sm,
    borderWidth: stroke.border,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceAlt,
    color: colors.text.primary,
    fontSize: fontSize.sm,
    fontFamily: typography.body,
    paddingHorizontal: spacing[2],
  },
});

export { };
