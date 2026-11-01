/**
 * Host rules sheet (Phases 5 + 6): catch radius, catch variant, confirm
 * window, immunity, cooldown, auto-catch dwell, boundary penalty, grace,
 * warning distance and the "Edit play area" entry point.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MapPinned, Save } from 'lucide-react-native';
import { colors, fontSize, lineHeight, spacing, typography } from '@/constants/theme';
import { Button, Chip, Toggle } from '@/components/ui';
import { Stepper } from '@/components/game/Stepper';
import { supabase } from '@/lib/supabase/client';
import type { BoundaryPenalty, GameSettings, TagMode } from '@/types/database';

const TAG_MODES: { value: TagMode; label: string }[] = [
  { value: 'tap', label: 'Tap to tag' },
  { value: 'confirm', label: 'Runner confirms' },
  { value: 'qr', label: 'QR code' },
  { value: 'auto', label: 'Auto-catch' },
  { value: 'honor', label: 'Honor system' },
];

const PENALTIES: { value: BoundaryPenalty; label: string }[] = [
  { value: 'reveal', label: 'Reveal to chasers' },
  { value: 'time', label: 'Time penalty' },
  { value: 'disqualify', label: 'Disqualify' },
  { value: 'points', label: 'Lose points' },
];

export function HostSettingsSheet({ visible, onClose, gameId, settings, hostId, onSaved }: {
  visible: boolean;
  onClose: () => void;
  gameId: string;
  settings: GameSettings;
  hostId: string | undefined;
  onSaved: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<GameSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { error: rpcError } = await supabase.from('games').update({ settings: draft }).eq('id', gameId);
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      setSaved('Rules saved.');
      onSaved();
      setTimeout(onClose, 700);
    } finally {
      setSaving(false);
    }
  };

  const set = (patch: Partial<GameSettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.caption}>Applies from the next game start. Live games keep their running rules.</Text>

      <Text style={styles.section}>Catch rules</Text>
      <View style={styles.chipRow}>
        {TAG_MODES.map((m) => (
          <Chip key={m.value} label={m.label} selected={draft.tagMode === m.value} onPress={() => set({ tagMode: m.value })} />
        ))}
      </View>
      <Stepper label="Catch radius" value={draft.catchRadiusM} step={5} min={5} max={100} unit="m"
        hint="Chaser must be within this to tag" onChange={(v) => set({ catchRadiusM: v })} />
      {draft.tagMode === 'confirm' ? (
        <Stepper label="Confirm window" value={draft.confirmWindowS} step={1} min={3} max={30} unit="s"
          hint="Runner must respond; silence auto-accepts" onChange={(v) => set({ confirmWindowS: v })} />
      ) : null}
      {draft.tagMode === 'auto' ? (
        <Stepper label="Auto-catch dwell" value={draft.autoCatchSeconds} step={5} min={5} max={120} unit="s"
          hint="Time within radius before an auto catch" onChange={(v) => set({ autoCatchSeconds: v })} />
      ) : null}
      <Stepper label="Immunity after catch" value={draft.immunitySeconds} step={1} min={10} max={20} unit="s"
        onChange={(v) => set({ immunitySeconds: v })} />
      <Stepper label="Failed-tag cooldown" value={draft.cooldownS} step={1} min={0} max={30} unit="s"
        hint="Spam guard after a rejected tag" onChange={(v) => set({ cooldownS: v })} />
      <Toggle
        label="Infection mode"
        hint="Caught runners become chasers"
        value={draft.infectionMode}
        onValueChange={(v) => set({ infectionMode: v })}
      />

      <Text style={styles.section}>Play boundary</Text>
      <Button
        variant="secondary"
        label="Edit play area on the map"
        left={hostId ? <MapPinned color={colors.text.primary} size={16} /> : undefined}
        onPress={() => {
          onClose();
          router.push(`/(root)/area-editor/${gameId}`);
        }}
        size="sm"
        block={false}
      />
      <Text style={styles.section}>Boundary behaviour</Text>
      <View style={styles.chipRow}>
        {PENALTIES.map((p) => (
          <Chip key={p.value} label={p.label} selected={draft.boundaryPenalty === p.value} onPress={() => set({ boundaryPenalty: p.value })} />
        ))}
      </View>
      <Stepper label="Grace period outside" value={draft.boundaryGraceS} step={5} min={0} max={120} unit="s"
        onChange={(v) => set({ boundaryGraceS: v })} />
      <Stepper label="Early warning at" value={draft.boundaryWarningM} step={10} min={10} max={200} unit="m"
        hint="Distance from the edge that triggers the warning" onChange={(v) => set({ boundaryWarningM: v })} />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.saved}>{saved}</Text> : null}
      <Button
        variant="primary"
        label="Save rules"
        left={<Save color={colors.accentText} size={16} />}
        onPress={() => { void save(); }}
        loading={saving}
        disabled={saving}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing[2], paddingVertical: spacing[2] },
  caption: { color: colors.text.tertiary, fontFamily: typography.body, fontSize: fontSize.xs, lineHeight: lineHeight.xs },
  section: {
    color: colors.text.primary,
    fontFamily: typography.bodySemiBold,
    fontSize: fontSize.sm,
    lineHeight: lineHeight.sm,
    marginTop: spacing[2],
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  error: { color: colors.status.danger, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  saved: { color: colors.status.success, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
});
