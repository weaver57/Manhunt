import {
  bearingDegrees,
  boundsAround,
  EXTRAPOLATION_SPEED_CAP_MS,
  formatDistanceM,
  headingRotationDeg,
  isVisibleTo,
  lastSeenLabel,
  markerFreshness,
  metersPerPixel,
  nearestOpponent,
  playAreaOnlyBounds,
  renderPosition,
  stackMarkers,
  uncertaintyRadiusM,
  type MarkerFix,
} from '../mapModel';
import { DEFAULT_GAME_SETTINGS, type GameSettings } from '@/types/database';

const BASE = { accuracy: 8, speed: null, heading: null };

function fix(overrides: Partial<MarkerFix> = {}): MarkerFix {
  return { latitude: 52.52, longitude: 13.405, ...BASE, timestamp: 10_000, ...overrides } as MarkerFix;
}

describe('bearingDegrees', () => {
  it('returns 0 for due north, 90 for east', () => {
    expect(bearingDegrees({ latitude: 52, longitude: 13 }, { latitude: 52.01, longitude: 13 })).toBeCloseTo(0, 1);
    expect(bearingDegrees({ latitude: 52, longitude: 13 }, { latitude: 52, longitude: 13.01 })).toBeCloseTo(90, 0);
  });

  it('normalises to 0..360 even when wrapping', () => {
    expect(bearingDegrees({ latitude: 48.11, longitude: 16.51 }, { latitude: 48.1, longitude: 16.5 })).toBeGreaterThan(180);
  });
});

describe('renderPosition (never teleport dots)', () => {
  it('interpolates between the previous and current fix at the midpoint of time', () => {
    const previous = fix({ latitude: 52.52, longitude: 13.405, timestamp: 0 });
    const current = fix({ latitude: 52.5202, longitude: 13.405, timestamp: 2000 });
    const at = renderPosition({ previous, current, now: 1000 });
    expect(at.latitude).toBeCloseTo(52.5201, 9);
    expect(at.longitude).toBeCloseTo(13.405, 9);
  });

  it('dead-reckons along the reported heading after the current fix', () => {
    const current = fix({ latitude: 52.52, longitude: 13.405, speed: 2, heading: 0, timestamp: 0 });
    const at = renderPosition({ previous: null, current, now: 2000 });
    // 2 m/s for 2 s northward = ~2 m = ~1.8e-5 deg.
    expect(at.latitude).toBeGreaterThan(52.52);
    expect(at.latitude).toBeCloseTo(52.52 + 4 / 111_320, 6);
    expect(at.longitude).toBeCloseTo(13.405, 9);
  });

  it('caps dead reckoning both in time and speed', () => {
    const current = fix({ latitude: 52.52, longitude: 0, speed: 50, heading: 0, timestamp: 0 });
    const at = renderPosition({ previous: null, current, now: 60_000 });
    const lead = EXTRAPOLATION_SPEED_CAP_MS * 4; // maxLeadMs 4000 * cap 8
    expect(at.latitude - 52.52).toBeCloseTo(lead / 111_320, 6);
  });

  it('falls back to the A->B bearing when heading is unknown, and freezes without a bearing', () => {
    const previous = fix({ latitude: 52.52, longitude: 0, timestamp: 0, speed: 2 });
    const current = fix({ latitude: 52.5202, longitude: 0, speed: null, heading: null, timestamp: 1000 });
    const extrapolated = renderPosition({ previous, current, now: 3000 });
    expect(extrapolated.latitude).toBeGreaterThan(52.5202);

    const frozen = renderPosition({ previous: null, current: fix({ speed: null, heading: null, timestamp: 0 }), now: 9999 });
    expect(frozen.latitude).toBeCloseTo(52.52, 12);
    expect(frozen.longitude).toBeCloseTo(13.405, 12);
  });

  it('ignores previous fixes that are newer than the current one (out-of-order streams)', () => {
    const previous = fix({ latitude: 999, longitude: 999, timestamp: 5_000 });
    const current = fix({ latitude: 52.52, longitude: 13.405, timestamp: 60_000 });
    const at = renderPosition({ previous, current, now: 60_000 });
    expect(at.latitude).toBeCloseTo(52.52, 12);
  });
});

