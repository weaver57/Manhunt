-- =============================================================================
-- 0015: Phase 5 — Tag & catch (the core mechanic)
-- =============================================================================
-- Hardens the 0005 attempt_tag pipeline to the Phase-5 spec:
--
--   * caller identity is auth.uid() (0005 trusted the client-supplied p_chaser_id —
--     spoofable) and server timestamps are the only time authority;
--   * idempotency keys so a lost network retry never double-tags;
--   * distance envelope = catchRadiusM + (chaser accuracy + runner accuracy,
--     capped at 25 m) so GPS error stops rejecting adjacent players;
--   * cooldown after a failed attempt (button-spam guard, host-adjustable);
--   * immunity window after being caught/respawned;
--   * catch variants: tap (default), tag+runner-confirm (window, disputes go to
--     the host), QR token, auto-catch (dwell inside radius), honor system;
--   * infection mode converts the caught runner into a chaser;
--   * every catch logs a `tag` event the live feed already renders.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Event types the feed understands
-- ----------------------------------------------------------------------------
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_v2_check CHECK (event_type IN (
  'game_created', 'player_joined', 'player_left', 'role_changed', 'ready_changed',
  'game_started', 'game_paused', 'game_resumed', 'game_ended', 'host_transferred',
  'tag', 'tag_disputed', 'tag_reversed'
));

-- ----------------------------------------------------------------------------
-- Tags: variant bookkeeping
-- ----------------------------------------------------------------------------
ALTER TABLE tags ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'tap';
ALTER TABLE tags ADD COLUMN IF NOT EXISTS confirm_state text;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS chaser_accuracy_m real;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS runner_accuracy_m real;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tags ADD COLUMN IF NOT EXISTS disputed_at timestamptz;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- Honor and auto catches have no transmitting chaser fix.
ALTER TABLE tags ALTER COLUMN chaser_id DROP NOT NULL;
ALTER TABLE tags ALTER COLUMN chaser_lat DROP NOT NULL;
ALTER TABLE tags ALTER COLUMN chaser_lng DROP NOT NULL;
ALTER TABLE tags ALTER COLUMN runner_lat DROP NOT NULL;
ALTER TABLE tags ALTER COLUMN runner_lng DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tags_game_idempotency_idx ON tags (game_id, idempotency_key);
ALTER TABLE tags ADD CONSTRAINT tags_method_check CHECK (method IN ('tap', 'confirm', 'qr', 'auto', 'honor'));
ALTER TABLE tags ADD CONSTRAINT tags_confirm_state_check CHECK (
  confirm_state IS NULL OR confirm_state IN ('pending', 'confirmed', 'auto_accepted', 'disputed', 'reversed')
);

-- ----------------------------------------------------------------------------
-- Supporting tables / columns
-- ----------------------------------------------------------------------------
ALTER TABLE games ADD COLUMN IF NOT EXISTS qr_secret text;
ALTER TABLE game_players ADD COLUMN IF NOT EXISTS immunity_until timestamptz;

-- Every manual attempt is recorded, successful or not: powers the failed-tag
-- cooldown and gives the host a lightweight anti-cheat audit trail.
CREATE TABLE IF NOT EXISTS tag_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id    uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  chaser_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  runner_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reason     text NOT NULL,
  success    boolean NOT NULL DEFAULT false,
  distance_m real,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tag_attempts_chaser_fresh_idx ON tag_attempts (chaser_id, at DESC);
ALTER TABLE tag_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tag attempts visible to game players" ON tag_attempts FOR SELECT USING (
  EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = tag_attempts.game_id AND gp.user_id = auth.uid())
);

-- Auto-catch dwell tracking. Server-internal: no client policies, so RLS
-- denies everyone except the SECURITY DEFINER functions.
CREATE TABLE IF NOT EXISTS catch_dwell (
  game_id   uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  chaser_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  runner_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  since     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, chaser_id, runner_id)
);
ALTER TABLE catch_dwell ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- fresh_fix: newest stored fix inside the freshness + accuracy window.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fresh_fix(
  p_game_id uuid,
  p_user_id uuid,
  p_max_age_s integer,
  p_max_accuracy real
) RETURNS player_locations
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_loc player_locations%ROWTYPE;
BEGIN
  SELECT * INTO v_loc FROM player_locations
  WHERE game_id = p_game_id AND user_id = p_user_id
    AND recorded_at > now() - make_interval(secs => p_max_age_s)
    AND accuracy_m <= p_max_accuracy
    AND NOT is_mocked
  ORDER BY recorded_at DESC LIMIT 1;
  RETURN v_loc;
