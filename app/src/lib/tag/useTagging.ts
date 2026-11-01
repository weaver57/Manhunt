/**
 * Runtime surface for Phase 5 tag & catch.
 *
 * Every catch decision goes through the server RPCs (0015). This hook handles
 * the parts the server can't: optimistic submission, the offline queue for
 * tagged-while-no-network attempts (flushed on reconnect), cooldown gating
 * after server-rejected attempts, and quick taps that must never fire.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@/types/database';
import type { TagResultJson } from '@/types/database';
import { supabase } from '@/lib/supabase/client';
import {
  cooldownRemainingMs,
  pruneTagQueue,
  shouldQueueTag,
} from './tagModel';

type TagRow = Database['public']['Tables']['tags']['Row'];

// ---------------------------------------------------------------------------
// Offline queue (AsyncStorage-backed, pruned at 60 s age like uploads.ts)
// ---------------------------------------------------------------------------

const QUEUE_KEY = 'manhunt.tagQueue.v1';

interface QueuedTag {
  gameId: string;
  runnerId: string;
  idempotencyKey: string;
  lat: number;
  lng: number;
  accuracyM: number;
  /** ISO of the fix used (client clock); the server re-checks freshness. */
  recordedAt: string;
  queuedAtMs: number;
}

async function loadQueue(): Promise<QueuedTag[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedTag[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedTag[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // storage full/locked: the queue is best-effort; the retry loop re-saves.
  }
}

/** UUID-shaped id for the idempotency column (uuid type). */
function makeIdempotencyKey(): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

export interface TagRunnerInput {
  runnerId: string;
  lat: number;
  lng: number;
  accuracyM: number | null;
  /** Fix timestamp ms; server clock is the authority, this is just freshness. */
  fixTimestampMs: number;
}

export interface TagState {
  /** in-progress submission exists. */
  submitting: boolean;
  /** ms left on the failed-tag cooldown (0 = can press). */
  cooldownMs: number;
  /** Server/user-visible failure line ready to render. */
  failure: string | null;
  /** Last successful catch result (for the success flash). */
  success: TagResultJson | null;
  /** Number of tag attempts waiting for a network. */
  queued: number;
}

// ---------------------------------------------------------------------------
// Hook: tag runner (tap/confirm/qr) + honor catch + offline queue flush
// ---------------------------------------------------------------------------

export function useTagging(input: {
  gameId: string | undefined;
  /** Live cooldown window from settings; usually 5 s. */
  cooldownS: number;
}) {
  const { gameId, cooldownS } = input;
  const queryClient = useQueryClient();
  const [state, setState] = useState<TagState>({
    submitting: false, cooldownMs: 0, failure: null, success: null, queued: 0,
  });
  // Ticks the cooldown down once per interval while it is running.
  const [cooldownTick, setCooldownTick] = useState(0);
  const cooldownUntilRef = useRef(0);
  const cooldownRunning = state.cooldownMs > 0;

  useEffect(() => {
    if (!cooldownRunning) return;
    const t = setInterval(() => setCooldownTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [cooldownRunning]);

  // Refresh queued-count + flush when connectivity returns.
  useEffect(() => {
    void loadQueue().then((q) => setState((s) => ({ ...s, queued: q.length })));
  }, [gameId]);

  const applyFailure = useCallback((message: string | null, retryInMs = 0) => {
    if (retryInMs > 0) cooldownUntilRef.current = Date.now() + retryInMs;
    setState((s) => ({ ...s, failure: message, cooldownMs: retryInMs > 0 ? retryInMs : s.cooldownMs }));
  }, []);

  const applySuccess = useCallback((result: TagResultJson) => {
    setState((s) => ({ ...s, success: result, failure: null, cooldownMs: 0 }));
  }, []);

  // ---- flush the offline queue ----------------------------------------------
  const flushingRef = useRef(false);
  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      let queue = await loadQueue();
      const remaining: QueuedTag[] = [];
      for (const item of queue) {
        if (!pruneTagQueue(item.queuedAtMs, Date.now())) continue; // too stale
        const { data, error } = await supabase.rpc('request_tag', {
          p_game_id: item.gameId,
          p_runner_id: item.runnerId,
          p_idempotency_key: item.idempotencyKey,
          p_lat: item.lat,
          p_lng: item.lng,
          p_accuracy_m: item.accuracyM,
          p_recorded_at: item.recordedAt,
        });
        if (error) {
          if (shouldQueueTag(error)) {
            remaining.push(item);
            break; // still offline; keep the rest in order
          }
          // server-side rejection: drop (server already judged it)
          continue;
        }
        if (data && (data as TagResultJson).success) applySuccess(data as TagResultJson);
      }
      await saveQueue(remaining);
      setState((s) => ({ ...s, queued: remaining.length }));
    } finally {
      flushingRef.current = false;
    }
  }, [applySuccess]);

  // ---- queue flush wiring: on regaining connectivity -------------------------
  const wasOnlineRef = useRef<boolean | null>(null);
  useOnlineTransition((online) => {
    if (online) void flushQueue();
  }, wasOnlineRef);

  // ---- tag runner -------------------------------------------------------------
  const enqueue = useCallback(async (item: QueuedTag) => {
    const queue = (await loadQueue()).concat(item);
    await saveQueue(queue);
    setState((s) => ({ ...s, queued: queue.length }));
  }, []);

  const doTag = useCallback(async (payload: TagRunnerInput) => {
    if (!gameId) {
      applyFailure('No game loaded.');
      return;
    }
    const nowMs = Date.now();
    const remaining = cooldownRemainingMs(cooldownUntilRef.current, nowMs, cooldownS);
    if (remaining > 0) {
      applyFailure(`Tag is recharging — ${Math.ceil(remaining / 1000)}s left.`, remaining);
      return;
    }
    setState((s) => ({ ...s, submitting: true }));
    try {
      const { data, error } = await supabase.rpc('request_tag', {
        p_game_id: gameId,
        p_runner_id: payload.runnerId,
        p_idempotency_key: makeIdempotencyKey(),
        p_lat: payload.lat,
        p_lng: payload.lng,
        p_accuracy_m: payload.accuracyM ?? 0,
        p_recorded_at: new Date(payload.fixTimestampMs).toISOString(),
      });
      if (error) {
        if (shouldQueueTag(error)) {
          await enqueue({
            gameId,
            runnerId: payload.runnerId,
            idempotencyKey: makeIdempotencyKey(),
            lat: payload.lat,
            lng: payload.lng,
            accuracyM: payload.accuracyM ?? 0,
            recordedAt: new Date(payload.fixTimestampMs).toISOString(),
            queuedAtMs: nowMs,
          });
          applyFailure('No network — tag queued and will retry automatically.');
        } else {
          applyFailure(error.message);
        }
        return;
      }
      const result = data as TagResultJson;
      if (result?.success) {
        applySuccess(result);
        void queryClient.invalidateQueries({ queryKey: ['game-lobby', gameId] });
      } else {
        const retry = typeof result?.retry_in_s === 'number' ? result.retry_in_s * 1000 : 0;
        applyFailure(serverReasonToMessage(result), retry);
      }
    } catch (err) {
      if (shouldQueueTag(err)) {
        await enqueue({
          gameId,
          runnerId: payload.runnerId,
          idempotencyKey: makeIdempotencyKey(),
          lat: payload.lat,
          lng: payload.lng,
          accuracyM: payload.accuracyM ?? 0,
          recordedAt: new Date(payload.fixTimestampMs).toISOString(),
          queuedAtMs: nowMs,
        });
        applyFailure('No network — tag queued and will retry automatically.');
      } else {
        applyFailure('Tag failed unexpectedly. Try again.');
      }
    } finally {
      setState((s) => ({ ...s, submitting: false }));
    }
  }, [gameId, cooldownS, applyFailure, applySuccess, enqueue, queryClient]);

  // honor catch (runner presses "I'm caught")
  const doHonorCatch = useCallback(async () => {
    if (!gameId) return;
    setState((s) => ({ ...s, submitting: true }));
    try {
      const { data, error } = await supabase.rpc('honor_catch', { p_game_id: gameId });
      if (error) applyFailure(error.message);
      else {
        const result = data as TagResultJson;
        if (result?.success) applySuccess(result);
        else applyFailure(serverReasonToMessage(result));
      }
    } finally {
      setState((s) => ({ ...s, submitting: false }));
    }
  }, [gameId, applyFailure, applySuccess]);

  // QR tag (chaser scanned the runner's rotating code)
  const doQrTag = useCallback(async (payload: {
    token: string;
    lat: number;
    lng: number;
    accuracyM: number | null;
    fixTimestampMs: number;
  }) => {
    if (!gameId) return;
    setState((s) => ({ ...s, submitting: true }));
    try {
      const { data, error } = await supabase.rpc('qr_tag', {
        p_game_id: gameId,
        p_token: payload.token,
        p_lat: payload.lat,
        p_lng: payload.lng,
        p_accuracy_m: payload.accuracyM ?? 0,
        p_recorded_at: new Date(payload.fixTimestampMs).toISOString(),
      });
      if (error) applyFailure(error.message);
      else {
        const result = data as TagResultJson;
        if (result?.success) applySuccess(result);
        else applyFailure(serverReasonToMessage(result));
      }
    } finally {
      setState((s) => ({ ...s, submitting: false }));
    }
  }, [gameId, applyFailure, applySuccess]);

  // tick the local cooldown toward zero so the UI re-enables the button
  useEffect(() => {
    const remaining = cooldownRemainingMs(cooldownUntilRef.current, Date.now(), cooldownS);
    setState((s) => (s.cooldownMs !== remaining ? { ...s, cooldownMs: remaining } : s));
  }, [cooldownTick, cooldownS]);

  // runner answers a pending confirm-variant capture
  const doConfirm = useCallback(async (tagId: string, accept: boolean) => {
    if (!gameId) return;
    try {
      const { error } = await supabase.rpc('confirm_tag', { p_game_id: gameId, p_tag_id: tagId, p_accept: accept });
      if (error) applyFailure(error.message);
    } catch {
      applyFailure('Could not answer the catch — check your network.');
    }
  }, [gameId, applyFailure]);

  // host upholds or reverses a disputed catch
  const doReview = useCallback(async (tagId: string, reverse: boolean) => {
    if (!gameId) return;
    try {
      const { error } = await supabase.rpc('review_tag', { p_game_id: gameId, p_tag_id: tagId, p_reverse: reverse });
      if (error) applyFailure(error.message);
      else void queryClient.invalidateQueries({ queryKey: ['game-lobby', gameId] });
    } catch {
      applyFailure('Could not resolve the dispute — check your network.');
    }
  }, [gameId, applyFailure, queryClient]);

  return useMemo(() => ({
    ...state,
    tagRunner: doTag,
    honorCatch: doHonorCatch,
    qrTag: doQrTag,
    confirmCapture: doConfirm,
    reviewCapture: doReview,
    flushQueue,
  }), [state, doTag, doHonorCatch, doQrTag, doConfirm, doReview, flushQueue]);
}