describe('staleness', () => {
  it('buckets freshness', () => {
    expect(markerFreshness(5_000)).toBe('live');
    expect(markerFreshness(30_000)).toBe('recent');
    expect(markerFreshness(120_000)).toBe('stale');
    expect(markerFreshness(400_000)).toBe('offline');
  });

  it('labels age for the "last seen" pill', () => {
    expect(lastSeenLabel(5_000)).toBe('just now');
    expect(lastSeenLabel(40_000)).toBe('40s ago');
    expect(lastSeenLabel(90_000)).toBe('2m ago');
    expect(lastSeenLabel(60 * 60_000)).toBe('1h ago');
  });

  it('grows the uncertainty circle with age and caps it', () => {
    expect(uncertaintyRadiusM(0, 10)).toBe(10);
    expect(uncertaintyRadiusM(50_000, 10)).toBeGreaterThan(10);
    expect(uncertaintyRadiusM(600000, null)).toBeLessThanOrEqual(150);
  });
});

describe('isVisibleTo (visibility rules)', () => {
  const settings: GameSettings = { ...DEFAULT_GAME_SETTINGS, runnersCanSeEachOther: false };
  const trustSettings: GameSettings = { ...DEFAULT_GAME_SETTINGS, runnersCanSeEachOther: true };

  it('shows self always and spectators everything', () => {
    expect(isVisibleTo({ viewerId: 'me', viewerRole: 'runner', targetId: 'me', targetRole: 'runner', settings })).toBe(true);
    expect(isVisibleTo({ viewerId: 'spec', viewerRole: 'spectator', targetId: 'r1', targetRole: 'runner', settings })).toBe(true);
    expect(isVisibleTo({ viewerId: 'spec', viewerRole: 'spectator', targetId: 'c1', targetRole: 'chaser', settings })).toBe(true);
  });

  it('chasers see runners and their team', () => {
    expect(isVisibleTo({ viewerId: 'c1', viewerRole: 'chaser', targetId: 'r1', targetRole: 'runner', settings })).toBe(true);
    expect(isVisibleTo({ viewerId: 'c1', viewerRole: 'chaser', targetId: 'c2', targetRole: 'chaser', settings })).toBe(true);
    expect(isVisibleTo({ viewerId: 'c1', viewerRole: 'chaser', targetId: 'x', targetRole: undefined, settings })).toBe(false);
  });

  it('runners never see chaser positions; other runners depend on the setting', () => {
    expect(isVisibleTo({ viewerId: 'r1', viewerRole: 'runner', targetId: 'c1', targetRole: 'chaser', settings })).toBe(false);
    expect(isVisibleTo({ viewerId: 'r1', viewerRole: 'runner', targetId: 'r2', targetRole: 'runner', settings })).toBe(false);
    expect(isVisibleTo({ viewerId: 'r1', viewerRole: 'runner', targetId: 'r2', targetRole: 'runner', settings: trustSettings })).toBe(true);
    // Unknown roles are hidden for runner viewers (no accidental leaks).
    expect(isVisibleTo({ viewerId: 'r1', viewerRole: 'runner', targetId: 'x', targetRole: undefined, settings })).toBe(false);
  });
});