END;
$$;

-- ----------------------------------------------------------------------------
-- apply_catch: the immutable catch executor, shared by every variant.
-- Caller must already hold the runner row FOR UPDATE (see request_tag) or be
-- the only writer path (auto/honor).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_catch(
  p_game_id uuid,
  p_chaser_id uuid,          -- null for honor catches
  p_runner_id uuid,
  p_method text,
  p_chaser_lat double precision,
  p_chaser_lng double precision,
  p_chaser_accuracy real,
  p_runner_lat double precision,
  p_runner_lng double precision,
  p_runner_accuracy real,
  p_distance_m real,
  p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_game games%ROWTYPE;
  v_runner game_players%ROWTYPE;
  v_dupe tags%ROWTYPE;
  v_immunity_s integer;
  v_infected boolean := false;
  v_tag_id uuid;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  SELECT * INTO v_runner FROM game_players
  WHERE game_id = p_game_id AND user_id = p_runner_id FOR UPDATE;

  IF v_runner.role != 'runner' OR v_runner.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_already_caught', 'distance_m', p_distance_m);
  END IF;

  v_immunity_s := GREATEST(5, COALESCE((v_game.settings->>'immunitySeconds')::integer, 15));

  IF (v_game.settings->>'infectionMode')::boolean IS TRUE THEN
    v_infected := true;
    UPDATE game_players SET role = 'chaser', tagged_at = now(),
      immunity_until = now() + make_interval(secs => v_immunity_s)
    WHERE game_id = p_game_id AND user_id = p_runner_id;
  ELSE
    UPDATE game_players SET status = 'tagged', tagged_at = now(),
      immunity_until = now() + make_interval(secs => v_immunity_s)
    WHERE game_id = p_game_id AND user_id = p_runner_id;
  END IF;

  IF p_chaser_id IS NOT NULL THEN
    UPDATE game_players SET tags_made = tags_made + 1
    WHERE game_id = p_game_id AND user_id = p_chaser_id;
  END IF;

  INSERT INTO tags (game_id, chaser_id, runner_id, method, confirm_state,
    chaser_lat, chaser_lng, chaser_accuracy_m, runner_lat, runner_lng, runner_accuracy_m,
    distance_m, validated, idempotency_key, requested_at)
  VALUES (
    p_game_id, p_chaser_id, p_runner_id, p_method,
    CASE WHEN p_method = 'confirm' THEN 'pending' ELSE NULL END,
    p_chaser_lat, p_chaser_lng, p_chaser_accuracy,
    p_runner_lat, p_runner_lng, p_runner_accuracy,
    p_distance_m, true, COALESCE(p_idempotency_key, gen_random_uuid()), now()
  )
  ON CONFLICT (game_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_tag_id;

  -- Lost the race on the same idempotency key (two identical requests before
  -- either committed): replay the winning request's outcome.
  IF v_tag_id IS NULL AND p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_dupe FROM tags
    WHERE game_id = p_game_id AND idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object('success', true, 'reason', 'duplicate',
      'tag_id', v_dupe.id, 'confirm_state', v_dupe.confirm_state,
      'distance_m', v_dupe.distance_m);
  END IF;

  INSERT INTO events (game_id, actor_id, event_type, payload)
  VALUES (p_game_id, COALESCE(p_chaser_id, p_runner_id), 'tag',
    jsonb_build_object(
      'tagId', v_tag_id,
      'chaserId', p_chaser_id,
      'runnerId', p_runner_id,
      'method', p_method,
      'distanceM', round(COALESCE(p_distance_m, 0)::numeric),
      'infected', v_infected));

  -- All runners gone -> chasers win. Infection converts runners into chasers,
  -- so this check covers both classic and infection endings.
  IF NOT EXISTS (
    SELECT 1 FROM game_players
    WHERE game_id = p_game_id AND role = 'runner' AND status = 'active'
  ) THEN
    UPDATE games SET status = 'ended', ended_at = now(), winner = 'chasers'
    WHERE id = p_game_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'reason', 'tagged', 'tag_id', v_tag_id,
    'distance_m', p_distance_m, 'infected', v_infected);
END;
$$;

-- ----------------------------------------------------------------------------
-- resolve_pending_tags: confirm-mode captures self-accept after the window.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_pending_tags(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window_s integer;
BEGIN
  SELECT INTO v_window_s COALESCE((settings->>'confirmWindowS')::integer, 10)
  FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE tags SET confirm_state = 'auto_accepted'
  WHERE game_id = p_game_id AND method = 'confirm' AND confirm_state = 'pending'
    AND requested_at <= now() - make_interval(secs => GREATEST(3, v_window_s));
END;
$$;

-- ----------------------------------------------------------------------------
-- request_tag: the hardened catch endpoint (tap + confirm variants).
-- Freshness windows: runner's stored fix <= 30 s, accuracy cap 30 m (hard);
-- the accepted distance envelope adds both accuracies, capped at 25 m.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_tag(
  p_game_id uuid,
  p_runner_id uuid,
  p_idempotency_key uuid DEFAULT NULL,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_accuracy_m real DEFAULT NULL,
  p_recorded_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_game games%ROWTYPE;
  v_chaser_id uuid := auth.uid();
  v_chaser_player game_players%ROWTYPE;
  v_runner_player game_players%ROWTYPE;
  v_existing tags%ROWTYPE;
  v_runner_loc player_locations%ROWTYPE;
  v_chaser_loc player_locations%ROWTYPE;
  v_mismatch_m real;
  v_mismatch_allow real;
  v_catch_radius real;
  v_allowance real;
  v_envelope real;
  v_distance_m real;
  v_chaser_acc real;
  v_cooldown_s integer;
  v_last_fail tag_attempts%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_chaser_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_signed_in');
  END IF;

  -- Idempotent retry of an accepted key replays the stored outcome.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM tags
    WHERE game_id = p_game_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'reason', 'duplicate',
        'tag_id', v_existing.id, 'confirm_state', v_existing.confirm_state,
        'distance_m', v_existing.distance_m);
    END IF;
  END IF;

  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'game_not_found'); END IF;
  IF v_game.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'game_not_active');
  END IF;

  SELECT * INTO v_chaser_player FROM game_players
  WHERE game_id = p_game_id AND user_id = v_chaser_id FOR UPDATE;
  IF NOT FOUND OR v_chaser_player.role != 'chaser' OR v_chaser_player.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'chaser_not_active');
  END IF;

  v_catch_radius := COALESCE((v_game.settings->>'catchRadiusM')::real, 15);
  v_cooldown_s := GREATEST(0, COALESCE((v_game.settings->>'cooldownS')::integer, 5));

  -- Failed-tag cooldown (button-spam guard).
  SELECT * INTO v_last_fail FROM tag_attempts
  WHERE chaser_id = v_chaser_id AND game_id = p_game_id
  ORDER BY at DESC LIMIT 1;
  IF v_cooldown_s > 0 AND FOUND AND NOT v_last_fail.success
     AND v_last_fail.at > now() - make_interval(secs => v_cooldown_s) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'cooldown',
      'retry_in_s', GREATEST(1, CEIL(v_cooldown_s - EXTRACT(EPOCH FROM (now() - v_last_fail.at)))::integer));
  END IF;

  -- Lock the runner first: concurrent chasers serialise here and the loser
  -- gets 'runner_already_caught' from apply_catch (first valid tag wins).
  SELECT * INTO v_runner_player FROM game_players
  WHERE game_id = p_game_id AND user_id = p_runner_id FOR UPDATE;
  IF NOT FOUND OR v_runner_player.role != 'runner' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_not_in_game');
  END IF;

  -- Second idempotency check, after the lock: an identical retry that raced
  -- past the first check now replays the winner's outcome correctly.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM tags
    WHERE game_id = p_game_id AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'reason', 'duplicate',
        'tag_id', v_existing.id, 'confirm_state', v_existing.confirm_state,
        'distance_m', v_existing.distance_m);
    END IF;
  END IF;

  IF v_runner_player.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_already_caught');
  END IF;
  IF v_runner_player.immunity_until IS NOT NULL AND v_runner_player.immunity_until > now() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_immune',
      'immunity_ends_at', v_runner_player.immunity_until);
  END IF;

  -- Chaser's submitted fix. Server time is the authority: the fix must look
  -- freshly-taken when it reaches the server. -10..+30 s absorbs clock skew.
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_accuracy_m IS NULL OR p_accuracy_m < 0 OR p_accuracy_m > 100
     OR p_recorded_at IS NULL
     OR p_recorded_at < now() - interval '30 seconds'
     OR p_recorded_at > now() + interval '10 seconds' THEN
    INSERT INTO tag_attempts (game_id, chaser_id, runner_id, reason, success)
    VALUES (p_game_id, v_chaser_id, p_runner_id, 'chaser_location_stale', false);
    RETURN jsonb_build_object('success', false, 'reason', 'chaser_location_stale');
  END IF;
  v_chaser_acc := LEAST(p_accuracy_m, 25.0);

  -- Anti-spoof cross-check: the submitted fix must sit within GPS noise of
  -- the chaser's newest SERVER-side fix, and that stored fix must be fresh.
  -- Closes the "someone at a desk posts coordinates next to the runner" hole
  -- (the same trust question exists for any self-reported fix).
  v_chaser_loc := fresh_fix(p_game_id, v_chaser_id, 30, 100);
  IF v_chaser_loc IS NULL THEN
    INSERT INTO tag_attempts (game_id, chaser_id, runner_id, reason, success)
    VALUES (p_game_id, v_chaser_id, p_runner_id, 'chaser_location_stale', false);
    RETURN jsonb_build_object('success', false, 'reason', 'chaser_location_stale');
  END IF;
  v_mismatch_m := ST_Distance(
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    v_chaser_loc.geom::geography);
  v_mismatch_allow := GREATEST(60, v_chaser_loc.accuracy_m + v_chaser_acc + 25);
  IF v_mismatch_m > v_mismatch_allow THEN
    INSERT INTO tag_attempts (game_id, chaser_id, runner_id, reason, success, distance_m)
    VALUES (p_game_id, v_chaser_id, p_runner_id, 'position_mismatch', false, v_mismatch_m);
    RETURN jsonb_build_object('success', false, 'reason', 'position_mismatch');
  END IF;

  -- Runner's newest stored fix must be fresh and sane (server side of truth).
  v_runner_loc := fresh_fix(p_game_id, p_runner_id, 30, 30);
  IF v_runner_loc IS NULL THEN
    INSERT INTO tag_attempts (game_id, chaser_id, runner_id, reason, success)
    VALUES (p_game_id, v_chaser_id, p_runner_id, 'runner_location_stale', false);
    RETURN jsonb_build_object('success', false, 'reason', 'runner_location_stale');
  END IF;

  v_distance_m := ST_Distance(
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    v_runner_loc.geom::geography);

  -- GPS-error allowance: sum of both reported accuracies, capped at 25 m.
  v_allowance := LEAST(v_chaser_acc + COALESCE(v_runner_loc.accuracy_m, 0), 25.0);
  v_envelope := v_catch_radius + v_allowance;

  IF v_distance_m > v_envelope THEN
    INSERT INTO tag_attempts (game_id, chaser_id, runner_id, reason, success, distance_m)
    VALUES (p_game_id, v_chaser_id, p_runner_id, 'too_far', false, v_distance_m);
    RETURN jsonb_build_object('success', false, 'reason', 'too_far', 'distance_m', v_distance_m);
  END IF;

  v_result := apply_catch(
    p_game_id, v_chaser_id, p_runner_id,
    CASE WHEN (v_game.settings->>'tagMode') = 'confirm' THEN 'confirm' ELSE 'tap' END,
    p_lat, p_lng, v_chaser_acc,
    v_runner_loc.latitude, v_runner_loc.longitude, v_runner_loc.accuracy_m,
    v_distance_m, p_idempotency_key
  );

  IF (v_result->>'success') IS TRUE THEN
    INSERT INTO tag_attempts (game_id, chaser_id, runner_id, reason, success, distance_m)
    VALUES (p_game_id, v_chaser_id, p_runner_id, 'tagged', true, v_distance_m);
  END IF;

  RETURN v_result;
