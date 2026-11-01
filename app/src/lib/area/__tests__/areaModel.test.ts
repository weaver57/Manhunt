import {
  areaSizeKm2,
  evaluateBoundary,
  pointInPolygon,
  pointInRectangle,
  polygonSelfIntersects,
  shrinkNext,
  shrinkRadiusM,
  signedEdgeDistanceM,
  validateArea,
  validateNoGoZones,
  zoneContains,
} from '../areaModel';
import type { GameSettings, PlayArea } from '@/types/database';

function settings(area: PlayArea | null, extra: Partial<GameSettings> = {}): GameSettings {
  return {
    durationMinutes: 30,
    catchRadiusM: 15,
    uploadIntervalS: 15,
    visibilityMode: 'periodic_pings' as GameSettings['visibilityMode'],
    runnersCanSeEachOther: false,
    headStartSeconds: 30,
    finalHuntEnabled: true,
    powerUpsEnabled: false,
    infectionMode: false,
    playArea: area,
    noGoZones: [],
    pingIntervalS: 120,
    tagMode: 'tap',
    immunitySeconds: 15,
    confirmWindowS: 10,
    cooldownS: 5,
    autoCatchSeconds: 30,
    boundaryGraceS: 30,
    boundaryWarningM: 50,
    boundaryPenalty: 'reveal',
    ...extra,
  };
}

/** ~ (0, 0), degrees: ~111,320 m per degree of latitude (metres -> degrees). */
const DEG = 111_320;
const within = (m: number): PlayArea => ({
  type: 'circle',
  center: { latitude: 0, longitude: 0 },
  radiusM: m,
});

// ---------------------------------------------------------------------------
// Containment primitives
// ---------------------------------------------------------------------------

describe('pointInPolygon', () => {
  const square: PlayArea = {
    type: 'polygon',
    vertices: [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 },
      { latitude: 1, longitude: 0 },
    ],
  };

  it('contains interior points and rejects outside points', () => {
    expect(zoneContains(square, { latitude: 0.5, longitude: 0.5 })).toBe(true);
    expect(zoneContains(square, { latitude: 1.5, longitude: 0.5 })).toBe(false);
  });

  it('handles concave shapes a bbox test would wrongly accept', () => {
    const concave: PlayArea = {
      type: 'polygon',
      vertices: [
        { latitude: 0, longitude: 0 },
        { latitude: 2, longitude: 0 },
        { latitude: 2, longitude: 2 },
        { latitude: 1, longitude: 2 },
        { latitude: 1, longitude: 1 },
        { latitude: 0, longitude: 1 },
      ],
    };
    // the notch (lat 0..1, lng 1..2) is OUTSIDE the L-shape, inside its bbox
    expect(zoneContains(concave, { latitude: 0.5, longitude: 1.5 })).toBe(false);
    expect(zoneContains(concave, { latitude: 1.5, longitude: 1.5 })).toBe(true);
  });

  it('treats vertices as inside so players standing on a corner are not oob', () => {
    expect(pointInPolygon({ latitude: 0, longitude: 0 }, square.vertices!)).toBe(true);
  });
});

