import {
  applyReading,
  distanceMeters,
  initialFilterState,
  shouldQueueFix,
  DEFAULT_LOCATION_CONFIG,
} from '../engineCore';
import type { EngineConfig } from '@/types/location';

function config(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return { ...DEFAULT_LOCATION_CONFIG, ...overrides };
}

function reading(overrides: Record<string, unknown> = {}) {
  return {
    latitude: 52.52,
    longitude: 13.405,
    accuracy: 8,
    altitude: null,
    altitudeAccuracy: null,
    heading: null,
    speed: null,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('distanceMeters', () => {
  it('computes one degree of latitude as ~111.2 km', () => {
    const d = distanceMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('is symmetric and zero for identical points', () => {
    expect(distanceMeters(52.5, 13.4, 52.5, 13.4)).toBeCloseTo(0, 5);
    const a = distanceMeters(52.5, 13.4, 52.5001, 13.4001);
    const b = distanceMeters(52.5001, 13.4001, 52.5, 13.4);
    expect(a).toBeCloseTo(b, 3);
    expect(a).toBeGreaterThan(10);
  });
});

describe('applyReading warm-up', () => {
  const cfg = config();

  it('requires minWarmupFixes consistent fixes before producing an uploadable fix', () => {
    let state = initialFilterState();
    const base = { accuracy: 8, speed: null, altitude: null, altitudeAccuracy: null, heading: null };

    state = applyReading(state, reading({ ...base, latitude: 52.5200, longitude: 13.4050, timestamp: 0 }), 1_000, cfg).state;
    expect(state.phase).toBe('warming');
    expect(state.warmup).toHaveLength(1);

    state = applyReading(state, reading({ ...base, latitude: 52.5201, longitude: 13.4051, timestamp: 3_000 }), 4_000, cfg).state;
    expect(state.phase).toBe('warming');
    expect(state.warmup).toHaveLength(2);

    const decision = applyReading(state, reading({ ...base, latitude: 52.5202, longitude: 13.4052, timestamp: 6_000 }), 7_000, cfg);
    expect(decision.reason).toBe('ok');
    expect(decision.fix).not.toBeNull();
    expect(decision.state.phase).toBe('ready');
  });

  it('restarts the warm-up chain when a fix is too far from the previous one', () => {
    let state = initialFilterState();
    const base = { accuracy: 8, speed: null, altitude: null, altitudeAccuracy: null, heading: null };
    state = applyReading(state, reading({ ...base, timestamp: 0 }), 1_000, cfg).state;
    state = applyReading(state, reading({ ...base, timestamp: 2_000 }), 3_000, cfg).state;
    expect(state.warmup).toHaveLength(2);

    // ~140 m away: breaks consistency -> chain resets to one entry.
    const decision = applyReading(state, reading({ ...base, latitude: 52.5213, longitude: 13.4050, timestamp: 4_000 }), 5_000, cfg);
    expect(decision.reason).toBe('warming');
    expect(decision.state.warmup).toHaveLength(1);
  });

  it('restarts the warm-up chain when fixes are too far apart in time', () => {
    let state = initialFilterState();
    const base = { accuracy: 8, speed: null, altitude: null, altitudeAccuracy: null, heading: null };
    state = applyReading(state, reading({ ...base, timestamp: 0 }), 1_000, cfg).state;
    state = applyReading(state, reading({ ...base, timestamp: 2_000 }), 3_000, cfg).state;
    // Third fix arrives 60 s later — outside the 20 s window.
    const decision = applyReading(state, reading({ ...base, timestamp: 62_000 }), 63_000, cfg);
    expect(decision.reason).toBe('warming');
    expect(decision.state.warmup).toHaveLength(1);
  });
});

describe('applyReading quality gates', () => {
  const cfg = config();

  function warmed(base: Record<string, unknown> = {}) {
    let state = initialFilterState();
    state = applyReading(state, reading({ accuracy: 8, ...base, timestamp: 0 }), 1_000, cfg).state;
    state = applyReading(state, reading({ accuracy: 8, ...base, timestamp: 3_000 }), 4_000, cfg).state;
    const decision = applyReading(state, reading({ accuracy: 8, ...base, timestamp: 6_000 }), 7_000, cfg);
    if (decision.reason !== 'ok') throw new Error('warm-up failed in test setup');
    return decision.state;
  }

  it('rejects fixes with accuracy worse than maxAccuracyM', () => {
    const state = warmed();
    const decision = applyReading(state, reading({ accuracy: 60, timestamp: 10_000 }), 11_000, cfg);
    expect(decision.reason).toBe('low_accuracy');
    expect(decision.fix).toBeNull();
    expect(decision.state.diagnostics.rejectedAccuracy).toBe(1);
  });

  it('rejects impossible teleports (way beyond GPS uncertainty and speed cap)', () => {
    const state = warmed();
    // ~5.3 km jump in 4 s.
    const decision = applyReading(state, reading({ latitude: 52.5680, longitude: 13.4050, accuracy: 8, timestamp: 10_000 }), 11_000, cfg);
    expect(decision.reason).toBe('jump');
    expect(decision.state.diagnostics.rejectedJump).toBe(1);
  });

  it('accepts legitimate sprint movement (~20 km/h)', () => {
    const state = warmed();
    const decision = applyReading(state, reading({ speed: 5.5, latitude: 52.5203, longitude: 13.4050, accuracy: 8, timestamp: 10_000 }), 11_000, cfg);
    expect(decision.reason).toBe('ok');
  });

  it('rejects fixes older than the stale limit', () => {
    const state = warmed();
    const decision = applyReading(state, reading({ timestamp: 1_600_000_000_000 }), 1_700_000_000_000, cfg);
    expect(decision.reason).toBe('stale');
  });

  it('rejects and flags mocked fixes (explicit flag)', () => {
    const state = warmed();
    const decision = applyReading(state, reading({ timestamp: 10_000, isMocked: true }), 11_000, cfg);
    expect(decision.reason).toBe('mocked');
    expect(decision.state.diagnostics.rejectedMock).toBe(1);
  });

  it('rejects mocked fixes when only the expo `mocked` prop is set', () => {
    const state = warmed();
    const decision = applyReading(state, reading({ timestamp: 10_000, mocked: true }), 11_000, cfg);
    expect(decision.reason).toBe('mocked');
  });
});

describe('EMA smoothing', () => {
  const cfg = config();

  it('returns the averaged warm-up seed as the first fix', () => {
    let state = initialFilterState();
    state = applyReading(state, reading({ latitude: 52.52, longitude: 13.4, timestamp: 0 }), 1_000, cfg).state;
    state = applyReading(state, reading({ latitude: 52.5202, longitude: 13.4002, timestamp: 3_000 }), 4_000, cfg).state;
    const decision = applyReading(state, reading({ latitude: 52.5204, longitude: 13.4004, timestamp: 6_000 }), 7_000, cfg);
    expect(decision.fix?.latitude).toBeGreaterThan(52.52);
    expect(decision.fix?.latitude).toBeLessThan(52.5204);
  });

  it('converges to the true position as good fixes keep arriving', () => {
    let state = initialFilterState();
    const truth = { latitude: 52.5712, longitude: 13.3900 };
    // Warm-up around truth with noise.
    state = applyReading(state, reading({ latitude: truth.latitude - 0.00009, longitude: truth.longitude, timestamp: 0 }), 1_000, cfg).state;
    state = applyReading(state, reading({ latitude: truth.latitude + 0.00009, longitude: truth.longitude, timestamp: 3_000 }), 4_000, cfg).state;
    const warm = applyReading(state, reading({ latitude: truth.latitude, longitude: truth.longitude, timestamp: 6_000 }), 7_000, cfg);
    expect(warm.fix).not.toBeNull();
    state = warm.state;

    const after = applyReading(state, reading({ ...truth, timestamp: 9_000 }), 10_000, cfg);
    expect(distanceMeters(after.fix!.latitude, after.fix!.longitude, truth.latitude, truth.longitude)).toBeLessThan(10);
  });
});

describe('shouldQueueFix cadence', () => {
  const cfg = config();
  const fix = {
    latitude: 52.52,
    longitude: 13.405,
    accuracy: 8,
    smoothedAccuracy: 8,
    altitude: null,
    heading: null,
    speed: 1,
    timestamp: 0,
    isMocked: false,
  };

  it('queues the very first fix', () => {
    expect(shouldQueueFix({
      fix, lastQueuedAt: null, lastQueuedPosition: null,
      lastMovementTimestamp: null, batteryLevel: 80, now: 0, config: cfg,
    })).toBe(true);
  });

  it('throttles stationary fixes to the stationary interval', () => {
    const base = {
      fix, lastQueuedAt: 0, lastQueuedPosition: { latitude: fix.latitude, longitude: fix.longitude },
      lastMovementTimestamp: null, batteryLevel: 80, config: cfg,
    };
    expect(shouldQueueFix({ ...base, now: 10_000 })).toBe(false);
    expect(shouldQueueFix({ ...base, now: 16_000 })).toBe(true);
  });

  it('moves faster while moving', () => {
    const base = {
      fix, lastQueuedAt: 0, lastQueuedPosition: { latitude: fix.latitude, longitude: fix.longitude },
      lastMovementTimestamp: 9_000, batteryLevel: 80, config: cfg,
    };
    // movingIntervalS = 8: at 10 s it may push, at 4 s not.
    expect(shouldQueueFix({ ...base, now: 4_000 })).toBe(false);
    expect(shouldQueueFix({ ...base, now: 9_000 })).toBe(true);
  });

  it('uses the low-battery interval below 15%', () => {
    const base = {
      fix, lastQueuedAt: 0, lastQueuedPosition: { latitude: fix.latitude, longitude: fix.longitude },
      lastMovementTimestamp: 9_000, batteryLevel: 10, config: cfg,
    };
    expect(shouldQueueFix({ ...base, now: 10_000 })).toBe(false);
    expect(shouldQueueFix({ ...base, now: 31_000 })).toBe(true);
  });

  it('ignores duplicates faster than the hard floor interval', () => {
    expect(shouldQueueFix({
      fix, lastQueuedAt: 1_000, lastQueuedPosition: { latitude: fix.latitude, longitude: fix.longitude },
      lastMovementTimestamp: null, batteryLevel: 80, now: 3_000, config: cfg,
    })).toBe(false);
  });
});
