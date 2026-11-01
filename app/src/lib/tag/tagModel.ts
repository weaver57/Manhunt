/**
 * Pure model for Phase 5 tag & catch.
 *
 * Deterministic functions only (every input explicit) so the tag dock's
 * behaviour can be stress-tested without RN / network / GPS. Mirrors the
 * server contract in migration 0015:
 *
 *   envelope = catchRadiusM + min(chaserAccuracy + runnerAccuracy, 25)
 *   server rejects attempts inside a cooldown and honours immunity windows.
 */

export type TagVariant = 'tap' | 'confirm' | 'qr' | 'auto' | 'honor';

// ---------------------------------------------------------------------------
// Distance envelope (spec: radius + GPS error, capped at 25 m of allowance)
// ---------------------------------------------------------------------------

export interface TagEnvelopeInput {
  radiusM: number;
  chaserAccuracyM: number | null;
  runnerAccuracyM: number | null;
}

export function tagAllowanceM(input: TagEnvelopeInput, capM = 25): number {
  return Math.min((input.chaserAccuracyM ?? 0) + (input.runnerAccuracyM ?? 0), capM);
}

export function tagEnvelopeM(input: TagEnvelopeInput, capM = 25): number {
  return input.radiusM + tagAllowanceM(input, capM);
}

/** True inside the accepted envelope (inclusive at the boundary). */
export function canTag(distanceM: number, envelopeM: number): boolean {
  return distanceM <= envelopeM;
}

// ---------------------------------------------------------------------------
// Press-and-hold gate (accidental-tap protection)
// ---------------------------------------------------------------------------

export const HOLD_TO_TAG_MS = 500;

/** 0..1 press progress; completes at 1 when the hold requirement is met. */
export function holdProgress(pressStartMs: number | null, nowMs: number, holdMs = HOLD_TO_TAG_MS): number {
  if (pressStartMs === null) return 0;
  const held = Math.max(0, nowMs - pressStartMs);
  return Math.min(1, held / holdMs);
}

export function shouldFireHold(pressStartMs: number, nowMs: number, holdMs = HOLD_TO_TAG_MS): boolean {
  return nowMs - pressStartMs >= holdMs;
}

/** Short taps (under the hold) should not fire AND should not punish. */
export function wasQuickTap(pressStartMs: number, releaseMs: number, holdMs = HOLD_TO_TAG_MS): boolean {
  return releaseMs - pressStartMs < holdMs;
}

// ---------------------------------------------------------------------------
// Proximity feedback: ring fill + haptic pulse cadence
// ---------------------------------------------------------------------------

/** 1 at the runner, 0 at the radius edge (clamped; empty ring when unknown). */
export function proximityProgress(distanceM: number | null, radiusM: number): number {
  if (distanceM === null || radiusM <= 0 || !Number.isFinite(distanceM)) return 0;
  return Math.max(0, Math.min(1, 1 - distanceM / radiusM));
}

/**
 * Haptic pulse interval while holding: slows to leisurely far away, tightens
 * to a near buzz as the chaser closes in. 900 -> 160 ms.
 */
export function pulseIntervalMs(proximity: number, farMs = 900, closeMs = 160): number {
  const p = Math.max(0, Math.min(1, proximity));
  return Math.round((farMs + (closeMs - farMs) * p * p * (3 - 2 * p))); // smoothstep
}

// ---------------------------------------------------------------------------
// Cooldown & immunity windows
// ---------------------------------------------------------------------------

export function cooldownRemainingMs(lastFailedAtMs: number | null, nowMs: number, cooldownS: number): number {
  if (lastFailedAtMs === null || cooldownS <= 0) return 0;
  return Math.max(0, cooldownS * 1000 - (nowMs - lastFailedAtMs));
}

export function immunityRemainingMs(immunityUntilMs: number | null, nowMs: number): number {
  if (immunityUntilMs === null) return 0;
  return Math.max(0, immunityUntilMs - nowMs);
}

// ---------------------------------------------------------------------------
// Confirm-variant countdown
// ---------------------------------------------------------------------------

