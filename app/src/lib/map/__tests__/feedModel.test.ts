import type { Database } from '@/types/database';
import { buildFeed, describeFeedEvent } from '../feedModel';

type EventRow = Pick<Database['public']['Tables']['events']['Row'], 'id' | 'created_at' | 'event_type' | 'payload' | 'actor_id'>;
type PlayerLike = { user_id: string; display_name: string; nickname: string | null };

const T0 = 1_700_000_000_000;

function row(eventType: string, overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: overrides.id ?? `e-${eventType}-${Math.random().toString(36).slice(2, 7)}`,
    created_at: new Date(T0).toISOString(),
    actor_id: 'u1',
    event_type: eventType,
    payload: {},
    ...overrides,
  };
}

const players: PlayerLike[] = [
  { user_id: 'u1', display_name: 'Ash Ketchum', nickname: 'Ash' },
  { user_id: 'u2', display_name: 'Misty Williams', nickname: null },
];

describe('describeFeedEvent', () => {
  it('renders every lifecycle event type', () => {
    expect(describeFeedEvent(row('game_created', { actor_id: null }), players, T0).text).toBe('Lobby created');
    expect(describeFeedEvent(row('player_joined', { payload: { role: 'runner' } }), players, T0).text).toBe('Ash joined as runner.');
    expect(describeFeedEvent(row('player_joined', { actor_id: 'u2' }), players, T0).text).toBe('Misty Williams joined.');
    expect(describeFeedEvent(row('player_joined', { actor_id: 'u2', payload: { role: 'chaser' } }), players, T0).text).toBe('Misty Williams joined as chaser.');
    expect(describeFeedEvent(row('player_left', { actor_id: 'u2' }), players, T0).text).toBe('Misty Williams left.');
    expect(describeFeedEvent(row('role_changed', { actor_id: 'u2', payload: { role: 'chaser' } }), players, T0).text).toBe('Misty Williams is now chaser.');
    expect(describeFeedEvent(row('game_started', { actor_id: null }), players, T0).text).toBe('Countdown started.');
    expect(describeFeedEvent(row('game_paused', { actor_id: null }), players, T0).text).toBe('Game paused.');
    expect(describeFeedEvent(row('game_resumed', { actor_id: null }), players, T0).text).toBe('Game resumed.');
    expect(describeFeedEvent(row('game_ended', { actor_id: null }), players, T0).text).toBe('Game over.');
  });

  it('prefers the nickname and falls back to "Someone" for unknown actors', () => {
    expect(describeFeedEvent(row('player_left'), players, T0).text).toBe('Ash left.');
    expect(describeFeedEvent(row('player_left', { actor_id: 'u2' }), players, T0).text).toBe('Misty Williams left.');
    expect(describeFeedEvent(row('player_left', { actor_id: 'ghost' }), players, T0).text).toBe('Someone left.');
    expect(describeFeedEvent(row('player_left', { actor_id: null }), players, T0).text).toBe('Someone left.');
  });

  it('resolves host transfers to the new host', () => {
    expect(describeFeedEvent(row('host_transferred', { payload: { newHostId: 'u2' } }), players, T0).text).toBe('Host transferred to Misty Williams.');
    expect(describeFeedEvent(row('host_transferred', {}), players, T0).text).toBe('Host transferred to Ash.');
  });

  it('marks ready events as success only when ready=true', () => {
    expect(describeFeedEvent(row('ready_changed', { payload: { ready: true } }), players, T0).tone).toBe('success');
    expect(describeFeedEvent(row('ready_changed', { payload: { ready: false } }), players, T0).tone).toBe('neutral');
  });

  it('never crashes on future event types (graceful fallback)', () => {
    const item = describeFeedEvent(row('zone_assigned', { payload: { whatever: 1 } }), players, T0);
    expect(item.text).toBe('Ash: zone assigned.');
    expect(item.tone).toBe('neutral');
  });

  it('parses created_at into a numeric ms timestamp, falling back to now', () => {
    expect(describeFeedEvent(row('game_ended'), players, T0).createdAtMs).toBe(T0);
    const fallback = describeFeedEvent(row('game_ended', { created_at: 'garbage' }), players, T0);
    expect(fallback.createdAtMs).toBe(T0);
  });
});

describe('buildFeed', () => {
  it('orders newest first', () => {
    const rows = [
      row('game_created', { created_at: new Date(T0).toISOString() }),
      row('game_started', { created_at: new Date(T0 + 5000).toISOString() }),
      row('game_paused', { created_at: new Date(T0 + 9000).toISOString() }),
    ];
    const feed = buildFeed(rows, players, T0);
    expect(feed.map((i) => i.text)).toEqual(['Game paused.', 'Countdown started.', 'Lobby created']);
  });

  it('caps the list length', () => {
    const rows = Array.from({ length: 50 }, (_, i) =>
      row('game_resumed', { created_at: new Date(T0 + i * 1000).toISOString(), id: `e-${i}` }),
    );
    expect(buildFeed(rows, players, T0)).toHaveLength(30);
    expect(buildFeed(rows, players, T0, 5)).toHaveLength(5);
  });

  it('dedupes identical ids', () => {
    const same = row('game_started', { created_at: new Date(T0).toISOString() });
    expect(buildFeed([same, { ...same }], players, T0)).toHaveLength(1);
  });
});