describe('nearestOpponent (HUD hints)', () => {
  const fixes: Record<string, MarkerFix> = {
    me: fix({ latitude: 0, longitude: 0, timestamp: 0 }),
    chaser1: fix({ latitude: 0.001, longitude: 0, timestamp: 0 }) as MarkerFix & { role?: 'chaser' },
    runner1: fix({ latitude: 0.002, longitude: 0, timestamp: 0 }) as MarkerFix & { role?: 'runner' },
  };
  (fixes.chaser1 as MarkerFix & { role: 'chaser' }).role = 'chaser';
  (fixes.runner1 as MarkerFix & { role: 'runner' }).role = 'runner';

  it('gives runners their nearest chaser and vice versa', () => {
    expect(nearestOpponent({ userId: 'me', role: 'runner', fixes, now: 1000 })?.targetId).toBe('chaser1');
    expect(nearestOpponent({ userId: 'me', role: 'chaser', fixes, now: 1000 })?.targetId).toBe('runner1');
    expect(nearestOpponent({ userId: 'me', role: 'spectator', fixes, now: 1000 })).toBeNull();
  });

  it('formats distances as metres or kilometres', () => {
    expect(formatDistanceM(340.2)).toBe('340 m');
    expect(formatDistanceM(1200)).toBe('1.2 km');
  });

  it('ignores stale fixes and itself', () => {
    const stale: Record<string, MarkerFix> = {
      me: fix({ timestamp: 0 }),
      chaser1: fix({ timestamp: -600_000, latitude: 0.001 }) as MarkerFix & { role?: 'chaser' },
    };
    (stale.chaser1 as MarkerFix & { role: 'chaser' }).role = 'chaser';
    expect(nearestOpponent({ userId: 'me', role: 'runner', fixes: stale, now: 0 })).toBeNull();
  });
});

describe('stackMarkers (overlap -> cluster)', () => {
  it('groups markers within 12 m and keeps others solo', () => {
    const clusters = stackMarkers([
      { id: 'a', position: { latitude: 0, longitude: 0 } },
      { id: 'b', position: { latitude: 0, longitude: 0.00005 } }, // ~3.7 m
      { id: 'c', position: { latitude: 0, longitude: 0.01 } }, // ~740 m away
    ]);
    expect(clusters).toHaveLength(2);
    const pair = clusters.find((c) => c.members.includes('a'));
    expect(pair?.members).toEqual(['a', 'b']);
  });

  it('does not loop forever on far-apart markers and is id-stable', () => {
    const input = [
      { id: 'z', position: { latitude: 10, longitude: 10 } },
      { id: 'a', position: { latitude: 20, longitude: 20 } },
    ];
    expect(stackMarkers(input)).toHaveLength(2);
    // same input in reverse order -> same clusters
    const reversed = stackMarkers([...input].reverse()).map((c) => c.members);
    expect(reversed).toEqual([['a'], ['z']]);
  });
});

describe('bounds + misc maths', () => {
  it('boundsAround encloses points plus the play circle with padding', () => {
    const bounds = boundsAround({
      points: [{ latitude: 52.5, longitude: 13.4 }],
      playArea: { center: { latitude: 52.5, longitude: 13.4 }, radiusM: 1000 },
      padM: 100,
    });
    const latSpan = bounds[1][1] - bounds[0][1];
    // 2 * (1000 + 100) m + a bit of the point itself
    expect(latSpan * 111_320).toBeGreaterThan(2190);
    expect(latSpan * 111_320).toBeLessThan(2300);
    expect(bounds[0][0]).toBeLessThan(13.4);
  });

  it('playAreaOnlyBounds covers radius + padding around the center', () => {
    const bounds = playAreaOnlyBounds({ center: { latitude: 0, longitude: 0 }, radiusM: 1000 });
    // playAreaOnlyBounds pads by radius + PACK_PAD (300) -> 1300 m half-span.
    expect(bounds[1][1]).toBeCloseTo(1300 / 111_320, 6);
    expect(bounds[0][1]).toBeCloseTo(-1300 / 111_320, 6);
  });

  it('metersPerPixel halves per zoom level', () => {
    expect(metersPerPixel(10, 0) / metersPerPixel(11, 0)).toBeCloseTo(2, 3);
  });

  it('heading rotation is plain heading in north-up and zero in heading-up', () => {
    expect(headingRotationDeg(90, false)).toBe(90);
    expect(headingRotationDeg(90, true)).toBe(0);
    expect(headingRotationDeg(null, false)).toBe(0);
    expect(headingRotationDeg(450, false)).toBe(90);
  });
});
