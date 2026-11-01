/**
 * Catch-banners (Phase 5):
 *  - runner: confirm/dispute prompt during the confirm window;
 *  - host: dispute-review card with uphold / reverse actions.
 */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Check, Undo2 } from 'lucide-react-native';
import { colors, fontSize, lineHeight, spacing, typography } from '@/constants/theme';
import { AppIcon, Button, Card } from '@/components/ui';
import type { useTagging } from '@/lib/tag/useTagging';
import { usePendingConfirm, useDisputedTags } from '@/lib/tag/useTagging';
import { confirmRemainingS } from '@/lib/tag/tagModel';

// ---------------------------------------------------------------------------
// Runner: "Caught?" confirm / dispute
// ---------------------------------------------------------------------------

export function RunnerConfirmBanner({ gameId, runnerId, active, tagging, setupWindowS }: {
  gameId: string | undefined;
  runnerId: string | undefined;
  active: boolean;
  tagging: ReturnType<typeof useTagging>;
  setupWindowS: number;
}) {
  const pendingQuery = usePendingConfirm(gameId, runnerId, active);
  const pending = pendingQuery.data;
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) {
      setSecondsLeft(null);
      return;
    }
    // tick from the catch timestamp (server-authored; the local window just
    // mirrors it — resolve_pending_tags auto-accepts on the server anyway)
    const requested = Date.parse(pending.requested_at);
    const tick = () => setSecondsLeft(confirmRemainingS(Date.now(), requested, setupWindowS));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [pending, setupWindowS]);

  if (!pending || !gameId) return null;

  const answer = async (accept: boolean) => {
    setBusy(true);
    try {
      if (accept) {
        await tagging.confirmCapture(pending.id, true);
      } else {
        await tagging.confirmCapture(pending.id, false);
      }
    } finally {
      setBusy(false);
      void pendingQuery.refetch();
    }
  };

  return (
    <View style={styles.bannerWrap}>
      <Card padding="md" accentEdge>
        <Text style={styles.title}>Caught?</Text>
        <Text style={styles.note}>
          {secondsLeft != null
            ? `A chaser tagged you nearby — ${secondsLeft}s to respond. No answer is treated as accepted.`
            : 'A chaser tagged you nearby. Accept or dispute.'}
        </Text>
        <View style={styles.row}>
          <Button
            variant="primary"
            label="It's fair"
            left={<AppIcon icon={Check} color={colors.accentText} />}
            onPress={() => { void answer(true); }}
            disabled={busy}
            size="sm"
            block={false}
          />
          <Button
            variant="secondary"
            label="Dispute"
            onPress={() => { void answer(false); }}
            disabled={busy}
            size="sm"
            block={false}
          />
        </View>
      </Card>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Host: dispute review
// ---------------------------------------------------------------------------

export function HostDisputeBanner({ gameId, isHost, tagging }: {
  gameId: string | undefined;
  isHost: boolean;
  tagging: ReturnType<typeof useTagging>;
}) {
  const disputes = useDisputedTags(gameId, isHost);
  if (!isHost || !gameId || !disputes.data?.length) return null;

  return (
    <View style={styles.bannerWrap}>
      {disputes.data.map((tag) => (
        <Card key={tag.id} padding="md" tone="outline">
          <Text style={styles.title}>Catch disputed</Text>
          <Text style={styles.note}>
            A runner disputes a catch{' '}
            {tag.distance_m != null ? `(server distance: ${Math.round(tag.distance_m)} m)` : ''}
            {tag.method ? ` · via ${tag.method}` : ''}. Decide whether it stands.
          </Text>
          <View style={styles.row}>
            <Button
              variant="primary"
              label="Keep the catch"
              left={<AppIcon icon={Check} color={colors.accentText} />}
              onPress={() => { void tagging.reviewCapture(tag.id, false); }}
              size="sm"
              block={false}
            />
            <Button
              variant="secondary"
              label="Reverse it"
              left={<AppIcon icon={Undo2} color={colors.text.primary} />}
              onPress={() => { void tagging.reviewCapture(tag.id, true); }}
              size="sm"
              block={false}
            />
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = {
  bannerWrap: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[1] },
  row: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] },
  title: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.md, lineHeight: lineHeight.md },
  note: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, marginTop: spacing[1] },
} as const;