describe('pointInRectangle', () => {
  it('is ordering-agnostic over the two dragged corners', () => {
    const a = { latitude: 1, longitude: 1 };
    const b = { latitude: 2, longitude: 2 };
    expect(pointInRectangle({ latitude: 1.5, longitude: 1.5 }, [a, b])).toBe(true);
    expect(pointInRectangle({ latitude: 1.5, longitude: 1.5 }, [b, a])).toBe(true);
    expect(pointInRectangle({ latitude: 2.1, longitude: 1.5 }, [a, b])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shrinking schedule â€” must match the SQL exactly
// ---------------------------------------------------------------------------

describe('shrink schedule parity with migration 0016', () => {
  const cfg = settings({ type: 'shrinking', center: { latitude: 0, longitude: 0 }, radiusM: 1000 });
  const start = 1_700_000_000_000;

  it('holds the base radius until the delay elapses', () => {
    expect(shrinkRadiusM(cfg, 1000, start, start + 179_999)).toBe(1000);
    expect(shrinkRadiusM(cfg, 1000, start, start)).toBe(1000);
  });

  it('applies factor^steps after the delay, stepping every 60 s', () => {
    // the first step fires one full step interval after the delay ends
    expect(shrinkRadiusM(cfg, 1000, start, start + 180_000)).toBe(1000);  // boundary: at the delay instant
    expect(shrinkRadiusM(cfg, 1000, start, start + 239_999)).toBe(1000);  // still inside step 1's window
    expect(shrinkRadiusM(cfg, 1000, start, start + 240_000)).toBeCloseTo(700); // step 1 lands
    expect(shrinkRadiusM(cfg, 1000, start, start + 299_999)).toBeCloseTo(700);
    expect(shrinkRadiusM(cfg, 1000, start, start + 300_000)).toBeCloseTo(490); // step 2
  });

  it('never drops below the min radius floor', () => {
    expect(shrinkRadiusM(cfg, 1000, start, start + 60 * 60_000)).toBe(50);
  });

  it('falls back to base radius before the game has started', () => {
    expect(shrinkRadiusM(cfg, 1000, null, start)).toBe(1000);
  });

  it('reports the next step time and radius, nulling at the floor', () => {
    // next step = delay end + one step interval; radius after that step
    expect(shrinkNext(cfg, 1000, start, start)).toEqual({ nextAtMs: start + 240_000, nextRadiusM: 700 });
    const flat = shrinkNext(cfg, 1000, start, start + 3600_000 * 1000);
    expect(flat.nextAtMs).toBeNull();
    expect(flat.nextRadiusM).toBeLessThanOrEqual(50);
  });

  it('honours custom host knobs (fast, shallow shrink)', () => {
    const custom = settings({
      type: 'shrinking', center: { latitude: 0, longitude: 0 }, radiusM: 1000,
      shrinkDelayS: 0, shrinkStepS: 10, shrinkFactorK: 0.5, minRadiusM: 100,
    });
    expect(shrinkRadiusM(custom, 1000, start, start + 20_000)).toBeCloseTo(250);
    expect(shrinkRadiusM(custom, 1000, start, start + 120_000)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Signed edge distance
// ---------------------------------------------------------------------------

describe('signedEdgeDistanceM', () => {
  it('is positive inside a circle and equates radius minus distance', () => {
    expect(signedEdgeDistanceM(within(1000), { latitude: 0, longitude: 0 }, 1000)).toBeCloseTo(1000, 0);
    expect(signedEdgeDistanceM(within(1000), { latitude: 10 / DEG, longitude: 0 }, 1000)).toBeCloseTo(990, 0);
  });

  it('is negative beyond the edge, magnitude growing outward', () => {
    const outside = signedEdgeDistanceM(within(1000), { latitude: 1011 / DEG, longitude: 0 }, 1000);
    expect(outside).toBeLessThan(0);
    expect(Math.abs(outside!)).toBeGreaterThan(5);
  });

  it('measures distance to the nearest rectangle edge', () => {
    const rect: PlayArea = {
      type: 'rectangle',
      corners: [{ latitude: 0, longitude: 0 }, { latitude: 1000 / DEG, longitude: 1000 / DEG }],
    };
    // the centre is ~500 m from every edge
    expect(signedEdgeDistanceM(rect, { latitude: 500 / DEG, longitude: 500 / DEG })).toBeCloseTo(500, 0);
    const nearEdge = signedEdgeDistanceM(rect, { latitude: 995 / DEG, longitude: 500 / DEG });
    expect(nearEdge).toBeGreaterThan(0);
    expect(nearEdge).toBeLessThan(15);
  });
});

// ---------------------------------------------------------------------------
// Validation (host editor)
// ---------------------------------------------------------------------------

describe('validateArea and polygon sanity', () => {
  it('flags bow-tie (self-crossing) polygons', () => {
    const bowtie: PlayArea = {
      type: 'polygon',
      vertices: [
        { latitude: 0, longitude: 0 },
        { latitude: 1, longitude: 1 },
        { latitude: 1, longitude: 0 },
        { latitude: 0, longitude: 1 },
      ],
    };
    expect(polygonSelfIntersects(bowtie.vertices!)).toBe(true);
    expect(validateArea(bowtie).ok).toBe(false);
  });

  it('accepts a normal polygon but rejects too-few points', () => {
    const tri: PlayArea = {
      type: 'polygon',
      vertices: [
        { latitude: 0, longitude: 0 },
        { latitude: 0.1, longitude: 0.1 },
        { latitude: 0.1, longitude: 0 },
      ],
    };
    expect(validateArea(tri).ok).toBe(true);
    expect(validateArea({ type: 'polygon', vertices: tri.vertices!.slice(0, 2) }).ok).toBe(false);
  });

  it('enforces the circle radius range 200 m .. 10 km', () => {
    expect(validateArea(within(150)).ok).toBe(false);
    expect(validateArea(within(200)).ok).toBe(true);
    expect(validateArea(within(10_000)).ok).toBe(true);
    expect(validateArea(within(10_500)).ok).toBe(false);
  });

  it('rejects a zero-size rectangle', () => {
    expect(validateArea({
      type: 'rectangle',
      corners: [{ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 }],
    }).ok).toBe(false);
  });

  it('always accepts boundless area types', () => {
    expect(validateArea(null).ok).toBe(true);
    expect(validateArea({ type: 'none' }).ok).toBe(true);
    expect(validateArea({ type: 'city_wide' }).ok).toBe(true);
  });

  it('no-go zones must be valid self-contained polygons', () => {
    expect(validateNoGoZones([{ type: 'none' }]).ok).toBe(false);
    expect(validateNoGoZones([{
      type: 'polygon',
      vertices: [
        { latitude: 0, longitude: 0 },
        { latitude: 0.01, longitude: 0.01 },
        { latitude: 0.01, longitude: 0 },
      ],
    }]).ok).toBe(true);
  });

  it('size estimation is in the sane kmÂ² range', () => {
    // 1Â° x 1Â° square near the equator ~ 12,300 kmÂ²
    const size = areaSizeKm2([
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
      { latitude: 1, longitude: 1 },
      { latitude: 0, longitude: 1 },
    ]);
    expect(size).toBeGreaterThan(10_000);
    expect(size).toBeLessThan(13_000);
  });
});

// ---------------------------------------------------------------------------
// Boundary state machine â€” hysteresis is the stress target here
// ---------------------------------------------------------------------------

/**
 * Walker helper: feeds successive GPS evals keeping the previous state and
 * freeze time so dwell is controlled exactly.
 */
function walk(settingsIn: GameSettings, startedAtMs: number) {
  let state: ReturnType<typeof evaluateBoundary>['state'] = 'inside';
  let oobSince: number | null = null;
  return (lat: number, lng: number, atMs: number, accuracy = 5) => {
    const result = evaluateBoundary({
      settings: settingsIn,
      startedAtMs,
      point: { latitude: lat, longitude: lng },
      accuracyM: accuracy,
      previousState: state,
      outOfBoundsSinceMs: oobSince,
      nowMs: atMs,
    });
    state = result.state;
    if (result.inside && !result.noGo) oobSince = null;
    else if (state !== 'oob_penalized') oobSince = oobSince ?? atMs;
    return result;
  };
}

describe('boundary state machine hysteresis', () => {
  const cfg = settings(within(1000)); // warning 50, grace 30
  const start = 1_700_000_000_000;

  it('warns within 50 m of the edge, quiet beyond it', () => {
    const near = evaluateBoundary({
      settings: cfg, startedAtMs: start,
      point: { latitude: 970 / DEG, longitude: 0 }, accuracyM: 5,
      previousState: 'inside', outOfBoundsSinceMs: null, nowMs: start,
    });
    expect(near.state).toBe('near_edge');
    const deep = evaluateBoundary({
      settings: cfg, startedAtMs: start,
      point: { latitude: 0, longitude: 0 }, accuracyM: 5,
      previousState: 'inside', outOfBoundsSinceMs: null, nowMs: start,
    });
    expect(deep.state).toBe('inside');
  });

  it('stays in grace until dwell AND 20 m hysteresis are both satisfied', () => {
    const step = walk(cfg, start);
    const r1 = step(1020 / DEG, 0, start + 1000);
    expect(r1.state).toBe('grace');
    expect(r1.penaltyDue).toBe(false);
    const r2 = step(1015 / DEG, 0, start + 46_000);
    expect(r2.state).toBe('grace');
    expect(r2.penaltyDue).toBe(false);
    // walks fully out (30 m past): now both conditions hold -> penalty fires
    const r3 = step(1030 / DEG, 0, start + 47_000);
    expect(r3.state).toBe('oob_penalized');
    expect(r3.penaltyDue).toBe(true);
  });

  it('GPS bounce in and out early never penalizes a returning player', () => {
    const step = walk(cfg, start);
    expect(step(1025 / DEG, 0, start + 1000).state).toBe('grace');   // drifts out
    expect(step(980 / DEG, 0, start + 5000).state).toBe('near_edge'); // bounces back
    expect(step(1025 / DEG, 0, start + 9000).state).toBe('grace');    // drifts again
    expect(step(1035 / DEG, 0, start + 20_000).state).toBe('grace');  // dwell only 11 s
    // full dwell + well past: penalized exactly once
    const r = step(1040 / DEG, 0, start + 40_000);
    expect(r.penaltyDue).toBe(true);
  });

  it('poor GPS accuracy pauses the dwell (grace_paused)', () => {
    const r = evaluateBoundary({
      settings: cfg, startedAtMs: start,
      point: { latitude: 1040 / DEG, longitude: 0 },
      accuracyM: 60, previousState: 'inside',
      outOfBoundsSinceMs: start - 120_000, nowMs: start + 5000,
    });
    expect(r.accuracyPaused).toBe(true);
    expect(r.state).toBe('grace_paused');
    expect(r.penaltyDue).toBe(false);
  });

  it('penalizes exactly once â€” repeated evals at the same spot do not refire', () => {
    const step = walk(cfg, start);
    const warmup = step(1060 / DEG, 0, start + 60_000); // starts the dwell clock
    expect(warmup.state).toBe('grace');
    const first = step(1060 / DEG, 0, start + 91_000); // 31 s dwell, 60 m past
    expect(first.penaltyDue).toBe(true);
    const repeat = step(1060 / DEG, 0, start + 101_000);
    expect(repeat.state).toBe('oob_penalized');
    expect(repeat.penaltyDue).toBe(false); // would double-count otherwise
  });

  it('walking back inside clears the oob dwell', () => {
    const step = walk(cfg, start);
    expect(step(1020 / DEG, 0, start + 1000).state).toBe('grace');
    expect(step(960 / DEG, 0, start + 6000).state).toBe('near_edge'); // edge ~40 m <= warning 50
    expect(step(1020 / DEG, 0, start + 8000).state).toBe('grace'); // fresh dwell, not 8 s old
  });

  it('entering a no-go zone reads as out of bounds', () => {
    const noGo: GameSettings = {
      ...cfg,
      noGoZones: [{
        type: 'polygon',
        vertices: [
          { latitude: 0, longitude: 0 },
          { latitude: 0, longitude: 0.001 },
          { latitude: 0.001, longitude: 0.001 },
          { latitude: 0.001, longitude: 0 },
        ],
      }],
    };
    const r = evaluateBoundary({
      settings: noGo, startedAtMs: start,
      point: { latitude: 0.0005, longitude: 0.0005 }, accuracyM: 5,
      previousState: 'inside', outOfBoundsSinceMs: null, nowMs: start + 1000,
    });
    expect(r.noGo).toBe(true);
    expect(r.state).toBe('grace');
  });

  it('shrinking circle pulls the boundary past a stationary player and penalizes', () => {
    const shrinkCfg = settings({
      type: 'shrinking',
      center: { latitude: 0, longitude: 0 },
      radiusM: 1000,
      shrinkDelayS: 0,
      shrinkStepS: 10,
      shrinkFactorK: 0.5,
      minRadiusM: 100,
    });
    const step = walk(shrinkCfg, start);
    // player at 700 m: after 20 s the radius is 250 m, so they are outside
    const r = step(700 / DEG, 0, start + 60_000);
    expect(r.inside).toBe(false);
    expect(r.radiusM).toBe(100); // min floor by then
  });

  it('boundless area types never penalize', () => {
    const none = settings(null);
    const r = evaluateBoundary({
      settings: none, startedAtMs: start,
      point: { latitude: 50, longitude: 50 }, accuracyM: 5,
      previousState: 'oob_penalized', outOfBoundsSinceMs: start, nowMs: start,
    });
    expect(r.state).toBe('inside');
    expect(r.penaltyDue).toBe(false);
  });
});
