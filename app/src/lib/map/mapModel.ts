/**
 * Pure model for the Phase 4 live map.
 *
 * Everything here is deterministic (all functions take `now` / explicit
 * inputs) so the marker pipeline can be unit-tested without React Native or
 * the native MapLibre module.
 *
 * Responsibilities:
 *  - marker movement interpolation / dead reckoning (never teleport dots);
 *  - staleness states ("last seen 40s ago") and the expanding uncertainty
 *    circle radius;
 *  - visibility rules (who sees whose marker);
 *  - nearest-opponent hints for the HUD;
 *  - marker stacking (overlap -> cluster bubble);
 *  - offline-pack bounds;
 *  - auxiliary maths (bearing, meters-per-pixel, heading rotation).
 */
import { distanceMeters } from '../location/engineCore';
import type { GameSettings, PlayerRole } from '@/types/database';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface MarkerFix extends LatLng {
  /** GPS accuracy in metres (null when the device did not report it). */
  accuracy: number | null;
  /** m/s; null when unavailable. */
  speed: number | null;
  /** Degrees clockwise from north; null when unknown. */
  heading: number | null;
  /** Fix epoch in milliseconds. */
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Movement interpolation / dead reckoning
// ---------------------------------------------------------------------------

/**
 * How far past the newest fix we dead-reckon before freezing the marker.
 * Upload cadence is 8-15 s, so a 4 s lead bridges the gap smoothly without
 * dreaming long distances when a player stops server-side updates.
 */
export const MAX_RENDER_LEAD_MS = 4_000;
/** Hard cap for extrapolated speed in the renderer (28.8 km/h). */
export const EXTRAPOLATION_SPEED_CAP_MS = 8;

const EARTH_LAT_M = 111_320;

/** Degrees clockwise from true north from `from` to `to`. */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const dLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export interface RenderPositionInput {
  previous: MarkerFix | null;
  current: MarkerFix;
  now: number;
  /** Overrides MAX_RENDER_LEAD_MS (test seam). */
  maxLeadMs?: number;
}

/**
 * Where the marker should be drawn at `now`.
 *
 * 1. Between the previous and current fix: exact linear interpolation
 *    (positions streamed slightly late arrive as a jump — spread it out).
 * 2. After the current fix: dead reckon along the reported heading (or the
 *    A->B bearing), capped by both time and speed. Never leve the fix trail.
 * 3. Nothing to lean on: freeze at the current fix.
 */
export function renderPosition({ previous, current, now, maxLeadMs = MAX_RENDER_LEAD_MS }: RenderPositionInput): LatLng {
  const prev = previous;
  if (prev && prev.timestamp < current.timestamp) {
    const spanMs = current.timestamp - prev.timestamp;
    const t = (now - prev.timestamp) / spanMs;
    if (t <= 1) {
      return {
        latitude: prev.latitude + (current.latitude - prev.latitude) * t,
        longitude: prev.longitude + (current.longitude - prev.longitude) * t,
      };
    }
  }

  const leadMs = Math.max(0, Math.min(now - current.timestamp, maxLeadMs));
  if (leadMs === 0) return { latitude: current.latitude, longitude: current.longitude };

  // Preferred direction: reported heading; otherwise A->B bearing; else none.
  let moveBearing: number | null = null;
  if (current.heading !== null && Number.isFinite(current.heading)) moveBearing = current.heading;
  else if (prev && prev.timestamp < current.timestamp && distanceMeters(prev.latitude, prev.longitude, current.latitude, current.longitude) > 0.5) {
    moveBearing = bearingDegrees(prev, current);
  }
  if (moveBearing === null) {
    return { latitude: current.latitude, longitude: current.longitude };
  }

  let speedMs = current.speed ?? null;
  if ((speedMs === null || !Number.isFinite(speedMs)) && prev && current.timestamp > prev.timestamp) {
    const gapS = (current.timestamp - prev.timestamp) / 1000;
    const walked = distanceMeters(prev.latitude, prev.longitude, current.latitude, current.longitude);
    if (gapS > 0) speedMs = walked / gapS;
  }
  const capped = Math.min(speedMs ?? 0, EXTRAPOLATION_SPEED_CAP_MS);
  const leadS = (leadMs / 1000) * (capped > 0 ? 1 : 0);
  if (capped === 0 || leadS === 0) {
    return { latitude: current.latitude, longitude: current.longitude };
  }

  // 1 deg latitude ~ EARTH_LAT_M; longitude shrinks with cos(lat).
  const latFactor = EARTH_LAT_M;
  const lngFactor = EARTH_LAT_M * Math.cos((current.latitude * Math.PI) / 180);
  const distM = capped * leadS;
  const rad = (moveBearing * Math.PI) / 180;
  return {
    latitude: current.latitude + (distM * Math.cos(rad)) / latFactor,
    longitude: current.longitude + (distM * Math.sin(rad)) / lngFactor,
  };
}

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

export const FRESH_MS = 10_000;
export const RECENT_MS = 40_000;
export const STALE_MS = 5 * 60_000;

export type MarkerFreshness = 'live' | 'recent' | 'stale' | 'offline';

export function markerFreshness(ageMs: number): MarkerFreshness {
  if (ageMs <= FRESH_MS) return 'live';
  if (ageMs <= RECENT_MS) return 'recent';
  if (ageMs <= STALE_MS) return 'stale';
  return 'offline';
}

/** "just now" / "Ns ago" / "Nm ago" (>= an hour falls back to the minutes label). */
export function lastSeenLabel(ageMs: number): string {
  if (ageMs <= FRESH_MS) return 'just now';
  const s = Math.round(ageMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

/**
 * Radius of the expanding uncertainty circle.
 * While fresh: the reported accuracy. Stale: accuracy + drift allowance,
 * capped so it never swallows the map.
 */
export function uncertaintyRadiusM(ageMs: number, accuracyM: number | null, capM = 150): number {
  const base = accuracyM ?? 15;
  if (ageMs <= FRESH_MS) return Math.min(base, capM);
  const driftMs = (ageMs - FRESH_MS) / 1000;
  return Math.min(base + driftMs * 0.6, capM);
}

// ---------------------------------------------------------------------------
// Visibility rules
// ---------------------------------------------------------------------------

export interface VisibilityInput {
  viewerId: string;
  viewerRole: PlayerRole | undefined;
  targetId: string;
  targetRole: PlayerRole | undefined;
  settings: GameSettings;
}

/**
 * Minimal Phase-4 visibility rules (Phase 7 refines modes/fuzz/pings).
 *  - spectators and chasers see every slot;
 *  - runners see other runners only when `runnersCanSeEachOther`;
 *  - runner viewers never see chaser positions (HUD shows only distance);
 *  - unknown target roles are treated as hidden for runner viewers.
 */
export function isVisibleTo({ viewerId, viewerRole, targetId, targetRole, settings }: VisibilityInput): boolean {
  if (viewerId === targetId) return true;
  if (viewerRole === 'spectator') return true;
  if (viewerRole === 'chaser') return targetRole !== undefined;
  // Runner viewer:
  if (targetRole === 'runner') return settings.runnersCanSeEachOther;
  return false;
}

// ---------------------------------------------------------------------------
// Opponent hints (HUD)
// ---------------------------------------------------------------------------

export interface OpponentHint {
  targetId: string;
  distanceM: number;
  /** 'chaser' hint for a runner viewer; 'runner' hint for a chaser viewer. */
  targetRole: PlayerRole;
}

/**
 * Distance to the nearest opponent for the HUD.
 * Runners -> nearest chaser; chasers -> nearest runner. Works on raw fixes
 * (not interpolated render positions) so labels stay honest.
 */
export function nearestOpponent(input: {
  userId: string;
  role: PlayerRole | undefined;
  fixes: Record<string, MarkerFix>;
  now: number;
  /** Fixes older than this are ignored (default: stale cutoff). */
  maxAgeMs?: number;
}): OpponentHint | null {
  const { userId, role, fixes, now, maxAgeMs = STALE_MS } = input;
  if (role === 'runner') return nearestOf(['chaser'], { userId, fixes, now, maxAgeMs });
  if (role === 'chaser') return nearestOf(['runner'], { userId, fixes, now, maxAgeMs });
  return null;
}

function nearestOf(targetRoles: PlayerRole[], { userId, fixes, now, maxAgeMs }: { userId: string; fixes: Record<string, MarkerFix>; now: number; maxAgeMs: number }): OpponentHint | null {
  const me = fixes[userId];
  if (!me) return null;
  let best: OpponentHint | null = null;
  for (const [targetId, fix] of Object.entries(fixes)) {
    if (targetId === userId) continue;
    if (now - fix.timestamp > maxAgeMs) continue;
    const targetRole = (fix as MarkerFix & { role?: PlayerRole }).role;
    if (!targetRole || !targetRoles.includes(targetRole)) continue;
    const distanceM = distanceMeters(me.latitude, me.longitude, fix.latitude, fix.longitude);
    if (!best || distanceM < best.distanceM) {
      best = { targetId, distanceM, targetRole };
    }
  }
  return best;
}

/** Human metres label ("340", "1.2 km"). */
export function formatDistanceM(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// ---------------------------------------------------------------------------
// Marker stacking (overlap -> cluster)
// ---------------------------------------------------------------------------

export const STACK_METERS = 12;

export interface StackEntry<ID> {
  id: ID;
  position: LatLng;
}

export interface StackCluster<ID> {
  /** >1 -> stacked bubble rendering the member ids. */
  members: ID[];
  position: LatLng;
}

/**
 * Group markers closer than STACK_METERS together. Greedy: stable against
 * iteration order changes of the input (sorted by id first).
 */
export function stackMarkers<ID extends string>(entries: StackEntry<ID>[]): StackCluster<ID>[] {
  const sorted = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  const clusters: StackCluster<ID>[] = [];
  for (const entry of sorted) {
    const near = clusters.find((cluster) =>
      cluster.members.some((id) => {
        const member = sorted.find((candidate) => candidate.id === id)!;
        return distanceMeters(member.position.latitude, member.position.longitude, entry.position.latitude, entry.position.longitude) <= STACK_METERS;
      }),
    );
    if (near) {
      const centerLat = (near.position.latitude * near.members.length + entry.position.latitude) / (near.members.length + 1);
      const centerLng = (near.position.longitude * near.members.length + entry.position.longitude) / (near.members.length + 1);
      near.members.push(entry.id);
      near.position = { latitude: centerLat, longitude: centerLng };
    } else {
      clusters.push({ members: [entry.id], position: { ...entry.position } });
    }
  }
  return clusters;
}

// ---------------------------------------------------------------------------
// Offline pack bounds
// ---------------------------------------------------------------------------

export const PACK_PAD_M = 300;
/** Play-area packs cover materialisation of tiles down to street level. */
export const PACK_MAX_ZOOM = 14;
export const PACK_MIN_ZOOM = 8;

export type TileBounds = [[number, number], [number, number]];

/**
 * Tightest [[minLng, minLat], [maxLng, maxLat]] box covering all points plus
 * the circular play area, each expanded by `padM`.
 */
export function boundsAround(input: { points: LatLng[]; padM?: number; playArea?: { center: LatLng; radiusM: number } | null }): TileBounds {
  const padM = input.padM ?? PACK_PAD_M;
  const lats: number[] = [];
  const lngs: number[] = [];

  const push = (lat: number, lng: number) => {
    lats.push(lat);
    lngs.push(lng);
  };

  for (const point of input.points) push(point.latitude, point.longitude);
  const area = input.playArea;
  if (area) {
    const degLat = area.radiusM / EARTH_LAT_M;
    const degLng = area.radiusM / (EARTH_LAT_M * Math.cos((area.center.latitude * Math.PI) / 180) || 1);
    push(area.center.latitude - degLat, area.center.longitude - degLng);
    push(area.center.latitude + degLat, area.center.longitude + degLng);
  }

  if (!lats.length) {
    return [
      [-180, -85],
      [180, 85],
    ];
  }

  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const padDegLat = padM / EARTH_LAT_M;
  const padDegLng = padM / (EARTH_LAT_M * Math.cos((latMid * Math.PI) / 180));
  return [
    [Math.min(...lngs) - padDegLng, Math.min(...lats) - padDegLat],
    [Math.max(...lngs) + padDegLng, Math.max(...lats) + padDegLat],
  ];
}

/** Bounds covering the play area only (used when no points are known yet). */
export function playAreaOnlyBounds(area: { center: LatLng; radiusM: number }): TileBounds {
  return boundsAround({ points: [area.center], padM: area.radiusM + PACK_PAD_M });
}

// ---------------------------------------------------------------------------
// Misc maths
// ---------------------------------------------------------------------------

/** Web-Mercator metres-per-screen-point at a zoom level and latitude. */
export function metersPerPixel(zoom: number, latitude: number): number {
  return (156_543.03392 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Rotation for the self heading cone. Heading-up mode keeps the screen
 * rotated with the device so the cone never rotates (0 deg).
 */
export function headingRotationDeg(heading: number | null, headingUpCamera: boolean): number {
  if (headingUpCamera || heading === null || !Number.isFinite(heading)) return 0;
  return ((heading % 360) + 360) % 360;
}

export const FOLLOW_ZOOM = 16;
