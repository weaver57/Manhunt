/**
 * Pure HUD model: timer, players-left and the nearest-opponent strip.
 * Accepts the typed `games` Row so it stays in lockstep with migrations.
 */
import type { Database, GameStatus } from '@/types/database';
import { nearestOpponent, formatDistanceM, type MarkerFix } from './mapModel';

type Game = Database['public']['Tables']['games']['Row'];
type LobbyPlayer = Database['public']['Tables']['game_players']['Row'];

export interface HudTimer {
  /** Remaining seconds in the current phase (0 when unknown/negative). */
  seconds: number;
  label: string;
}

const PHASE_BY_STATUS: Record<GameStatus, string> = {
  lobby: 'Lobby',
  countdown: 'Countdown',
  starting: 'Countdown',
  head_start: 'Head start',
  active: 'Time left',
  paused: 'Paused',
  ended: 'Game over',
};

/**
 * Remaining time for the phase the game is currently in.
 * Paused games use the frozen pause clock (no ticking while paused).
 */
export function hudTimer(game: Game, now: number): HudTimer {
  const label = PHASE_BY_STATUS[game.status];
  if (game.status === 'ended') return { seconds: 0, label };

  let target: string | null = null;
  switch (game.status) {
    case 'countdown':
    case 'starting':
      target = game.countdown_ends_at;
      break;
    case 'head_start':
      target = game.head_start_ends_at;
      break;
    case 'active':
      target = game.max_ends_at;
      break;
    default:
      // lobby / paused: no ticking timer (paused shows paused_remaining_seconds)
      break;
  }
  if (!target) return { seconds: 0, label };

  const ms = Date.parse(target) - now;
  if (!Number.isFinite(ms)) return { seconds: 0, label };
  return { seconds: Math.max(0, Math.round(ms / 1000)), label };
}

export function formatRemaining(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Runners still in play (untagged, not timed out). */
export function playersLeft(players: LobbyPlayer[]): number {
  return players.filter((p) => p.role === 'runner' && p.status === 'active').length;
}

export interface HudStatsInput {
  game: Game;
  players: LobbyPlayer[];
  userId: string | undefined;
  /** Per-user latest fix, with the viewer's role attached to each fix. */
  fixes: Record<string, MarkerFix>;
  now: number;
}

export interface HudStats {
  timer: HudTimer;
  role: LobbyPlayer['role'] | undefined;
  left: number;
  /** Nearest-opponent strip ("Chaser 340 m"), null when not applying. */
  nearest: { role: string; label: string } | null;
}

export function hudStats({ game, players, userId, fixes, now }: HudStatsInput): HudStats {
  const me = players.find((p) => p.user_id === userId);
  const timer = hudTimer(game, now);
  const left = playersLeft(players);
  const hint = userId && me?.role ? nearestOpponent({ userId, role: me.role, fixes, now }) : null;
  return {
    timer,
    role: me?.role,
    left,
    nearest: hint
      ? { role: hint.targetRole, label: formatDistanceM(hint.distanceM) }
      : null,
  };
}
