/**
 * Phase 6 area editor (host-only): pick the boundary type, draw it on the
 * map, tune the shrink schedule, add no-go zones, save/play and reuse saved
 * templates. Persists straight into games.settings (host RLS).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapView, Camera } from '@maplibre/maplibre-react-native';
import type { Feature, GeoJsonProperties, Geometry } from 'geojson';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Plus, Save, Trash2, Undo2 } from 'lucide-react-native';
import { colors, fontSize, lineHeight, mapGlass, radius, spacing, stroke, typography } from '@/constants/theme';
import { AppIcon, Button, Chip, Field, InlineNotice, PageHeader, SectionLabel } from '@/components/ui';
import LoadingState from '@/components/LoadingState';
import ErrorState from '@/components/ErrorState';
import { useSession } from '@/lib/auth/useSession';
import { useGameLobby } from '@/lib/games/useGameLobby';
import { useTrackingStore } from '@/lib/location/useTrackingStore';
import { stylesForKey, configuredMapTilerKey, isUrlStyle } from '@/lib/map/styles';
import { PlayAreaOverlay } from '@/components/map/PlayAreaOverlay';
import { supabase } from '@/lib/supabase/client';
import {
  areaSizeKm2,
  validateArea,
  validateNoGoZones,
  type AreaValidation,
} from '@/lib/area/areaModel';
import type { GameSettings, LatLngJson, PlayArea } from '@/types/database';

type EditorMode = PlayArea['type'];

const RADIUS_PRESETS = [300, 500, 1000, 2000, 5000];

export default function AreaEditorScreen() {
  const params = useLocalSearchParams<{ gameId: string }>();
  const gameId = typeof params.gameId === 'string' ? params.gameId : undefined;
  const { session } = useSession();
  const router = useRouter();
  const lobby = useGameLobby(gameId, session?.user.id);
  const game = lobby.data?.game;
  const isHost = game?.host_id === session?.user.id;

  const mapStyle = useMemo(() => stylesForKey(configuredMapTilerKey()), []);
  const styleUrl = (mapStyle.light && isUrlStyle(mapStyle.light) ? mapStyle.light : mapStyle.dark) as never;

  // ---- draft state -----------------------------------------------------------
  const [mode, setMode] = useState<EditorMode>('none');
  const [center, setCenter] = useState<LatLngJson | null>(null);
  const [radiusM, setRadiusM] = useState(500);
  const [corners, setCorners] = useState<[LatLngJson, LatLngJson] | null>(null);
  const [vertices, setVertices] = useState<LatLngJson[]>([]);
  const [noGos, setNoGos] = useState<PlayArea[]>([]);
  const [shrinkDelayS, setShrinkDelayS] = useState(180);
  const [shrinkStepS, setShrinkStepS] = useState(60);
  const [shrinkFactorPct, setShrinkFactorPct] = useState(70); // 0.7 as %
  const [minRadiusM, setMinRadiusM] = useState(50);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);

  // templates
  const [templates, setTemplates] = useState<{ id: string; name: string; definition: PlayArea }[]>([]);
  const [templateName, setTemplateName] = useState('');

  // hydrate draft from the game's current settings once
  useEffect(() => {
    if (!game || hydratedRef.current) return;
    hydratedRef.current = true;
    const area = game.settings.playArea;
    if (area) {
      setMode(area.type);
      setCenter(area.center ?? null);
      setRadiusM(Math.min(10_000, Math.max(200, area.radiusM ?? 500)));
      setCorners(area.corners ?? null);
      setVertices(area.vertices ?? []);
      setShrinkDelayS(area.shrinkDelayS ?? 180);
      setShrinkStepS(area.shrinkStepS ?? 60);
      setShrinkFactorPct(Math.round((area.shrinkFactorK ?? 0.7) * 100));
      setMinRadiusM(area.minRadiusM ?? 50);
    }
    setNoGos(game.settings.noGoZones ?? []);
  }, [game]);

  // center the camera on the newest known self fix
  const lastFix = useTrackingStore((s) => s.lastFix);
  const [flyKey, setFlyKey] = useState(0);
  const lastFixAtMs = lastFix?.timestamp;
  useEffect(() => {
    if (lastFixAtMs) setFlyKey((n) => n + 1);
  }, [lastFixAtMs]);

  const hydratedRef = useRef(false);

  const draft: PlayArea = useMemo(() => {
    if (mode === 'circle' || mode === 'shrinking') {
      return {
        type: mode,
        center: center ?? undefined,
        radiusM,
        ...(mode === 'shrinking'
          ? { shrinkDelayS, shrinkStepS, shrinkFactorK: shrinkFactorPct / 100, minRadiusM }
          : {}),
      };
    }
    if (mode === 'rectangle') {
      return { type: 'rectangle', corners: corners ?? undefined };
    }
    if (mode === 'polygon') return { type: 'polygon', vertices };
    return { type: mode };
  }, [mode, center, radiusM, corners, vertices, shrinkDelayS, shrinkStepS, shrinkFactorPct, minRadiusM]);

  const validation: AreaValidation = useMemo(
    () => validateArea(mode === 'none' || mode === 'city_wide' ? { type: mode } : draft),
    [draft, mode],
  );
  const noGoValidation: AreaValidation = useMemo(() => validateNoGoZones(noGos), [noGos]);

  const onMapPress = useCallback((feature: { geometry?: { type: string; coordinates?: number[] } }) => {
    const geom = feature.geometry;
    if (!geom || geom.type !== 'Point' || !geom.coordinates) return;
    const point: LatLngJson = { latitude: geom.coordinates[1], longitude: geom.coordinates[0] };
    if (mode === 'circle' || mode === 'shrinking') {
      setCenter(point);
      return;
    }
    if (mode === 'rectangle') {
      setCorners((prev) => (prev ? [prev[0], point] : [point, point]));
      return;
    }
    if (mode === 'polygon') {
      setVertices((v) => [...v, point]);
    }
  }, [mode]);

  // load templates list
  useEffect(() => {
    if (!isHost) return;
    void (async () => {
      const { data } = await templatesFetch();
      setTemplates((data as { id: string; name: string; definition: PlayArea }[]) ?? []);
    })();
  }, [isHost, savedFlash]);

  const previewSettings = useMemo(() => ({
    ...(game?.settings ?? {}),
    playArea: mode === 'none' || mode === 'city_wide' ? null : draft,
    noGoZones: noGos,
  }) as GameSettings, [game?.settings, draft, noGos, mode]);

  if (!gameId) return <ErrorState message="This editor is missing the game ID." />;
  if (lobby.isError && !game) {
    return <ErrorState message="The game could not be loaded. Check your connection and try again." onRetry={() => { void lobby.refetch(); }} />;
  }
  if (!game) return <SafeAreaView style={styles.safe}><LoadingState label="Loading the play area…" /></SafeAreaView>;

  if (!isHost) return <ErrorState message="Only the host can edit the play area." />;

  const save = async (asTemplate = false) => {
    setSaving(true);
    try {
      const area: PlayArea | null =
        mode === 'none' || mode === 'city_wide' ? { type: mode } : draft;
      if (area && area.type !== 'none' && area.type !== 'city_wide') {
        const main = validateArea(area);
        if (!main.ok) return;
      }
      if (noGos.length && !noGoValidation.ok) return;
      const { error } = await supabaseUpdateSettings(game.id, {
        ...game.settings,
        playArea: area,
        noGoZones: noGos,
      });
      if (error) {
        setSavedFlash(`Save failed: ${error.message}`);
        return;
      }
      if (asTemplate && templateName.trim()) {
        const { error: tplError } = await saveTemplate(session!.user.id, templateName.trim(), area as never);
        if (tplError) setSavedFlash(`Saved the game but not the template: ${tplError.message}`);
        else setSavedFlash(`Saved · template "${templateName.trim()}" stored.`);
      } else {
        setSavedFlash('Play area saved.');
      }
      setTemplateName('');
      void lobby.refetch();
    } finally {
      setSaving(false);
    }
  };

  const loadTemplate = (t: { name: string; definition: PlayArea | null }) => {
    if (!t.definition) return;
    const area = t.definition;
    setMode(area.type);
    setCenter(area.center ?? null);
    setRadiusM(Math.min(10_000, Math.max(200, area.radiusM ?? 500)));
    setCorners(area.corners ?? null);
    setVertices(area.vertices ?? []);
    setNoGos(game.settings.noGoZones ?? []);
    setShrinkDelayS(area.shrinkDelayS ?? 180);
    setShrinkStepS(area.shrinkStepS ?? 60);
    setShrinkFactorPct(Math.round((area.shrinkFactorK ?? 0.7) * 100));
    setMinRadiusM(area.minRadiusM ?? 50);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <PageHeader title="Play area" onBack={() => router.back()} />
      <View style={styles.mapHost}>
        <MapView
          style={StyleSheet.absoluteFill}
          mapStyle={styleUrl}
          onPress={(e: Feature<Geometry, GeoJsonProperties>) => onMapPress(e as never)}
          compassEnabled={false}
          logoEnabled={false}
          attributionEnabled
        >
          {lastFix ? (
            <Camera
              zoomLevel={14}
              centerCoordinate={[lastFix.longitude, lastFix.latitude]}
              animationDuration={0}
              key={flyKey}
            />
          ) : null}
          {previewSettings ? <PlayAreaOverlay settings={previewSettings} startedAtMs={null} nowMs={0} /> : null}
        </MapView>
        {mode !== 'none' && mode !== 'city_wide' ? (
          <View style={styles.drawHint} pointerEvents="none">
            <Text style={styles.drawHintText}>{drawHintFor(mode)}</Text>
          </View>
        ) : null}
      </View>
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        {savedFlash ? <InlineNotice message={savedFlash} tone="success" /> : null}
        <SectionLabel>Boundary type</SectionLabel>
        <View style={styles.chipRow}>
          {(['none', 'circle', 'shrinking', 'rectangle', 'polygon'] as const).map((t) => (
            <Chip
              key={t}
              label={typeLabel(t)}
              selected={mode === t}
              onPress={() => setMode(t)}
            />
          ))}
        </View>

        {(mode === 'circle' || mode === 'shrinking') && (
          <>
            <SectionLabel>Radius</SectionLabel>
            <View style={styles.chipRow}>
              {RADIUS_PRESETS.map((preset) => (
                <Chip key={preset} label={preset >= 1000 ? `${preset / 1000} km` : `${preset} m`} selected={radiusM === preset} onPress={() => setRadiusM(preset)} />
              ))}
              <Chip label="+50 m" onPress={() => setRadiusM((r) => Math.min(10_000, r + 50))} />
              <Chip label="−50 m" onPress={() => setRadiusM((r) => Math.max(200, r - 50))} />
            </View>
          </>
        )}

        {mode === 'shrinking' && (
          <>
            <SectionLabel>Shrink schedule</SectionLabel>
            <Stepper label="Delay before shrink" value={shrinkDelayS} step={30} min={0} onChange={setShrinkDelayS} unit="s" />
            <Stepper label="Step interval" value={shrinkStepS} step={15} min={5} onChange={setShrinkStepS} unit="s" />
            <Stepper label="Keep per step" value={shrinkFactorPct} step={5} min={10} max={100} onChange={setShrinkFactorPct} unit="%" />
            <Stepper label="Minimum radius" value={minRadiusM} step={25} min={10} onChange={setMinRadiusM} unit="m" />
          </>
        )}

        {mode === 'polygon' && vertices.length > 0 && (
          <View style={styles.row}>
            <Text style={styles.note}>{vertices.length} points · ≈ {areaSizeKm2(vertices).toFixed(2)} km²</Text>
            <Button
              variant="ghost"
              label="Undo point"
              left={<AppIcon icon={Undo2} color={colors.text.secondary} />}
              onPress={() => setVertices((v) => v.slice(0, -1))}
              size="sm"
              block={false}
            />
            <Button variant="ghost" label="Clear" onPress={() => setVertices([])} size="sm" block={false} />
          </View>
        )}

        {mode === 'rectangle' && corners ? (
          <View style={styles.row}>
            <Text style={styles.note}>2 corners placed</Text>
            <Button variant="ghost" label="Clear" onPress={() => setCorners(null)} size="sm" block={false} />
          </View>
        ) : null}

        <SectionLabel action={
          noGos.length ? (
            <Button
              variant="ghost"
              label="Clear all"
              left={<AppIcon icon={Trash2} color={colors.text.secondary} />}
              onPress={() => setNoGos([])}
              size="sm"
              block={false}
            />
          ) : undefined
        }>No-go zones</SectionLabel>
        {noGos.length ? (
          <Text style={styles.note}>{noGos.length} drawn — players inside are treated as out of bounds.</Text>
        ) : (
          <Text style={styles.note}>Optional. Draw polyagon zones to keep players off roads/rail/private land.</Text>
        )}
        <Button
          variant="secondary"
          label="Add no-go zone"
          left={<AppIcon icon={Plus} color={colors.text.primary} />}
          onPress={() => {
            if (!vertices.length || vertices.length < 3) {
              setSavedFlash('Tap at least 3 points on the map first — they become the zone.');
              return;
            }
            setNoGos((z) => [...z, { type: 'polygon', vertices }]);
            setVertices([]);
          }}
          size="sm"
          block={false}
        />
        {noGoValidation.errors.map((e) => (
          <InlineNotice key={e} message={e} tone="warning" />
        ))}

        <SectionLabel>Templates</SectionLabel>
        {templates.length ? (
          <View style={styles.chipRow}>
            {templates.map((t) => (
              <Chip key={t.id} label={t.name} onPress={() => loadTemplate({ name: t.name, definition: t.definition })} />
            ))}
          </View>
        ) : (
          <Text style={styles.note}>Save this area as a template to reuse next game.</Text>
        )}
        <Field
          label="Template name (optional)"
          value={templateName}
          onChangeText={setTemplateName}
          placeholder="e.g. Riverside park"
        />

        {validation.errors.map((e) => (
          <InlineNotice key={e} message={e} tone="warning" />
        ))}
        <View style={styles.row}>
          <Button
            variant="primary"
            label="Save play area"
            left={<AppIcon icon={Save} color={colors.accentText} />}
            onPress={() => { void save(false); }}
            loading={saving}
            disabled={saving || (validation.errors.length > 0 || noGoValidation.errors.length > 0)}
          />
        </View>
        <View style={styles.row}>
          <Button
            variant="secondary"
            label="Save + keep as template"
            onPress={() => { void save(true); }}
            loading={saving}
            disabled={saving || !templateName.trim() || validation.errors.length > 0 || noGoValidation.errors.length > 0}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// helpers: labels / steppers / supabase glue
// ---------------------------------------------------------------------------

function typeLabel(t: EditorMode): string {
  switch (t) {
    case 'none': return 'No boundary';
    case 'circle': return 'Circle';
    case 'shrinking': return 'Shrinking';
    case 'rectangle': return 'Rectangle';
    case 'polygon': return 'Custom shape';
    case 'city_wide': return 'City-wide';
    default: return t;
  }
}

function drawHintFor(mode: EditorMode): string {
  switch (mode) {
    case 'circle':
    case 'shrinking': return 'Tap the map to drop the centre pin';
    case 'rectangle': return 'Tap two opposite corners';
    case 'polygon': return 'Tap points to draw the boundary (close it by tapping near the first point is not needed)';
    default: return '';
  }
}

function Stepper({ label, value, step, onChange, unit, min = 0, max = 100_000 }: {
  label: string; value: number; step: number; onChange: (v: number) => void;
  unit: string; min?: number; max?: number;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Button variant="ghost" label="−" onPress={() => onChange(Math.max(min, value - step))} size="sm" block={false} />
        <Text style={styles.stepperValue}>{value}{unit}</Text>
        <Button variant="ghost" label="+" onPress={() => onChange(Math.min(max, value + step))} size="sm" block={false} />
      </View>
    </View>
  );
}

async function templatesFetch() {
  return supabase
    .from('areas')
    .select('id, name, definition')
    .order('updated_at', { ascending: false })
    .limit(20);
}

async function saveTemplate(hostId: string, name: string, definition: PlayArea) {
  return supabase.from('areas').insert({ host_id: hostId, name, definition });
}

async function supabaseUpdateSettings(gameId: string, settings: GameSettings) {
  return supabase.from('games').update({ settings }).eq('id', gameId);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.base },
  mapHost: { flex: 1, overflow: 'hidden' },
  drawHint: {
    position: 'absolute', top: spacing[2], left: spacing[5], right: spacing[5],
    backgroundColor: mapGlass.background, borderRadius: radius.md,
    borderWidth: stroke.border, borderColor: colors.borderSubtle,
    paddingVertical: spacing[2], paddingHorizontal: spacing[3],
  },
  drawHintText: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeight.sm, textAlign: 'center' },
  panel: { maxHeight: '45%', backgroundColor: colors.bg.base, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  panelContent: { padding: spacing[3], gap: spacing[2] },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  note: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[1] },
  stepperLabel: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, flexShrink: 1 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  stepperValue: { color: colors.text.primary, fontFamily: typography.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeight.sm, minWidth: 64, textAlign: 'right' },
});
