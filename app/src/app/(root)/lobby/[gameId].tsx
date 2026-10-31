import { useState } from 'react';
import { Alert, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BatteryLow, Check, Circle, Crown, Diamond, MapPinOff, MoreHorizontal, Share2, Shield, Signal, Sun, Triangle, UserRound } from 'lucide-react-native';
import { useSession } from '@/lib/auth/useSession';
import { useGameLobby, type LobbyPlayer } from '@/lib/games/useGameLobby';
import { useGameTracking } from '@/lib/location/useGameTracking';
import { colors, fontSize, lineHeight, size, spacing, tracking, typography } from '@/constants/theme';
import { AppIcon, Avatar, Button, Card, Chip, InlineNotice, PageHeader, Screen, SectionLabel, Sheet } from '@/components/ui';
import ErrorState from '@/components/ErrorState';
import LoadingState from '@/components/LoadingState';

function displayName(player: LobbyPlayer, players: LobbyPlayer[]) {
  const name = player.nickname || player.display_name;
  const same = players.filter((item) => (item.nickname || item.display_name) === name);
  return same.length > 1 ? `${name} (${same.findIndex((item) => item.user_id === player.user_id) + 1})` : name;
}

const ROLE_STYLE = {
  chaser: { icon: Diamond },
  runner: { icon: Circle },
  spectator: { icon: Triangle },
} as const;