END;
$$;

-- my_qr_token: the current rotating token (and seconds until it rotates) for
-- the signed-in runner, so their phone can render the QR without network
-- round-trips during play.
CREATE OR REPLACE FUNCTION my_qr_token(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_game games%ROWTYPE;
  v_slot integer := floor(extract(epoch from now()) / 30)::integer;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF auth.uid() IS NULL OR v_game.qr_secret IS NULL OR v_game.qr_secret = '' THEN
    RETURN jsonb_build_object('token', NULL);
  END IF;
  RETURN jsonb_build_object(
    'token', qr_expected_token(v_game.qr_secret, auth.uid(), v_slot),
    'expiresInS', 30 - (extract(epoch from now())::int % 30));
END;
$$;

-- ----------------------------------------------------------------------------
-- confirm_tag: runner accepts (confirmed) or disputes a pending capture.
-- Disputes land in the host's review banner; the host can uphold or reverse.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_tag(p_game_id uuid, p_tag_id uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tag tags%ROWTYPE;
BEGIN
  SELECT * INTO v_tag FROM tags
  WHERE game_id = p_game_id AND id = p_tag_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'tag_not_found'); END IF;
  IF auth.uid() IS NULL OR v_tag.runner_id != auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_the_runner');
  END IF;
  IF v_tag.confirm_state IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_pending', 'confirm_state', v_tag.confirm_state);
  END IF;

  IF p_accept IS TRUE THEN
    UPDATE tags SET confirm_state = 'confirmed', reviewed_at = now() WHERE id = p_tag_id;
    RETURN jsonb_build_object('success', true, 'confirm_state', 'confirmed');
  END IF;

  UPDATE tags SET confirm_state = 'disputed', disputed_at = now() WHERE id = p_tag_id;
  INSERT INTO events (game_id, actor_id, event_type, payload)
  VALUES (p_game_id, auth.uid(), 'tag_disputed',
    jsonb_build_object('tagId', p_tag_id, 'chaserId', v_tag.chaser_id, 'runnerId', v_tag.runner_id));
  RETURN jsonb_build_object('success', true, 'confirm_state', 'disputed');
