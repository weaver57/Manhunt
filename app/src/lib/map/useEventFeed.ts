import { useEffect, useState } from 'react';
import type { Database } from '@/types/database';
import { supabase } from '@/lib/supabase/client';

export type FeedEventRow = Pick<Database['public']['Tables']['events']['Row'], 'id' | 'created_at' | 'event_type' | 'payload' | 'actor_id'>;

const INITIAL_ROWS = 30;
const MAX_ROWS = 80;

/**
 * Event feed rows for a game: initial recent query + realtime INSERT stream
 * (the events table is in the realtime publication from migration 0006).
 */
export function useEventFeed(gameId: string | undefined): FeedEventRow[] {
  const [rows, setRows] = useState<FeedEventRow[]>([]);

  useEffect(() => {
    if (!gameId) {
      setRows([]);
      return;
    }
    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase
          .from('events')
          .select('id, created_at, event_type, payload, actor_id')
          .eq('game_id', gameId)
          .order('created_at', { ascending: false })
          .limit(INITIAL_ROWS);
        if (!cancelled && data) {
          setRows((prev) => mergeRows(prev, data as FeedEventRow[]));
        }
      } catch {
        // Feed is non-critical; realtime still pushes new events.
      }
    })();

    const channel = supabase.channel(`events:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` },
        (payload) => {
          const row = payload.new as FeedEventRow | null;
          if (!row || typeof row.id !== 'string') return;
          setRows((prev) => mergeRows(prev, [row]));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  return rows;
}

/** Newest-first, deduped, capped. */
function mergeRows(existing: FeedEventRow[], incoming: FeedEventRow[]): FeedEventRow[] {
  const seen = new Set(existing.map((r) => r.id));
  const merged = [...existing];
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_ROWS);
}
