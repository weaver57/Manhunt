import {
  HOLD_TO_TAG_MS,
  canTag,
  cooldownRemainingMs,
  describeTagFailure,
  holdProgress,
  immunityRemainingMs,
  proximityProgress,
  pulseIntervalMs,
  shouldFireHold,
  shouldQueueTag,
  tagAllowanceM,
  tagEnvelopeM,
  wasQuickTap,
  confirmRemainingS,
  pruneTagQueue,
} from '../tagModel';

// ---------------------------------------------------------------------------
// Distance envelope — the core acceptance rule
// ---------------------------------------------------------------------------

describe('tag envelope', () => {
  it('accepts a tag exactly at the radius with perfect GPS', () => {
    const envelope = tagEnvelopeM({ radiusM: 15, chaserAccuracyM: 0, runnerAccuracyM: 0 });
    expect(canTag(15, envelope)).toBe(true);
    expect(canTag(15.01, envelope)).toBe(false);
  });

  it('caps the allowance at 25 m even with wildly inaccurate fixes', () => {
    expect(tagAllowanceM({ radiusM: 15, chaserAccuracyM: 40, runnerAccuracyM: 50 })).toBe(25);
    expect(tagEnvelopeM({ radiusM: 15, chaserAccuracyM: 40, runnerAccuracyM: 50 })).toBe(40);
  });

  it('adds (never subtracts) both accuracies when they are small', () => {
    expect(tagAllowanceM({ radiusM: 15, chaserAccuracyM: 4, runnerAccuracyM: 3 })).toBe(7);
  });

  it('treats missing accuracy as zero allowance, not failure', () => {
    expect(tagEnvelopeM({ radiusM: 15, chaserAccuracyM: null, runnerAccuracyM: null })).toBe(15);
  });

  it('rejects 50 m away every time even with generous accuracies', () => {
    // worst case: full 25 m allowance on a 15 m radius
    expect(canTag(50, tagEnvelopeM({ radiusM: 15, chaserAccuracyM: 12.5, runnerAccuracyM: 12.5 }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Hold-to-tag gate
// ---------------------------------------------------------------------------

describe('hold-to-tag gate', () => {
  it('does not fire before 500 ms and fires at exactly the threshold', () => {
    expect(shouldFireHold(1000, 1499)).toBe(false);
    expect(shouldFireHold(1000, 1500)).toBe(true);
  });

  it('flags quick taps so they neither fire nor punish', () => {
    expect(wasQuickTap(1000, 1000 + HOLD_TO_TAG_MS - 1)).toBe(true);
    expect(wasQuickTap(1000, 1000 + HOLD_TO_TAG_MS)).toBe(false);
  });

  it('progress is monotonically bounded 0..1', () => {
    expect(holdProgress(null, 99999)).toBe(0);
    expect(holdProgress(0, 250)).toBeCloseTo(0.5);
    expect(holdProgress(0, 500)).toBe(1);
    expect(holdProgress(0, 100_000)).toBe(1);
    expect(holdProgress(1000, 500)).toBe(0); // press "in the future"
  });
});

// ---------------------------------------------------------------------------
// Proximity ring + pulses
// ---------------------------------------------------------------------------

describe('proximity ring and pulse cadence', () => {
  it('fills from 0 at the radius edge to 1 at zero distance', () => {
    expect(proximityProgress(15, 15)).toBe(0);
    expect(proximityProgress(7.5, 15)).toBeCloseTo(0.5);
    expect(proximityProgress(0, 15)).toBe(1);
  });

  it('clamps overshoot and handles unknown distance', () => {
    expect(proximityProgress(-3, 15)).toBe(1);
    expect(proximityProgress(null, 15)).toBe(0);
    expect(proximityProgress(NaN, 15)).toBe(0);
  });

  it('speeds pulses smoothly from far to close', () => {
    expect(pulseIntervalMs(0)).toBe(900);
    expect(pulseIntervalMs(1)).toBeLessThan(200);
    const mid = pulseIntervalMs(0.5);
    expect(mid).toBeGreaterThan(200);
    expect(mid).toBeLessThan(900);
    // cadence must tighten as proximity grows
    expect(pulseIntervalMs(0.9)).toBeLessThan(pulseIntervalMs(0.6));
  });
});

// ---------------------------------------------------------------------------
// Cooldown / immunity / confirm windows
// ---------------------------------------------------------------------------

describe('cooldown and immunity timers', () => {
  it('returns 0 once the cooldown has elapsed', () => {
    expect(cooldownRemainingMs(0, 5000, 5)).toBe(0);
  });

  it('returns the remaining ms while cooling down', () => {
    expect(cooldownRemainingMs(0, 2000, 5)).toBe(3000);
  });

  it('never produces negative immunity', () => {
    expect(immunityRemainingMs(1000, 4000)).toBe(0);
    expect(immunityRemainingMs(9000, 4000)).toBe(5000);
  });

  it('counts confirm-window seconds down, clamping at 0', () => {
    expect(confirmRemainingS(0, 0, 10)).toBe(10);
    expect(confirmRemainingS(4500, 0, 10)).toBe(6); // ceil of 5.5
    expect(confirmRemainingS(10_000, 0, 10)).toBe(0);
    expect(confirmRemainingS(20_000, 0, 10)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Failure copy — every reason a player can hit
// ---------------------------------------------------------------------------

describe('describeTagFailure', () => {
  const ctx = { radiusM: 15, distanceM: 28, retryInS: 3 };

  it('reports distance for too_far in a verb-first calm line', () => {
    const text = describeTagFailure('too_far', ctx);
    expect(text).toMatch(/^Too far/);
    expect(text).toContain('28 m');
    expect(text).toContain('15 m');
  });

  it('rounds fractional distances and survives missing distance', () => {
    expect(describeTagFailure('too_far', { ...ctx, distanceM: 27.6 })).toContain('28 m');
    expect(describeTagFailure('too_far', { ...ctx, distanceM: null })).not.toContain('null');
  });

  it('mentions live cooldown seconds', () => {
    expect(describeTagFailure('cooldown', { ...ctx })).toContain('3s');
  });

  it('gives runner-specific copy for already-caught', () => {
    expect(describeTagFailure('runner_already_caught', { ...ctx, runnerName: 'Maya' })).toContain('Maya');
  });

  it('covers all server reasons without crashing', () => {
    const reasons = [
      'too_far', 'runner_location_stale', 'chaser_location_stale', 'position_mismatch',
      'cooldown', 'runner_already_caught', 'runner_not_active', 'runner_immune',
      'chaser_not_active', 'game_not_active', 'runner_not_in_game', 'not_signed_in',
      'game_not_found', 'bad_token', 'qr_not_ready', 'position_stale', 'unknown_xyz',
    ];
    for (const r of reasons) {
      expect(typeof describeTagFailure(r, { ...ctx, runnerName: 'Maya' })).toBe('string');
      expect(describeTagFailure(r, { ...ctx, runnerName: 'Maya' }).length).toBeGreaterThan(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Offline queue gating
// ---------------------------------------------------------------------------

describe('offline queue gating', () => {
  it('queues network-class failures only', () => {
    expect(shouldQueueTag(new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldQueueTag('Network request failed')).toBe(true);
    expect(shouldQueueTag({ message: 'AuthSessionMissingError', code: '400' })).toBe(false);
  });

  it('does not queue deterministic server rejections', () => {
    expect(shouldQueueTag({ message: 'too far', code: '23514' })).toBe(false);
    expect(shouldQueueTag({ message: ' cooldown ' })).toBe(false);
    expect(shouldQueueTag(null)).toBe(false);
  });

  it('prunes queue entries older than 60 s', () => {
    expect(pruneTagQueue(1000, 61_000)).toBe(true);  // exactly 60 s -> keep
    expect(pruneTagQueue(1000, 61_001)).toBe(false);
  });
});