END;
$$;

-- ----------------------------------------------------------------------------
-- review_tag: host upholds or reverses a disputed catch. Reversing restores
-- the runner even if the catch ended the game.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION review_tag(p_game_id uuid, p_tag_id uuid, p_reverse boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tag tags%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_host');
  END IF;
  SELECT * INTO v_tag FROM tags WHERE game_id = p_game_id AND id = p_tag_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'tag_not_found'); END IF;
  IF v_tag.confirm_state IS DISTINCT FROM 'disputed' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_disputed');
  END IF;

  IF p_reverse IS NOT TRUE THEN
    UPDATE tags SET confirm_state = 'confirmed', reviewed_at = now() WHERE id = p_tag_id;
    RETURN jsonb_build_object('success', true, 'confirm_state', 'confirmed');
  END IF;

  UPDATE tags SET confirm_state = 'reversed', reviewed_at = now() WHERE id = p_tag_id;

  IF v_tag.runner_id IS NOT NULL THEN
    UPDATE game_players SET role = 'runner', status = 'active', tagged_at = NULL
    WHERE game_id = p_game_id AND user_id = v_tag.runner_id;
    UPDATE games SET status = CASE WHEN status = 'ended' THEN 'active' ELSE status END,
      winner = NULL, ended_at = NULL
    WHERE id = p_game_id AND status = 'ended';
  END IF;
  IF v_tag.chaser_id IS NOT NULL THEN
    UPDATE game_players SET tags_made = GREATEST(0, tags_made - 1)
    WHERE game_id = p_game_id AND user_id = v_tag.chaser_id;
  END IF;

  INSERT INTO events (game_id, actor_id, event_type, payload)
  VALUES (p_game_id, auth.uid(), 'tag_reversed',
    jsonb_build_object('tagId', p_tag_id, 'chaserId', v_tag.chaser_id, 'runnerId', v_tag.runner_id));
  RETURN jsonb_build_object('success', true, 'confirm_state', 'reversed');
