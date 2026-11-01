/**
 * Pure model for Phase 6 play area.
 *
 * The phone runs the same judgement as the server (migration 0016) so the
 * warnings can render instantly and offline; the server `judge_bounds` RPC
 * stays the final judge. Every function here mirrors its SQL counterpart —
 * see the __tests__ for parity cases.
 */
import type { AreaType, GameSettings, LatLngJson, PlayArea } from '@/types/database';

// ---------------------------------------------------------------------------
// Haversine distance / edge geometry
// ---------------------------------------------------------------------------

const EARTH_R = 6_371_000;

export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Cross product of segment b with point p, in degree space (2D projection). */
function cross(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

/**
 * Signed distance from a point to a segment (metres, planar equirectangular
 * projection — accurate to ~1% at city scale, fine for warnings).
 */
function distanceToSegmentM(
  pLat: number, pLng: number,
  a: LatLngJson, b: LatLngJson,
): number {
  const midLat = (a.latitude + b.latitude) / 2 || 1e-9;
  const kx = Math.cos((midLat * Math.PI) / 180); // deg -> m scale for longitude
  const px = pLng * kx;
  const py = pLat;
  const ax = a.longitude * kx;
  const ay = a.latitude;
  const bx = b.longitude * kx;
  const by = b.latitude;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  const ex = kx * 111_320;
  return Math.hypot((px - cx) * ex, (py - cy) * 111_320);
}

// ---------------------------------------------------------------------------
// Containment checks (client-side mirror of area_contains)
// ---------------------------------------------------------------------------

/** Ray-cast point-in-polygon (boundary counts as inside). */
export function pointInPolygon(point: LatLngJson, vertices: LatLngJson[]): boolean {
  if (vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i];
    const b = vertices[j];
    // on-vertex / on-edge => treat as inside (matches ST_Contains boundary
    // tolerance closely enough for a 50 m warning band)
    if (
      point.latitude === a.latitude && point.longitude === a.longitude
    ) return true;
    const intersects =
      a.latitude > point.latitude !== b.latitude > point.latitude &&
      point.longitude <
        ((b.longitude - a.longitude) * (point.latitude - a.latitude)) /
          (b.latitude - a.latitude || 1e-12) +
          a.longitude;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInRectangle(point: LatLngJson, corners: [LatLngJson, LatLngJson]): boolean {
  const minLat = Math.min(corners[0].latitude, corners[1].latitude);
  const maxLat = Math.max(corners[0].latitude, corners[1].latitude);
  const minLng = Math.min(corners[0].longitude, corners[1].longitude);
  const maxLng = Math.max(corners[0].longitude, corners[1].longitude);
  return (
    point.latitude >= minLat && point.latitude <= maxLat &&
    point.longitude >= minLng && point.longitude <= maxLng
  );
}

/** Cheap containment for any zone shape (mirrors area_contains). */
export function zoneContains(
  zone: PlayArea,
  point: LatLngJson,
  radiusOverrideM?: number | null,
): boolean {
  const type = zone?.type;
  if (!type || type === 'none' || type === 'city_wide') return true;
  if (type === 'circle' || type === 'shrinking') {
    if (!zone.center) return true; // malformed => boundless (matches server)
    const r = radiusOverrideM ?? zone.radiusM ?? 0;
    return distanceMeters(point.latitude, point.longitude, zone.center.latitude, zone.center.longitude) <= r;
  }
  if (type === 'rectangle') {
    return zone.corners ? pointInRectangle(point, zone.corners) : false;
  }
  if (type === 'polygon') {
    return zone.vertices ? pointInPolygon(point, zone.vertices) : false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Signed edge distance (positive inside, negative outside) — mirror of the
// edgeM the server computes in judge_bounds.
// ---------------------------------------------------------------------------

export function signedEdgeDistanceM(
  area: PlayArea,
  point: LatLngJson,
  radiusOverrideM?: number | null,
): number | null {
  const type = area?.type;
  if (!type || type === 'none' || type === 'city_wide') return null;
  if (type === 'circle' || type === 'shrinking') {
    if (!area.center) return null;
    const r = radiusOverrideM ?? area.radiusM ?? 0;
    return r - distanceMeters(point.latitude, point.longitude, area.center.latitude, area.center.longitude);
  }
  if (type === 'rectangle' && area.corners) {
    const [a, b] = area.corners;
    const c: LatLngJson[] = [
      { latitude: a.latitude, longitude: a.longitude },
      { latitude: a.latitude, longitude: b.longitude },
      { latitude: b.latitude, longitude: b.longitude },
      { latitude: b.latitude, longitude: a.longitude },
    ];
    return edgeDistanceOnRing(point, c);
  }
  if (type === 'polygon' && area.vertices) {
    return edgeDistanceOnRing(point, area.vertices);
  }
  return null;
}

function edgeDistanceOnRing(point: LatLngJson, ring: LatLngJson[]): number | null {
  if (ring.length < 3) return null;
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const d = distanceToSegmentM(point.latitude, point.longitude, ring[j], ring[i]);
    if (d < best) best = d;
  }
  const inside = pointInPolygon(point, ring);
  return inside ? best : -best;
}

// ---------------------------------------------------------------------------
// Shrinking schedule — parity with shrink_radius_at / shrink_next_step (0016)
// ---------------------------------------------------------------------------

export interface ShrinkParams {
  shrinkDelayS?: number;
  shrinkStepS?: number;
  shrinkFactorK?: number;
  minRadiusM?: number;
}

function shrinkParams(settings: Pick<GameSettings, 'playArea'>): Required<ShrinkParams> {
  const cfg = (settings.playArea ?? {}) as ShrinkParams;
  return {
    shrinkDelayS: Math.max(0, cfg.shrinkDelayS ?? 180),
    shrinkStepS: Math.max(5, cfg.shrinkStepS ?? 60),
    shrinkFactorK: Math.min(1, Math.max(0.1, cfg.shrinkFactorK ?? 0.7)),
    minRadiusM: Math.max(10, cfg.minRadiusM ?? 50),
  };
}

/** Radius (m) of a shrinking zone at `nowMs` (seconds precision, server parity). */
export function shrinkRadiusM(
  settings: Pick<GameSettings, 'playArea'>,
  baseRadiusM: number,
  startedAtMs: number | null,
  nowMs: number,
): number {
  if (startedAtMs === null) return baseRadiusM;
  const { shrinkDelayS, shrinkStepS, shrinkFactorK, minRadiusM } = shrinkParams(settings);
  const startMs = startedAtMs + shrinkDelayS * 1000;
  if (nowMs <= startMs) return baseRadiusM;
  const steps = Math.floor(Math.max(0, nowMs - startMs) / (shrinkStepS * 1000));
  return Math.max(minRadiusM, Math.min(baseRadiusM, baseRadiusM * Math.pow(shrinkFactorK, steps)));
}

export interface ShrinkNext {
  /** Epoch ms of the next shrink, or null when already at the floor. */
  nextAtMs: number | null;
  nextRadiusM: number;
}

export function shrinkNext(
  settings: Pick<GameSettings, 'playArea'>,
  baseRadiusM: number,
  startedAtMs: number | null,
  nowMs: number,
): ShrinkNext {
  if (startedAtMs === null) return { nextAtMs: null, nextRadiusM: baseRadiusM };
  const { shrinkDelayS, shrinkStepS, shrinkFactorK, minRadiusM } = shrinkParams(settings);
  const startMs = startedAtMs + shrinkDelayS * 1000;
  const steps = Math.floor(Math.max(0, nowMs - startMs) / (shrinkStepS * 1000));
  const nextAtMs = startMs + (steps + 1) * shrinkStepS * 1000;
  const nextRadiusM = Math.max(minRadiusM, baseRadiusM * Math.pow(shrinkFactorK, steps + 1));
  if (nextRadiusM <= minRadiusM || nowMs >= nextAtMs) {
    return { nextAtMs: null, nextRadiusM };
  }
  return { nextAtMs, nextRadiusM };
}

// ---------------------------------------------------------------------------
// Validation (host editor): shape sanity before anything is saved
// ---------------------------------------------------------------------------

export interface AreaValidation {
  ok: boolean;
  errors: string[];
}

/** O(n²) segment intersection test — flags bow-ties and pinch points. */
export function polygonSelfIntersects(vertices: LatLngJson[]): boolean {
  if (vertices.length < 4) return false;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a1 = vertices[i];
    const a2 = vertices[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // skip segments sharing a vertex (they legitimately touch)
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = vertices[j];
      const b2 = vertices[(j + 1) % n];
      const d1 = cross(a1.longitude, a1.latitude, a2.longitude, a2.latitude, b1.longitude, b1.latitude);
      const d2 = cross(a1.longitude, a1.latitude, a2.longitude, a2.latitude, b2.longitude, b2.latitude);
      const d3 = cross(b1.longitude, b1.latitude, b2.longitude, b2.latitude, a1.longitude, a1.latitude);
      const d4 = cross(b1.longitude, b1.latitude, b2.longitude, b2.latitude, a2.longitude, a2.latitude);
      if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
          ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
        return true;
      }
    }
  }
  return false;
}

/** Rough enclosed size in km² (shoelace on an equirectangular projection). */
export function areaSizeKm2(vertices: LatLngJson[]): number {
  if (vertices.length < 3) return 0;
  const kx = Math.cos(((vertices[0].latitude) * Math.PI) / 180) * 111.32; // km per deg lng
  let sum = 0;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    sum +=
      (vertices[j].longitude * kx) * (vertices[i].latitude * 110.574) -
      (vertices[i].longitude * kx) * (vertices[j].latitude * 110.574);
  }
  return Math.abs(sum) / 2;
}

