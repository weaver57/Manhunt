import type { Database, GameStatus, GameSettings } from '@/types/database';
import { DEFAULT_GAME_SETTINGS } from '@/types/database';
import { formatRemaining, hudStats, hudTimer, playersLeft } from '../hudModel';

type Game = Database['public']['Tables']['games']['Row'];
type GamePlayer = Database['public']['Tables']['game_players']['Row'];

const NOW = 1_700_000_000_000;

function game(status: GameStatus, overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    host_id: 'host',
    code: 'ABC123',
    name: 'Test game',
    status,
    mode: 'classic',
    settings: DEFAULT_GAME_SETTINGS,
    started_at: null,
    ended_at: null,
    countdown_ends_at: null,
    head_start_ends_at: null,
    max_ends_at: null,
    paused_at: null,
    paused_remaining_seconds: null,
    winner: null,
    ...overrides,
  };
}

function player(overrides: Partial<GamePlayer> = {}): GamePlayer {
  return {
    id: 'p',
    game_id: 'g1',
    user_id: 'u1',
    role: 'runner',
    status: 'active',
    joined_at: new Date(NOW).toISOString(),
    tagged_at: null,
    distance_m: 0,
    tags_made: 0,
    is_ready: false,
    last_seen_at: new Date(NOW).toISOString(),
    mock_detected_at: null,
    ...overrides,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

describe('hudTimer', () => {
  it('reads the phase deadline for each ticking status', () => {
    expect(hudTimer(game('countdown', { countdown_ends_at: iso(NOW + 10_000) }), NOW).seconds).toBe(10);
    expect(hudTimer(game('starting', { countdown_ends_at: iso(NOW + 30_000) }), NOW).seconds).toBe(30);
    expect(hudTimer(game('head_start', { head_start_ends_at: iso(NOW + 60_000) }), NOW).seconds).toBe(60);
    expect(hudTimer(game('active', { max_ends_at: iso(NOW + 300_000) }), NOW).seconds).toBe(300);
  });

  it('labels the phase correctly', () => {
    expect(hudTimer(game('countdown'), NOW).label).toBe('Countdown');
    expect(hudTimer(game('starting'), NOW).label).toBe('Countdown');
    expect(hudTimer(game('head_start'), NOW).label).toBe('Head start');
    expect(hudTimer(game('active'), NOW).label).toBe('Time left');
    expect(hudTimer(game('ended'), NOW).label).toBe('Game over');
  });

  it('shows a frozen zero timer for lobby, paused and ended', () => {
    expect(hudTimer(game('lobby'), NOW)).toEqual({ seconds: 0, label: 'Lobby' });
    expect(hudTimer(game('paused'), NOW).seconds).toBe(0);
    expect(hudTimer(game('ended'), NOW).seconds).toBe(0);
  });

  it('returns zero when the deadline is missing or unparsable', () => {
    expect(hudTimer(game('active', { max_ends_at: null }), NOW).seconds).toBe(0);
    expect(hudTimer(game('active', { max_ends_at: 'not-a-date' }), NOW).seconds).toBe(0);
  });

  it('clamps negative remaining time to zero (clock skew / missed transitions)', () => {
    expect(hudTimer(game('active', { max_ends_at: iso(NOW - 5_000) }), NOW).seconds).toBe(0);
  });
});

describe('formatRemaining', () => {
  it('formats mm:ss and clamps negatives', () => {
    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(65)).toBe('01:05');
    expect(formatRemaining(600)).toBe('10:00');
    expect(formatRemaining(3600)).toBe('60:00');
    expect(formatRemaining(-10)).toBe('00:00');
  });
});

describe('playersLeft', () => {
  it('counts only active runners', () => {
    const players = [
      player({ user_id: 'r1' }),
      player({ user_id: 'r2', status: 'tagged' }),
      player({ user_id: 'r3', status: 'sos' }),
      player({ user_id: 'r4', status: 'disconnected' }),
      player({ user_id: 'c1', role: 'chaser' }),
      player({ user_id: 'c2', role: 'chaser', status: 'tagged' }),
      player({ user_id: 's1', role: 'spectator' }),
    ];
    expect(playersLeft(players)).toBe(1);
  });

  it('is zero for an empty or spectator-only game', () => {
    expect(playersLeft([])).toBe(0);
    expect(playersLeft([player({ role: 'spectator' })])).toBe(0);
  });
});

describe('hudStats', () => {
  const settings: GameSettings = { ...DEFAULT_GAME_SETTINGS };

  function fixFor(user: string) {
    return {
      latitude: 0,
      longitude: 0,
      accuracy: 5,
      speed: null,
      heading: null,
      timestamp: NOW,
      role: user === 'c1' ? 'chaser' : 'runner',
    };
  }

  it('resolves role, left count and the nearest-opponent hint for a runner', () => {
    const players = [
      player({ user_id: 'me', role: 'runner' }),
      player({ user_id: 'c1', role: 'chaser' }),
      player({ user_id: 'r2', role: 'runner', status: 'tagged' }),
    ];
    const fixes = {
      me: fixFor('me'),
      c1: { ...fixFor('c1'), latitude: 0.001 },
      r2: { ...fixFor('r2'), latitude: 0.1 },
    };
    const stats = hudStats({
      game: game('active', { max_ends_at: iso(NOW + 90_000), settings }),
      players,
      userId: 'me',
      fixes: fixes as never,
      now: NOW,
    });
    expect(stats.role).toBe('runner');
    expect(stats.left).toBe(1);
    expect(stats.timer.seconds).toBe(90);
    expect(stats.nearest).toEqual({ role: 'chaser', label: expect.stringMatching(/m$/) });
  });

  it('has no nearest hint for spectators and unknown viewers', () => {
    const players = [player({ user_id: 'me', role: 'spectator' }), player({ user_id: 'c1', role: 'chaser' })];
    const fixes = { me: fixFor('me'), c1: fixFor('c1') };
    const spect = hudStats({ game: game('active'), players, userId: 'me', fixes: fixes as never, now: NOW });
    expect(spect.nearest).toBeNull();
    expect(hudStats({ game: game('active'), players, userId: undefined, fixes: fixes as never, now: NOW }).role).toBeUndefined();
  });
});