END;
$$;

-- ----------------------------------------------------------------------------
-- honor_catch: the runner presses "I'm caught". No chaser, no countersafety.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION honor_catch(p_game_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_game games%ROWTYPE;
  v_me game_players%ROWTYPE;
  v_loc player_locations%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND OR v_game.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'game_not_active');
  END IF;
  SELECT * INTO v_me FROM game_players
  WHERE game_id = p_game_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_me.role != 'runner' OR v_me.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_not_active');
  END IF;
  v_loc := fresh_fix(p_game_id, auth.uid(), 120, 1000);  -- generous: honesty is the point
  RETURN apply_catch(p_game_id, NULL, auth.uid(), 'honor',
    NULL, NULL, NULL, v_loc.latitude, v_loc.longitude, v_loc.accuracy_m, 0);
END;
$$;

-- ----------------------------------------------------------------------------
-- QR token: rotating, secret-hosted, verifiable server-side without network
-- round trips. Token = first 8 hex chars of HMAC(secret, runner_id:slot).
-- Rotates every 30 s; the two current slots are accepted (boundary guard).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION qr_expected_token(p_secret text, p_runner_id uuid, p_epoch_s integer)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(substr(encode(hmac(p_runner_id::text || ':' || (p_epoch_s / 30)::text, p_secret, 'sha256'), 'hex'), 1, 8));
$$;

