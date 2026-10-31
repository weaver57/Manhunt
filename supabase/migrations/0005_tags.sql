-- =============================================================================
-- Migration 0005: Tags and the attempt_tag() server function
-- =============================================================================

CREATE TABLE tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  chaser_id    uuid NOT NULL REFERENCES profiles(id),
  runner_id    uuid NOT NULL REFERENCES profiles(id),
  tagged_at    timestamptz NOT NULL DEFAULT now(),
  chaser_lat   double precision NOT NULL,
  chaser_lng   double precision NOT NULL,
  runner_lat   double precision NOT NULL,
  runner_lng   double precision NOT NULL,
  distance_m   real NOT NULL,
  validated    boolean NOT NULL DEFAULT false
);

CREATE INDEX tags_game_id_idx ON tags (game_id);

-- RLS
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tags readable by players in the game"
  ON tags FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM game_players gp
      WHERE gp.game_id = tags.game_id AND gp.user_id = auth.uid()
    )
  );

-- Tags are created only via the attempt_tag() function (SECURITY DEFINER),
-- so no direct INSERT policy is needed for authenticated users.

-- =============================================================================
-- attempt_tag(): The core anti-cheat function
-- Called by the app; validates the tag server-side and returns result.
-- =============================================================================

CREATE OR REPLACE FUNCTION attempt_tag(
  p_game_id  uuid,
  p_chaser_id uuid,
  p_runner_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER   -- runs as postgres, not the calling user
AS $$
DECLARE
  v_game          games%ROWTYPE;
  v_catch_radius  real;
  v_chaser_loc    player_locations%ROWTYPE;
  v_runner_loc    player_locations%ROWTYPE;
  v_distance_m    real;
  v_chaser_player game_players%ROWTYPE;
  v_runner_player game_players%ROWTYPE;
  v_max_age_s     integer := 30;   -- locations older than this are rejected
  v_max_accuracy  real    := 30;   -- metres
BEGIN
  -- 1. Verify the game exists and is active
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND OR v_game.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'game_not_active', 'distance_m', null);
  END IF;

  v_catch_radius := COALESCE((v_game.settings ->> 'catchRadiusM')::real, 15);

  -- 2. Verify chaser is active
  SELECT * INTO v_chaser_player
  FROM game_players
  WHERE game_id = p_game_id AND user_id = p_chaser_id;

  IF NOT FOUND OR v_chaser_player.role != 'chaser' OR v_chaser_player.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'chaser_not_active', 'distance_m', null);
  END IF;

  -- 3. Verify runner is active (not already tagged)
  SELECT * INTO v_runner_player
  FROM game_players
  WHERE game_id = p_game_id AND user_id = p_runner_id;

  IF NOT FOUND OR v_runner_player.role != 'runner' OR v_runner_player.status != 'active' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_not_active', 'distance_m', null);
  END IF;

  -- 4. Get chaser's most recent location (must be fresh and accurate)
  SELECT * INTO v_chaser_loc
  FROM player_locations
  WHERE game_id = p_game_id
    AND user_id = p_chaser_id
    AND recorded_at > now() - (v_max_age_s || ' seconds')::interval
    AND accuracy_m <= v_max_accuracy
    AND NOT is_mocked
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'chaser_location_stale', 'distance_m', null);
  END IF;

  -- 5. Get runner's most recent location (same freshness requirements)
  SELECT * INTO v_runner_loc
  FROM player_locations
  WHERE game_id = p_game_id
    AND user_id = p_runner_id
    AND recorded_at > now() - (v_max_age_s || ' seconds')::interval
    AND accuracy_m <= v_max_accuracy
    AND NOT is_mocked
  ORDER BY recorded_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'runner_location_stale', 'distance_m', null);
  END IF;

  -- 6. Calculate distance using PostGIS (spheroid for accuracy)
  v_distance_m := ST_Distance(
    v_chaser_loc.geom::geography,
    v_runner_loc.geom::geography
  );

  -- 7. Check catch radius
  IF v_distance_m > v_catch_radius THEN
    RETURN jsonb_build_object('success', false, 'reason', 'too_far', 'distance_m', v_distance_m);
  END IF;

  -- 8. Everything checks out — record the tag
  INSERT INTO tags (
    game_id, chaser_id, runner_id,
    chaser_lat, chaser_lng, runner_lat, runner_lng,
    distance_m, validated
  ) VALUES (
    p_game_id, p_chaser_id, p_runner_id,
    v_chaser_loc.latitude, v_chaser_loc.longitude,
    v_runner_loc.latitude, v_runner_loc.longitude,
    v_distance_m, true
  );

  -- 9. Update runner status to tagged
  UPDATE game_players
  SET status = 'tagged', tagged_at = now()
  WHERE game_id = p_game_id AND user_id = p_runner_id;

  -- 10. Increment chaser's tag count
  UPDATE game_players
  SET tags_made = tags_made + 1
  WHERE game_id = p_game_id AND user_id = p_chaser_id;

  -- 11. Check if all runners are tagged → chasers win
  IF NOT EXISTS (
    SELECT 1 FROM game_players
    WHERE game_id = p_game_id AND role = 'runner' AND status = 'active'
  ) THEN
    UPDATE games SET status = 'ended', ended_at = now(), winner = 'chasers'
    WHERE id = p_game_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'reason', 'tagged', 'distance_m', v_distance_m);
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION attempt_tag(uuid, uuid, uuid) TO authenticated;