export const CONFIRM_WINDOW_S = 10;

export function confirmDeadlineMs(createdAtMs: number, windowS = CONFIRM_WINDOW_S): number {
  return createdAtMs + windowS * 1000;
}

/** Seconds left to accept (0 -> window elapsed, server auto-accepts). */
export function confirmRemainingS(nowMs: number, createdAtMs: number, windowS = CONFIRM_WINDOW_S): number {
  return Math.max(0, Math.ceil((confirmDeadlineMs(createdAtMs, windowS) - nowMs) / 1000));
}

// ---------------------------------------------------------------------------
// Failure copy — calm, verb-first, tells the player exactly what to change
// ---------------------------------------------------------------------------

export interface TagFailureContext {
  /** Metres reported by the server for the failed attempt. */
  distanceM?: number | null;
  /** Retry-in seconds for cooldown responses. */
  retryInS?: number | null;
  /** Runner display name for "already caught" copy. */
  runnerName?: string;
  /** The configured catch radius, for "get to X m" phrasing. */
  radiusM: number;
}

export function describeTagFailure(reason: string, ctx: TagFailureContext): string {
  const name = ctx.runnerName ? `${ctx.runnerName} is already caught` : 'That runner is already caught';
  switch (reason) {
    case 'too_far': {
      const d = ctx.distanceM != null && Number.isFinite(ctx.distanceM) ? Math.round(ctx.distanceM) : null;
      return d != null ? `Too far — about ${d} m. Close in to ${Math.round(ctx.radiusM)} m.` : `Too far. Close in to ${Math.round(ctx.radiusM)} m.`;
    }
    case 'runner_location_stale':
      return 'Runner position too old — wait a moment for their GPS to settle.';
    case 'chaser_location_stale':
      return 'Your GPS is stale — hold still outdoors, then tag again.';
    case 'position_mismatch':
      return 'Your GPS disagreed with the server. Stand still a few seconds and try again.';
    case 'cooldown':
      return `Tag is recharging — ${Math.max(1, Math.ceil(ctx.retryInS ?? 1))}s left.`;
    case 'runner_already_caught':
    case 'runner_not_active':
      return `${name}.`;
    case 'runner_immune':
      return `${ctx.runnerName ?? 'The runner'} just respawned — immunity window. Try again shortly.`;
    case 'chaser_not_active':
    case 'game_not_active':
      return 'Tagging is off right now.';
    case 'runner_not_in_game':
      return 'That runner is not in this game.';
    case 'not_signed_in':
      return 'Session expired — sign back in to tag.';
    case 'game_not_found':
      return 'This game has ended into thin air. Leave and re-join.';
    case 'bad_token':
      return 'That QR code expired — scan the fresh one.';
    case 'qr_not_ready':
      return 'QR tagging is climates-warming-up. Try again in a few seconds.';
    case 'position_stale':
      return 'Location too old — wait for fresh GPS on both sides.';
    default:
      return 'Tag failed. Try again.';
  }
}

// ---------------------------------------------------------------------------
// Offline queue gating (chaser taps Tag with no network)
// ---------------------------------------------------------------------------

/**
 * Supabase JS surfaces network problems as TypeError ("Failed to fetch") or
 * FetchError without a dedicated Postgres error code. Those queue; clear
 * server rejections do not (the server is the best judge of validity).
 */
export function shouldQueueTag(rawError: unknown): boolean {
  const message = rawError instanceof Error ? rawError.message : String(rawError ?? '');
  if (!message) return false;
  const code = (rawError as { code?: string } | null)?.code;
  if (typeof code === 'string' && code.startsWith('4')) return false; // definite server verdict
  return /failed to fetch|networkerror|network request failed|offline|timeout|aborted|fetch failed/i.test(message);
}

/** Give delayed submissions a chance, but not a stale one: bound the queue. */
export function pruneTagQueue(queuedMs: number, nowMs: number, maxAgeMs = 60_000): boolean {
  return nowMs - queuedMs <= maxAgeMs;
}