CREATE OR REPLACE FUNCTION qr_tag(
  p_game_id uuid,
  p_token text,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m real,
  p_recorded_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_game games%ROWTYPE;
  v_chaser_player game_players%ROWTYPE;
  v_runner game_players%ROWTYPE;
  v_runner_loc player_locations%ROWTYPE;
  v_chaser_loc player_locations%ROWTYPE;
  v_secret text;
  v_slot_now integer := floor(extract(epoch from now()) / 30)::integer;
  v_distance_m real;
  v_allowance real;
  v_envelope real;
  v_mismatch_m real;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('success', false, 'reason', 'not_signed_in'); END IF;
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND OR v_game.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'game_not_active');
  END IF;
  SELECT * INTO v_chaser_player FROM game_players
  WHERE game_id = p_game_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND OR v_chaser_player.role != 'chaser' OR v_chaser_player.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'chaser_not_active');
  END IF;

  v_secret := v_game.qr_secret;
  IF v_secret IS NULL OR v_secret = '' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'qr_not_ready');
  END IF;

  -- Identify the runner by token (current slot, then the last one for the
  -- rotation boundary). A screenshot lasts 30 seconds; distance is checked
  -- server-side regardless.
  SELECT gp.* INTO v_runner FROM game_players gp
  WHERE gp.game_id = p_game_id AND gp.role = 'runner' AND gp.status = 'active'
  ORDER BY CASE
    WHEN qr_expected_token(v_secret, gp.user_id, v_slot_now) = upper(trim(p_token)) THEN 0
    WHEN qr_expected_token(v_secret, gp.user_id, v_slot_now - 1) = upper(trim(p_token)) THEN 1
    ELSE 2 END
  LIMIT 1;
  IF v_runner.id IS NULL OR (
    qr_expected_token(v_secret, v_runner.user_id, v_slot_now) != upper(trim(p_token))
    AND qr_expected_token(v_secret, v_runner.user_id, v_slot_now - 1) != upper(trim(p_token))
  ) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'bad_token');
  END IF;
  SELECT * INTO v_runner FROM game_players WHERE id = v_runner.id FOR UPDATE;
  IF v_runner.role != 'runner' OR v_runner.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_already_caught');
  END IF;
  IF v_runner.immunity_until IS NOT NULL AND v_runner.immunity_until > now() THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_immune');
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL OR p_accuracy_m IS NULL
     OR p_accuracy_m < 0 OR p_accuracy_m > 100
     OR p_recorded_at IS NULL OR p_recorded_at < now() - interval '30 seconds'
     OR p_recorded_at > now() + interval '10 seconds' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'chaser_location_stale');
  END IF;

  v_runner_loc := fresh_fix(p_game_id, v_runner.user_id, 120, 100);
  IF v_runner_loc IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_location_stale');
  END IF;

  -- Same anti-spoof cross-check as request_tag: the scanning device must be
  -- where the server already believes the chaser to be.
  v_chaser_loc := fresh_fix(p_game_id, auth.uid(), 30, 100);
  IF v_chaser_loc IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'position_mismatch');
  END IF;
  v_mismatch_m := ST_Distance(
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    v_chaser_loc.geom::geography);
  IF v_mismatch_m > GREATEST(60,
      COALESCE(v_chaser_loc.accuracy_m, 0) + p_accuracy_m + 25) THEN
    RETURN jsonb_build_object('success', false, 'reason', 'position_mismatch');
  END IF;

  v_distance_m := ST_Distance(
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    v_runner_loc.geom::geography);
  v_allowance := LEAST(LEAST(p_accuracy_m, 25) + COALESCE(v_runner_loc.accuracy_m, 0), 25.0);
  v_envelope := COALESCE((v_game.settings->>'catchRadiusM')::real, 15) + v_allowance;

  -- QR proves physical presence/poor-GPS scanning: envelope is doubled and
  -- the runner fix tolerance relaxed, because that is the mode's whole point.
  IF v_distance_m > v_envelope * 2 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'too_far', 'distance_m', v_distance_m);
  END IF;

  RETURN apply_catch(p_game_id, auth.uid(), v_runner.user_id, 'qr',
    p_lat, p_lng, p_accuracy_m,
    v_runner_loc.latitude, v_runner_loc.longitude, v_runner_loc.accuracy_m, v_distance_m);
END;
$$;

