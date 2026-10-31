/**
 * Pure event-feed model: turns `events` table rows (Phase 2 lifecycle
 * triggers, Phase 5 will add tag events) into human feed lines.
 */
import type { Database } from '@/types/database';

type EventRow = Pick<Database['public']['Tables']['events']['Row'], 'id' | 'created_at' | 'event_type' | 'payload' | 'actor_id'>;
interface PlayerLike {
  user_id: string;
  display_name: string;
  nickname: string | null;
}

export type FeedTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface FeedItem {
  key: string;
  text: string;
  tone: FeedTone;
  /** Rendered newest-first; kept for the relative timestamp chip. */
  createdAtMs: number;
}

function nameOf(actorId: string | null | undefined, players: PlayerLike[]): string {
  if (!actorId) return 'Someone';
  const player = players.find((p) => p.user_id === actorId);
  if (!player) return 'Someone';
  return player.nickname || player.display_name;
}

function endWithPeriod(text: string): string {
  return /[.?!]$/.test(text) ? text : `${text}.`;
}

export function describeFeedEvent(row: EventRow, players: PlayerLike[], now: number): FeedItem {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const who = nameOf(row.actor_id, players);
  const base: Omit<FeedItem, 'text'> = {
    key: row.id,
    tone: 'neutral',
    createdAtMs: Date.parse(row.created_at) || now,
  };

  switch (row.event_type) {
    case 'game_created':
      return { ...base, text: 'Lobby created', tone: 'neutral' };
    case 'player_joined': {
      const role = typeof payload.role === 'string' ? ` as ${payload.role}` : '';
      return { ...base, text: endWithPeriod(`${who} joined${role}`), tone: 'neutral' };
    }
    case 'player_left':
      return { ...base, text: endWithPeriod(`${who} left`), tone: 'warning' };
    case 'role_changed': {
      const role = typeof payload.role === 'string' ? payload.role : 'changed role';
      return { ...base, text: endWithPeriod(`${who} is now ${role}`), tone: 'neutral' };
    }
    case 'ready_changed': {
      const ready = payload.ready === true;
      return { ...base, text: endWithPeriod(`${who} marked ready`), tone: ready ? 'success' : 'neutral' };
    }
    case 'game_started':
      return { ...base, text: endWithPeriod('Countdown started'), tone: 'success' };
    case 'game_paused':
      return { ...base, text: endWithPeriod('Game paused'), tone: 'warning' };
    case 'game_resumed':
      return { ...base, text: endWithPeriod('Game resumed'), tone: 'success' };
    case 'game_ended':
      return { ...base, text: endWithPeriod('Game over'), tone: 'neutral' };
    case 'host_transferred': {
      const newHost = typeof payload.newHostId === 'string' ? nameOf(payload.newHostId, players) : null;
      return { ...base, text: endWithPeriod(`Host transferred to ${newHost ?? who}`), tone: 'warning' };
    }
    // Grace for later phases (tags, zone warnings) that add new types before
    // the feed model catches up - never crash the feed.
    default:
      return { ...base, text: endWithPeriod(`${who}: ${row.event_type.replace(/_/g, ' ')}`), tone: 'neutral' };
  }
}

/** Newest first, deduped by id, capped. */
export function buildFeed(rows: EventRow[], players: PlayerLike[], now: number, maxItems = 30): FeedItem[] {
  const seen = new Set<string>();
  return rows
    .slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .slice(0, maxItems)
    .map((row) => describeFeedEvent(row, players, now));
}