export default function LobbyScreen() {
  const { gameId } = useLocalSearchParams<{ gameId: string }>();
  const router = useRouter();
  const { session } = useSession();
  const lobby = useGameLobby(gameId, session?.user.id);
  const game = lobby.data?.game;
  const players = lobby.data?.players ?? [];
  const isHost = game?.host_id === session?.user.id;
  const self = players.find((player) => player.user_id === session?.user.id);
  const [selectedPlayer, setSelectedPlayer] = useState<LobbyPlayer | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { tracking, gate } = useGameTracking(
    game?.id,
    game?.status,
    session?.user.id,
    self?.role,
  );

  const trackingStarted = ['countdown', 'head_start', 'active', 'paused'].includes(game?.status ?? '');
  const trackingMocked = tracking.mocked || !!self?.mock_detected_at;
  const gpsLabel =
    tracking.errorMessage ? 'GPS error'
      : tracking.phase === 'ready'
        ? tracking.isGpsFresh ? 'GPS ready' : 'GPS searching'
        : tracking.phase === 'warming'
          ? `GPS warm-up ${Math.min(tracking.warmupCount, 3)}/3`
          : 'GPS off';

  if (lobby.isLoading) return <LoadingState label="Opening lobby" />;
  if (lobby.isError || !game) {
    return <ErrorState message="The lobby may have ended or your connection was interrupted." onRetry={() => { void lobby.refetch(); }} />;
  }

  const shareCode = game.code;
  const shareLink = `manhunt://join-game?code=${shareCode}`;
  async function run(action: () => Promise<unknown>, failure: string) {
    try {
      setActionError(null);
      await action();
    } catch {
      setActionError(failure);
    }
  }
  async function shareInvite() {
    await Share.share({ message: `Join my Manhunt lobby with code ${shareCode}: ${shareLink}` });
  }
  async function assignRandomChaser() {
    const candidates = players.filter((player) => player.role !== 'spectator');
    if (!candidates.length) return;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    await run(async () => {
      for (const player of candidates) await lobby.setRole(player.user_id, player.user_id === chosen.user_id ? 'chaser' : 'runner');
    }, 'Could not assign roles. Try again.');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <Screen atmosphere="lobby" contentStyle={styles.content}>
        <View style={styles.topLine}>
          <Pressable onPress={() => Alert.alert('Leave lobby?', 'You can rejoin with the invite code.', [
            { text: 'Stay', style: 'cancel' },
            { text: 'Leave', style: 'destructive', onPress: () => router.replace('/(root)/home') },
          ])} accessibilityRole="button" accessibilityLabel="Leave lobby" style={styles.leaveButton}>
            <Text style={styles.leaveText}>Leave</Text>
          </Pressable>
          <Chip label={game.status.replace('_', ' ')} selected={game.status === 'lobby'} />
        </View>

        <PageHeader title={game.name} subtitle={`${game.mode} · ${game.settings.durationMinutes} min · ${game.settings.headStartSeconds} s head start`} />

        <Card>
          <View style={styles.inviteTop}>
            <View style={styles.codeBlock}>
              <Text style={styles.inviteLabel}>Invite code</Text>
              <Text style={styles.code}>{game.code}</Text>
            </View>
            <QRCode value={shareLink} size={size.qrCode} backgroundColor={colors.surfaceAlt} color={colors.text.primary} />
          </View>
          <Button label="Share invite" variant="secondary" left={<AppIcon icon={Share2} />} onPress={() => void shareInvite()} />
        </Card>

        <SectionLabel>Location</SectionLabel>
        {gate !== 'ok' ? (
          <Card>
            <InlineNotice
              message={gate === 'foreground_denied'
                ? 'Location permission is off. The game needs it to place you on the map — without it you cannot be found or tag anyone.'
                : 'Background location is off. The game still works while the app is open, but tracking stops when you lock the screen.'}
              tone={gate === 'foreground_denied' ? 'danger' : 'warning'}
            />
            <Button
              label="Set up location"
              variant={gate === 'foreground_denied' ? 'primary' : 'secondary'}
              style={styles.setupButton}
              onPress={() => router.push('/(root)/location-setup')}
            />
          </Card>
        ) : (
          <Card>
            <View style={styles.statusRow}>
              <Chip
                label={gpsLabel}
                icon={Signal}
                tone={tracking.errorMessage ? 'danger' : tracking.phase === 'ready' ? 'success' : 'neutral'}
              />
              {trackingStarted && tracking.serviceActive ? <Chip label="Background on" icon={Signal} tone="brand" /> : null}
              {trackingStarted && Platform.OS === 'ios' && !tracking.serviceActive ? <Chip label="Screen stays on · fallback" icon={Sun} tone="warning" /> : null}
              {tracking.batteryLevel !== null ? (
                <Chip
                  label={tracking.lowPower ? `Battery ${Math.round(tracking.batteryLevel)}% · saving` : `Battery ${Math.round(tracking.batteryLevel)}%`}
                  icon={BatteryLow}
                  tone={tracking.lowPower ? 'warning' : 'neutral'}
                />
              ) : null}
            </View>
            {trackingMocked ? <InlineNotice message="Mock GPS detected — your position is flagged for the host and not uploaded." tone="danger" /> : null}
            {trackingStarted && tracking.phase !== 'ready' ? (
              <InlineNotice message="Acquiring GPS… hold the phone near a window until the fix is ready." tone="info" />
            ) : null}
            {tracking.batteryOptimizationOn && trackingStarted ? (
              <InlineNotice message="Battery optimization is ON — Android may kill tracking mid-game. Disable it for Manhunt in system settings." tone="warning" />
            ) : null}
          </Card>
        )}

        <SectionLabel
          action={isHost && game.status === 'lobby'
            ? <Button label="Assign chaser" size="sm" variant="ghost" block={false} onPress={() => void assignRandomChaser()} />
            : undefined}
        >
          {`Players · ${players.length}`}
        </SectionLabel>
        {players.length ? (
          <Card padding="sm">
            {players.map((player, index) => (
              <PlayerRow
                key={player.user_id} player={player} name={displayName(player, players)}
                isSelf={player.user_id === session?.user.id} isGameHost={game.host_id === player.user_id}
                onManage={isHost && player.user_id !== session?.user.id ? () => setSelectedPlayer(player) : undefined}
                divider={index < players.length - 1}
              />
            ))}
          </Card>
        ) : (
          <Card><Text style={styles.emptyText}>No players have joined yet. Share the code to invite your crew.</Text></Card>
        )}

        {actionError ? <InlineNotice message={actionError} tone="danger" /> : null}

        <View style={styles.actionDock}>
          {game.status === 'lobby' ? (
            <Button
              label={self?.is_ready ? 'Ready' : 'Mark ready'}
              variant={self?.is_ready ? 'secondary' : 'primary'}
              left={self?.is_ready ? <AppIcon icon={Check} /> : undefined}
              loading={lobby.setReady.isPending}
              onPress={() => lobby.setReady.mutate()}
            />
          ) : null}
          {isHost && game.status === 'lobby' ? (
            <Button label="Start game" onPress={() => void run(() => lobby.start(false), 'Could not start the game. Check that everyone is ready.')} />
          ) : null}
          {isHost && ['countdown', 'head_start', 'active', 'paused'].includes(game.status) ? (
            <View style={styles.hostControls}>
              <Button
                size="md" variant="secondary" label={game.status === 'paused' ? 'Resume' : 'Pause'}
                onPress={() => void run(() => lobby.manage(game.status === 'paused' ? 'resume' : 'pause'), 'Could not update the game.')}
                style={styles.flexButton}
              />
              <Button
                size="md" variant="danger" label="End game" style={styles.flexButton}
                onPress={() => Alert.alert('End game?', 'This will end the game for everyone.', [
                  { text: 'Keep playing', style: 'cancel' },
                  { text: 'End game', style: 'destructive', onPress: () => void run(() => lobby.manage('end'), 'Could not end the game.') },
                ])}
              />
            </View>
          ) : null}
        </View>
      </Screen>

      <Sheet visible={!!selectedPlayer} onClose={() => setSelectedPlayer(null)} title={selectedPlayer ? displayName(selectedPlayer, players) : 'Manage player'}>
        {selectedPlayer ? (
          <View style={styles.sheetActions}>
            <Button label={selectedPlayer.role === 'runner' ? 'Make chaser' : 'Make runner'} variant="secondary" left={<AppIcon icon={Shield} />} onPress={() => {
              void run(() => lobby.setRole(selectedPlayer.user_id, selectedPlayer.role === 'runner' ? 'chaser' : 'runner'), 'Could not change the role.').then(() => setSelectedPlayer(null));
            }} />
            <Button label="Transfer host" variant="secondary" left={<AppIcon icon={Crown} />} onPress={() => {
              Alert.alert('Transfer host?', `${displayName(selectedPlayer, players)} will manage this lobby.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Transfer', onPress: () => { void run(() => lobby.manage('transfer_host', selectedPlayer.user_id), 'Could not transfer host.').then(() => setSelectedPlayer(null)); } },
              ]);
            }} />
            <Button label="Remove player" variant="danger" left={<AppIcon icon={UserRound} color={colors.critical} />} onPress={() => {
              Alert.alert('Remove player?', `${displayName(selectedPlayer, players)} will leave this lobby.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Remove', style: 'destructive', onPress: () => { void run(() => lobby.manage('kick', selectedPlayer.user_id), 'Could not remove player.').then(() => setSelectedPlayer(null)); } },
              ]);
            }} />
          </View>
        ) : null}
      </Sheet>
    </SafeAreaView>
  );
}