-- ----------------------------------------------------------------------------
-- auto_watch_catches: keep "stayed within radius for N s" catches moving.
-- Latest known fixes only; pairs drift out of range reset their dwell timer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_watch_catches(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_game games%ROWTYPE;
  v_window_s integer;
  v_radius real;
  v_envelope real;
  v_pair record;
  v_result jsonb;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.status != 'active' THEN RETURN; END IF;
  IF (v_game.settings->>'tagMode') != 'auto' THEN
    DELETE FROM catch_dwell WHERE game_id = p_game_id;
    RETURN;
  END IF;
  v_window_s := GREATEST(3, COALESCE((v_game.settings->>'autoCatchSeconds')::integer, 30));
  v_radius := COALESCE((v_game.settings->>'catchRadiusM')::real, 15);
  v_envelope := v_radius + 25.0;  -- fixed worst-case accuracy allowance

  -- Reset dwell for pairs no longer provably together.
  DELETE FROM catch_dwell d
  WHERE d.game_id = p_game_id AND NOT EXISTS (
    SELECT 1
    FROM player_locations lc, player_locations lr
    WHERE lc.game_id = p_game_id AND lc.user_id = d.chaser_id
      AND lr.game_id = p_game_id AND lr.user_id = d.runner_id
      AND lc.recorded_at > now() - interval '30 seconds'
      AND lr.recorded_at > now() - interval '30 seconds'
      AND lc.accuracy_m <= 30 AND lr.accuracy_m <= 30
      AND NOT lc.is_mocked AND NOT lr.is_mocked
      AND ST_DWithin(lc.geom::geography, lr.geom::geography, v_envelope)
    );

  INSERT INTO catch_dwell (game_id, chaser_id, runner_id, since)
  SELECT p_game_id, c.user_id, r.user_id, now()
  FROM game_players c, game_players r
  WHERE c.game_id = p_game_id AND c.role = 'chaser' AND c.status = 'active'
    AND r.game_id = p_game_id AND r.role = 'runner' AND r.status = 'active'
    AND c.user_id != r.user_id
  ON CONFLICT (game_id, chaser_id, runner_id) DO NOTHING;

  FOR v_pair IN
    SELECT d.chaser_id, d.runner_id
    FROM catch_dwell d
    WHERE d.game_id = p_game_id
      AND now() - d.since >= make_interval(secs => v_window_s)
  LOOP
    v_result := request_tag_inner(p_game_id, v_pair.chaser_id, v_pair.runner_id, 'auto');
    IF (v_result->>'success') IS NOT TRUE THEN
      -- Catch failed (drifted out, stale fix, immunity): reset the dwell so
      -- the pair earns a fresh full window rather than firing on a fraction.
      DELETE FROM catch_dwell WHERE game_id = p_game_id
        AND chaser_id = v_pair.chaser_id AND runner_id = v_pair.runner_id;
    END IF;
  END LOOP;
END;
$$;

-- Inner auto catch: like request_tag but caller-identified (no auth.uid()).
CREATE OR REPLACE FUNCTION request_tag_inner(p_game_id uuid, p_chaser_id uuid, p_runner_id uuid, p_method text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_chaser_loc player_locations%ROWTYPE;
  v_runner_loc player_locations%ROWTYPE;
  v_runner_player game_players%ROWTYPE;
  v_distance_m real;
BEGIN
  SELECT * INTO v_runner_player FROM game_players
  WHERE game_id = p_game_id AND user_id = p_runner_id FOR UPDATE;
  IF NOT FOUND OR v_runner_player.role != 'runner' OR v_runner_player.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_already_caught');
  END IF;
  IF v_runner_player.immunity_until IS NOT NULL AND v_runner_player.immunity_until > now() THEN
    DELETE FROM catch_dwell WHERE game_id = p_game_id
      AND chaser_id = p_chaser_id AND runner_id = p_runner_id;
    RETURN jsonb_build_object('success', false, 'reason', 'runner_immune');
  END IF;

  v_chaser_loc := fresh_fix(p_game_id, p_chaser_id, 30, 30);
  v_runner_loc := fresh_fix(p_game_id, p_runner_id, 30, 30);
  IF v_chaser_loc IS NULL OR v_runner_loc IS NULL THEN RETURN jsonb_build_object('success', false, 'reason', 'position_stale'); END IF;

  v_distance_m := ST_Distance(v_chaser_loc.geom::geography, v_runner_loc.geom::geography);
  IF v_distance_m > COALESCE((SELECT (settings->>'catchRadiusM')::real FROM games WHERE id = p_game_id), 15)
     + LEAST(COALESCE(v_chaser_loc.accuracy_m, 0) + COALESCE(v_runner_loc.accuracy_m, 0), 25) THEN
    DELETE FROM catch_dwell WHERE game_id = p_game_id
      AND chaser_id = p_chaser_id AND runner_id = p_runner_id;
    RETURN jsonb_build_object('success', false, 'reason', 'too_far', 'distance_m', v_distance_m);
  END IF;

  RETURN apply_catch(p_game_id, p_chaser_id, p_runner_id, p_method,
    v_chaser_loc.latitude, v_chaser_loc.longitude, v_chaser_loc.accuracy_m,
    v_runner_loc.latitude, v_runner_loc.longitude, v_runner_loc.accuracy_m,
    v_distance_m);
END;
$$;

-- ----------------------------------------------------------------------------
-- advance_game_state: 0014 body, plus pending-tag resolution and auto-catch.
-- Runs every second while the game is live (polled by the app), so tag book-
-- keeping never needs its own scheduler.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION advance_game_state(p_game_id uuid)
RETURNS games
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_game games; v_head_start integer;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game was not found'; END IF;

  PERFORM resolve_pending_tags(p_game_id);
  IF v_game.status = 'active' THEN
    PERFORM auto_watch_catches(p_game_id);
    SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Game was not found'; END IF;
  END IF;

  IF v_game.status = 'countdown' AND v_game.countdown_ends_at <= now() THEN
    v_head_start := GREATEST(0, COALESCE((v_game.settings->>'headStartSeconds')::integer, 30));
    UPDATE games SET status = (CASE WHEN v_head_start > 0 THEN 'head_start'::game_status ELSE 'active'::game_status END)::game_status,
      head_start_ends_at = CASE WHEN v_head_start > 0 THEN now() + make_interval(secs => v_head_start) ELSE NULL END,
      started_at = CASE WHEN v_head_start = 0 THEN now() ELSE started_at END WHERE id = p_game_id RETURNING * INTO v_game;
  ELSIF v_game.status = 'head_start' AND v_game.head_start_ends_at <= now() THEN
    UPDATE games SET status = 'active', started_at = COALESCE(started_at, now()) WHERE id = p_game_id RETURNING * INTO v_game;
  ELSIF v_game.status = 'active' AND v_game.max_ends_at <= now() THEN
    UPDATE games SET status = 'ended', ended_at = now(), winner = 'runners' WHERE id = p_game_id RETURNING * INTO v_game;
  END IF;
  RETURN v_game;
END;
$$;

-- start_game: mint the QR secret (needed for QR-tag mode) alongside the rest.
CREATE OR REPLACE FUNCTION start_game(p_game_id uuid, p_force boolean DEFAULT false)
RETURNS games
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_game games; v_countdown integer; v_head_start integer;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.host_id <> auth.uid() OR v_game.status <> 'lobby' THEN
    RAISE EXCEPTION 'Only the host can start a lobby';
  END IF;
  IF NOT p_force AND EXISTS (SELECT 1 FROM game_players WHERE game_id = p_game_id AND role <> 'spectator' AND NOT is_ready) THEN
    RAISE EXCEPTION 'Not everyone is ready';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM game_players WHERE game_id = p_game_id AND role = 'chaser') THEN
    RAISE EXCEPTION 'Assign at least one chaser';
  END IF;
  v_countdown := GREATEST(3, COALESCE((v_game.settings->>'countdownSeconds')::integer, 10));
  v_head_start := GREATEST(0, COALESCE((v_game.settings->>'headStartSeconds')::integer, 30));
  UPDATE games SET status = 'countdown', countdown_ends_at = now() + make_interval(secs => v_countdown),
    max_ends_at = now() + make_interval(secs => COALESCE((settings->>'durationMinutes')::integer, 30) * 60 + v_countdown + v_head_start),
    qr_secret = COALESCE(qr_secret, encode(gen_random_bytes(16), 'hex'))
    WHERE id = p_game_id RETURNING * INTO v_game;
  UPDATE game_players SET status = (CASE WHEN role = 'spectator' THEN 'waiting'::player_status ELSE 'active'::player_status END)::player_status WHERE game_id = p_game_id;
  RETURN v_game;
END;
$$;

-- The superseded 0005 function is gone; typed client regenerates next.
DROP FUNCTION IF EXISTS attempt_tag(uuid, uuid, uuid);

GRANT EXECUTE ON FUNCTION request_tag(uuid, uuid, uuid, double precision, double precision, real, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_tag(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION review_tag(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION honor_catch(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION qr_tag(uuid, text, double precision, double precision, real, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION my_qr_token(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION advance_game_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION start_game(uuid, boolean) TO authenticated;