/** Clean copy for the main server rejections (fallback: raw reason). */
export function serverReasonToMessage(result: TagResultJson | null): string {
  if (!result) return 'Tag failed. Try again.';
  switch (result.reason) {
    case 'too_far':
      return `Too far — about ${result.distance_m != null ? Math.round(result.distance_m) : '?'} m.`;
    case 'cooldown':
      return `Tag is recharging — ${Math.max(1, Math.ceil(result.retry_in_s ?? 1))}s left.`;
    case 'runner_already_caught':
    case 'runner_not_active':
      return 'That runner is already caught.';
    case 'runner_location_stale':
      return 'Runner location too old — wait for their GPS.';
    case 'chaser_location_stale':
      return 'Your GPS is stale — step outside, hold still, tag again.';
    case 'position_mismatch':
      return 'Your GPS disagreed with the server — stand still a few seconds.';
    case 'runner_immune':
      return 'That runner is immune right now (just caught).';
    case 'game_not_active':
      return 'Tagging is off outside the active game.';
    case 'bad_token':
      return 'That QR code expired — scan the fresh one.';
    case 'position_stale':
      return 'Locations too old — wait for fresh GPS.';
    default:
      return `Tag failed (${result.reason ?? 'unknown'}). Try again.`;
  }
}

/** Minimal helper: run `cb` exactly once per offline->online transition. */
function useOnlineTransition(cb: (online: boolean) => void, wasOnlineRef: MutableRefObject<boolean | null>) {
  // minimal netinfo subscription independent of the caller's useNetInfo()
  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    void (async () => {
      try {
        const netinfo = await import('@react-native-community/netinfo');
        unsubscribe = netinfo.addEventListener((net) => {
          if (!mounted) return;
          const online = net.isConnected === true && net.isInternetReachable !== false;
          const prev = wasOnlineRef.current;
          wasOnlineRef.current = online;
          if (online && prev === false) cb(online);
        });
      } catch {
        // netinfo unavailable: no auto-flush; the queue also flushes on start.
      }
    })();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
    // cb identity changes are fine; we only want the subscription once.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---------------------------------------------------------------------------
// Pending confirm / disputes polls
// ---------------------------------------------------------------------------

export function usePendingConfirm(gameId: string | undefined, runnerId: string | undefined, active: boolean) {
  return useQuery({
    queryKey: ['tags-pending', gameId, runnerId],
    enabled: !!gameId && !!runnerId && active,
    queryFn: async (): Promise<TagRow | null> => {
      if (!gameId || !runnerId) return null;
      const { data } = await supabase
        .from('tags')
        .select('*')
        .eq('game_id', gameId)
        .eq('runner_id', runnerId)
        .eq('confirm_state', 'pending')
        .order('requested_at', { ascending: false })
        .limit(1);
      return (data?.[0] as TagRow) ?? null;
    },
    refetchInterval: 2000,
    staleTime: 1000,
  });
}

export function useDisputedTags(gameId: string | undefined, isHost: boolean) {
  return useQuery({
    queryKey: ['tags-disputed', gameId],
    enabled: !!gameId && isHost,
    queryFn: async (): Promise<TagRow[]> => {
      if (!gameId) return [];
      const { data } = await supabase
        .from('tags')
        .select('*')
        .eq('game_id', gameId)
        .eq('confirm_state', 'disputed')
        .order('disputed_at', { ascending: false })
        .limit(10);
      return (data as TagRow[]) ?? [];
    },
    refetchInterval: 5000,
    staleTime: 2000,
  });
}

// ---------------------------------------------------------------------------
// Runner QR (rotating token): the runner's phone renders the code the chaser
// scans. my_qr_token mints the current 30 s server-side token.
// ---------------------------------------------------------------------------

export interface MyQrToken {
  token: string | null;
  /** Seconds until the token rotates (0 when unknown). */
  expiresInS: number;
}

export function useMyQrToken(gameId: string | undefined, enabled: boolean): MyQrToken | null {
  const [token, setToken] = useState<MyQrToken | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setTick((n) => n + 1), 2500);
    return () => clearInterval(t);
  }, [enabled]);

  useEffect(() => {
    if (!gameId || !enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await supabase.rpc('my_qr_token', { p_game_id: gameId });
        if (cancelled) return;
        const row = data as { token: string | null; expiresInS?: number } | null;
        setToken(row?.token ? { token: row.token, expiresInS: row.expiresInS ?? 0 } : null);
      } catch {
        // offline: keep showing the last token; it rotates server-side anyway.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId, enabled, tick]);

  return token;
}