function PlayerRow({ player, name, isSelf, isGameHost, onManage, divider }: {
  player: LobbyPlayer; name: string; isSelf: boolean; isGameHost: boolean; onManage?: () => void; divider: boolean;
}) {
  const role = ROLE_STYLE[player.role];
  return (
    <View style={[styles.playerRow, divider && styles.playerDivider]}>
      <Avatar name={name} imageUrl={player.avatar_url} size={size.avatarMedium} color={player.marker_color ?? colors.surfaceAlt} />
      <View style={styles.playerCopy}>
        <Text style={styles.playerName} numberOfLines={2}>{name}{isSelf ? ' · You' : ''}</Text>
        <View style={styles.playerMeta}>
          <Chip label={player.role} icon={role.icon} tone={player.role} />
          {player.is_ready ? <Chip label="Ready" icon={Check} tone="success" /> : null}
          {isGameHost ? <Chip label="Host" icon={Crown} /> : null}
          {player.mock_detected_at ? <Chip label="Mock GPS" icon={MapPinOff} tone="danger" /> : null}
        </View>
      </View>
      {onManage ? (
        <Pressable onPress={onManage} accessibilityRole="button" accessibilityLabel={`Manage ${name}`} hitSlop={spacing[2]} style={styles.manageButton}>
          <AppIcon icon={MoreHorizontal} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  content: { paddingTop: spacing[3], gap: spacing[3] },
  topLine: { minHeight: size.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  leaveButton: { minHeight: size.touch, justifyContent: 'center', paddingRight: spacing[4] },
  leaveText: { color: colors.text.secondary, fontFamily: typography.bodySemiBold, fontSize: fontSize.base, lineHeight: lineHeight.base },
  inviteTop: { minHeight: size.avatarLarge, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[4], paddingBottom: spacing[4] },
  codeBlock: { flex: 1, gap: spacing[2] },
  inviteLabel: { color: colors.text.secondary, fontFamily: typography.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeight.xs, letterSpacing: tracking.label, textTransform: 'uppercase' },
  code: { color: colors.text.primary, fontFamily: typography.mono, fontSize: fontSize['2xl'], lineHeight: lineHeight['2xl'], letterSpacing: tracking.code, fontVariant: ['tabular-nums'] },
  playerRow: { minHeight: size.row, flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  playerDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  playerCopy: { flex: 1, gap: spacing[2] },
  playerName: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.md, lineHeight: lineHeight.md },
  playerMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  manageButton: { minWidth: size.touch, minHeight: size.touch, alignItems: 'center', justifyContent: 'center' },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], paddingRight: spacing[4] },
  setupButton: { marginTop: spacing[3] },
  emptyText: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.base, lineHeight: lineHeight.base },
  actionDock: { marginTop: 'auto', gap: spacing[3], paddingTop: spacing[4] },
  hostControls: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  flexButton: { flexGrow: 1, flexBasis: size.buttonLarge * 2 },
  sheetActions: { gap: spacing[3] },
});