export function validateArea(area: PlayArea | null): AreaValidation {
  const errors: string[] = [];
  if (!area || area.type === 'none' || area.type === 'city_wide') {
    return { ok: true, errors };
  }
  if (area.type === 'circle' || area.type === 'shrinking') {
    if (!area.center) errors.push('Drop a centre pin on the map first.');
    const r = area.radiusM ?? 0;
    if (r < 200 || r > 10_000) {
      errors.push('Circle radius must be between 200 m and 10 km.');
    }
    if (area.type === 'shrinking') {
      const min = Math.max(10, area.minRadiusM ?? 50);
      if (min > r) errors.push('Minimum radius cannot exceed the starting radius.');
      if ((area.shrinkFactorK ?? 0.7) <= 0 || (area.shrinkFactorK ?? 0.7) > 1) {
        errors.push('Shrink factor must be between 0 and 1.');
      }
    }
  }
  if (area.type === 'rectangle') {
    if (!area.corners) {
      errors.push('Drag both rectangle corners on the map.');
    } else {
      const [a, b] = area.corners;
      if (a.latitude === b.latitude || a.longitude === b.longitude) {
        errors.push('The rectangle has zero size — drag the corners apart.');
      }
    }
  }
  if (area.type === 'polygon') {
    const verts = area.vertices ?? [];
    if (verts.length < 3) {
      errors.push('Tap at least three points to draw the boundary.');
    } else if (polygonSelfIntersects(verts)) {
      errors.push('Shape crosses itself — undo a point or redraw it.');
    } else if (areaSizeKm2(verts) < 0.01) {
      errors.push('Shape is too small to play in.');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** No-go zones layered on top of the main area. */
export function validateNoGoZones(zones: PlayArea[]): AreaValidation {
  const errors: string[] = [];
  zones.forEach((zone, idx) => {
    if (zone.type !== 'polygon' || !zone.vertices || zone.vertices.length < 3) {
      errors.push(`No-go zone #${idx + 1} must be a drawn polygon.`);
    } else if (polygonSelfIntersects(zone.vertices)) {
      errors.push(`No-go zone #${idx + 1} crosses itself.`);
    }
  });
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Boundary state machine — mirror of judge_bounds' decision table
// ---------------------------------------------------------------------------

export type BoundaryState = 'inside' | 'near_edge' | 'grace' | 'grace_paused' | 'oob_penalized';

export interface BoundaryEvalInput {
  settings: GameSettings;
  /** Absolute ms the game started (null before head start completes). */
  startedAtMs: number | null;
  point: LatLngJson;
  accuracyM: number | null;
  /** Previously reported boundary_state for this player (hysteresis memory). */
  previousState: BoundaryState;
  /** out_of_bounds_since in epoch ms, or null when inside last known. */
  outOfBoundsSinceMs: number | null;
  nowMs: number;
}

export interface BoundaryEval {
  state: BoundaryState;
  /** Signed metres from the edge (null = no boundary). */
  edgeM: number | null;
  inside: boolean;
  noGo: boolean;
  /** Seconds of the grace window still remaining (outside only). */
  graceRemainingS: number | null;
  /** Server-equivalent shrink radius for shrinking zones. */
  radiusM: number | null;
  nextShrink: ShrinkNext | null;
  /** True when this eval crosses the penalty threshold (fire penals once). */
  penaltyDue: boolean;
  /** Poor-accuracy freeze: dwell does not progress while true. */
  accuracyPaused: boolean;
}

const ACCURACY_PAUSE_M = 40;
const HYSTERESIS_M = 20;
const MIN_GRACE_S = 10;

export function evaluateBoundary(input: BoundaryEvalInput): BoundaryEval {
  const { settings, startedAtMs, point, accuracyM, nowMs } = input;
  const area = settings.playArea;
  const type: AreaType | undefined = area?.type;
  const penaltyDueDefault: BoundaryEval = {
    state: 'inside', edgeM: null, inside: true, noGo: false,
    graceRemainingS: null, radiusM: null, nextShrink: null,
    penaltyDue: false, accuracyPaused: false,
  };
  if (!area || !type || type === 'none' || type === 'city_wide') {
    return penaltyDueDefault;
  }

  const accuracyPaused = accuracyM !== null && accuracyM > ACCURACY_PAUSE_M;

  let radiusM: number | null = null;
  let inside: boolean;
  let edgeM: number | null;
  if (type === 'circle' || type === 'shrinking') {
    if (!area.center) return penaltyDueDefault;
    radiusM = type === 'shrinking'
      ? shrinkRadiusM(settings, area.radiusM ?? 500, startedAtMs, nowMs)
      : (area.radiusM ?? 0);
    edgeM = signedEdgeDistanceM(area, point, radiusM);
    inside = edgeM !== null && edgeM >= 0;
  } else {
    edgeM = signedEdgeDistanceM(area, point);
    if (edgeM === null) return penaltyDueDefault; // malformed shape => boundless
    inside = edgeM >= 0;
  }

  const noGo = (settings.noGoZones ?? []).some(
    (zone) => zoneContains(zone, point),
  );
  const oob = noGo || !inside;

  const warnM = settings.boundaryWarningM ?? 50;
  const graceS = Math.max(MIN_GRACE_S, settings.boundaryGraceS ?? 30);

  if (!oob) {
    const state: BoundaryState = edgeM !== null && edgeM <= warnM ? 'near_edge' : 'inside';
    return {
      state, edgeM, inside: true, noGo: false,
      graceRemainingS: null, radiusM,
      nextShrink: radiusM !== null
        ? shrinkNext(settings, settings.playArea?.radiusM ?? 500, startedAtMs, nowMs)
        : null,
      penaltyDue: false, accuracyPaused,
    };
  }

  // Outside (or in a no-go zone). Hysteresis: penalty needs the grace dwell
  // elapsed AND to be >= 20 m past the edge, matching judge_bounds.
  const since = input.outOfBoundsSinceMs ?? nowMs;
  const dwellS = Math.max(0, (nowMs - since) / 1000);
  // Signed distances flip negative outside, so magnitude is the only honest
  // test: hysteresis demands the fix be a full 20 m past the edge.
  const beyondOk = edgeM === null || Math.abs(edgeM) >= HYSTERESIS_M;
  const wasPenalized = input.previousState === 'oob_penalized';
  const evalResult: BoundaryEval = {
    state: wasPenalized ? 'oob_penalized' : 'grace',
    edgeM, inside: false, noGo,
    graceRemainingS: Math.max(0, Math.ceil(graceS - dwellS)),
    radiusM,
    nextShrink: radiusM !== null
      ? shrinkNext(settings, settings.playArea?.radiusM ?? 500, startedAtMs, nowMs)
      : null,
    penaltyDue: false,
    accuracyPaused,
  };
  if (accuracyPaused) evalResult.state = 'grace_paused';
  const penaltyDue = !accuracyPaused && !wasPenalized && dwellS >= graceS && beyondOk;
  if (penaltyDue) {
    evalResult.state = 'oob_penalized';
    evalResult.penaltyDue = true;
  }
  return evalResult;
}
