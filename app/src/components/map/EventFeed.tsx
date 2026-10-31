import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, lineHeight, radius, spacing } from '@/constants/theme';
import { lastSeenLabel } from '@/lib/map/mapModel';
import type { FeedItem, FeedTone } from '@/lib/map/feedModel';

const TONE_COLOR: Record<FeedTone, string> = {
  neutral: colors.role.spectator,
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
    <Pressable
      style={[styles.panel, expand && styles.panelExpanded]}
      accessibilityRole="button"
      accessibilityLabel="Event feed"
      onPress={() => setExpand((expanded) => !expanded)}
    >
      {!expand && <Text style={styles.title}>Feed</Text>}
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
      {!expand && items.length > PREVIEW_COUNT ? <Text style={styles.more}>+{items.length - PREVIEW_COUNT} more</Text> : null}
    </Pressable>
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
    width: '56%',
    backgroundColor: 'rgba(9,11,20,0.82)',
    borderColor: colors.borderSubtle,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    gap: spacing[1],
  },
  panelExpanded: { width: '82%', maxHeight: '75%' },
  title: {
    color: colors.text.tertiary,
    fontSize: fontSize.xs,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  text: { color: colors.text.primary, fontSize: fontSize.xs, lineHeight: lineHeight.sm, flex: 1 },
  ago: { color: colors.text.tertiary, fontSize: fontSize.xs },
  more: { color: colors.text.tertiary, fontSize: fontSize.xs },
});
