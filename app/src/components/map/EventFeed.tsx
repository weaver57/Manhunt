import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { AppIcon } from '@/components/ui';
import { colors, fontSize, lineHeight, mapGlass, radius, size, spacing, stroke, tracking, typography } from '@/constants/theme';
import { lastSeenLabel } from '@/lib/map/mapModel';
import type { FeedItem, FeedTone } from '@/lib/map/feedModel';

const TONE_COLOR: Record<FeedTone, string> = {
  neutral: colors.status.info,
  success: colors.status.success,
  warning: colors.status.warning,
  danger: colors.status.danger,
};

const PREVIEW_COUNT = 4;

export interface EventFeedProps {
  items: FeedItem[];
}

/**
 * Sliding event feed. Shows the four latest lines above the controls; a tap
 * expands the closed tall list.
 */
export function EventFeed({ items }: EventFeedProps) {
  const [expand, setExpand] = useState(false);
  if (!items.length) return null;
  const preview = items.slice(0, PREVIEW_COUNT);
  const list = expand ? items.slice(0, 30) : preview;

  return (
    <View style={[styles.panel, expand && styles.panelExpanded]}>
      <Pressable
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={expand ? 'Collapse event feed' : 'Expand event feed'}
        accessibilityState={{ expanded: expand }}
        onPress={() => setExpand((expanded) => !expanded)}
      >
        <Text style={styles.title}>Recent events</Text>
        <AppIcon icon={expand ? ChevronDown : ChevronUp} size={size.iconSmall} color={colors.text.secondary} />
      </Pressable>
      <ScrollView scrollEnabled={expand} showsVerticalScrollIndicator={expand} nestedScrollEnabled>
        {list.map((item) => (
          <View key={item.key} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: TONE_COLOR[item.tone] }]} />
            <Text style={styles.text} numberOfLines={expand ? 2 : 1}>
              {item.text}
              <Text style={styles.ago}>  ·  {ageLabel(item.createdAtMs)}</Text>
            </Text>
          </View>
        ))}
      </ScrollView>
      {!expand && items.length > PREVIEW_COUNT ? <Text style={styles.more}>+{items.length - PREVIEW_COUNT} events</Text> : null}
    </View>
  );
}

function ageLabel(createdAtMs: number): string {
  return lastSeenLabel(Math.max(0, Date.now() - createdAtMs)).replace(' ago', '') || 'now';
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: spacing[2],
    bottom: spacing[2],
    maxHeight: '45%',
    width: '62%',
    backgroundColor: mapGlass.background,
    borderColor: mapGlass.border,
    borderWidth: stroke.border,
    borderRadius: radius.md,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    gap: spacing[1],
  },
  panelExpanded: { width: '84%', maxHeight: '72%' },
  header: { minHeight: size.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  title: {
    color: colors.text.secondary,
    fontFamily: typography.bodySemiBold,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: tracking.label,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  dot: { width: spacing[2], height: spacing[2], borderRadius: radius.full, marginTop: spacing[1] },
  text: { color: colors.text.primary, fontFamily: typography.body, fontSize: fontSize.sm, lineHeight: lineHeight.sm, flex: 1 },
  ago: { color: colors.text.secondary, fontFamily: typography.body, fontSize: fontSize.xs },
  more: { color: colors.text.secondary, fontFamily: typography.bodyMedium, fontSize: fontSize.xs, paddingTop: spacing[1] },
});
