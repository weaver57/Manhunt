-- =============================================================================
-- 0016: Phase 6 — Play area & boundary judging
-- =============================================================================
--  * judge_bounds(): server-side final judge for boundary behavior — warning
--    at boundaryWarningM (default 50) from the edge, grace period outside
--    (default 30 s), then the host-selected penalty (reveal/time/disqualify/
--    points). GPS bounce is absorbed by hysteresis: a penalty requires the
--    grace dwell to have elapsed AND the player to be 20 m past the edge;
--    poor GPS accuracy (> 40 m) freezes the outbound dwell instead of
--    punishing drift.
--  * shrink_radius_at(): shrinking-zone radius is a pure function of settings
--    + server time — the single clock authority. The app renders the same
--    schedule locally, so warnings and the next-circle outline match.
--  * zones: circle, shrinking circle, rectangle (two dragged corners),
--    custom polygon (ST_Contains), no-go zones (inverse check).
--  * areas table: saved per-host area templates.
-- =============================================================================

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_event_type_v2_check;
ALTER TABLE events ADD CONSTRAINT events_event_type_v3_check CHECK (event_type IN (
  'game_created', 'player_joined', 'player_left', 'role_changed', 'ready_changed',
  'game_started', 'game_paused', 'game_resumed', 'game_ended', 'host_transferred',
  'tag', 'tag_disputed', 'tag_reversed',
  'zone_warning', 'zone_penalty'
));

ALTER TABLE game_players
  ADD COLUMN IF NOT EXISTS out_of_bounds_since timestamptz,
  ADD COLUMN IF NOT EXISTS boundary_state text NOT NULL DEFAULT 'inside',
  ADD COLUMN IF NOT EXISTS oob_penalty_count integer NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Shrinking schedule (pure function of settings + server time).
--   shrinkDelayS:  seconds after game start before shrinking begins (default 180)
--   shrinkStepS:   interval between radius steps (default 60)
--   shrinkFactorK: multiplier per step (default 0.7)
--   minRadiusM:    floor (default 50)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shrink_radius_at(
  p_settings jsonb,
  p_base_radius real,
  p_started_at timestamptz,
  p_now timestamptz
) RETURNS real
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_delay integer;
  v_step integer;
  v_factor real;
  v_min real;
  v_start timestamptz;
  v_steps integer;
BEGIN
  IF p_started_at IS NULL THEN RETURN p_base_radius; END IF;
  v_delay := GREATEST(0, COALESCE((p_settings->>'shrinkDelayS')::integer, 180));
  v_step := GREATEST(5, COALESCE((p_settings->>'shrinkStepS')::integer, 60));
  v_factor := LEAST(1.0, GREATEST(0.1, COALESCE((p_settings->>'shrinkFactorK')::real, 0.7)));
  v_min := GREATEST(10, COALESCE((p_settings->>'minRadiusM')::real, 50));
  v_start := p_started_at + make_interval(secs => v_delay);
  IF p_now <= v_start THEN RETURN p_base_radius; END IF;
  v_steps := floor(GREATEST(0, EXTRACT(EPOCH FROM (p_now - v_start))) / v_step)::integer;
  RETURN GREATEST(v_min, LEAST(p_base_radius, p_base_radius * power(v_factor, v_steps)::real));
END;
$$;

-- ---------------------------------------------------------------------------
-- Epoch-millis time of the next step + the radius it produces. nextAtMs NULL
-- means the shrink already sits at the floor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shrink_next_step(
  p_settings jsonb,
  p_base_radius real,
  p_started_at timestamptz,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_delay integer;
  v_step integer;
  v_factor real;
  v_min real;
  v_start timestamptz;
  v_steps integer;
  v_next_at timestamptz;
  v_next_radius real;
BEGIN
  IF p_started_at IS NULL THEN
    RETURN jsonb_build_object('nextAtMs', NULL, 'nextRadiusM', NULL);
  END IF;
  v_delay := GREATEST(0, COALESCE((p_settings->>'shrinkDelayS')::integer, 180));
  v_step := GREATEST(5, COALESCE((p_settings->>'shrinkStepS')::integer, 60));
  v_factor := LEAST(1.0, GREATEST(0.1, COALESCE((p_settings->>'shrinkFactorK')::real, 0.7)));
  v_min := GREATEST(10, COALESCE((p_settings->>'minRadiusM')::real, 50));
  v_start := p_started_at + make_interval(secs => v_delay);
  v_steps := floor(GREATEST(0, EXTRACT(EPOCH FROM (p_now - v_start))) / v_step)::integer;
  v_next_at := v_start + make_interval(secs => (v_steps + 1) * v_step);
  v_next_radius := GREATEST(v_min, p_base_radius * power(v_factor, (v_steps + 1))::real);
  IF v_next_radius <= v_min OR p_now >= v_next_at THEN
    RETURN jsonb_build_object('nextAtMs', NULL, 'nextRadiusM', v_next_radius);
  END IF;
  RETURN jsonb_build_object(
    'nextAtMs', (EXTRACT(EPOCH FROM v_next_at) * 1000)::bigint,
    'nextRadiusM', v_next_radius);
END;
$$;

-- ---------------------------------------------------------------------------
-- polygon_from_vertices: closed polygon from the app's {latitude,longitude}
-- array; NULL when the shape is degenerate or self-crossing (invalid).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION polygon_from_vertices(p_vertices jsonb)
RETURNS geometry
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_i integer;
  v_wkt text := '';
  v_geom geometry;
BEGIN
  IF jsonb_typeof(p_vertices) != 'array' OR jsonb_array_length(p_vertices) < 3 THEN
    RETURN NULL;
  END IF;
  FOR v_i IN 0 .. jsonb_array_length(p_vertices) - 1 LOOP
    v_wkt := v_wkt || format('%s %s, ',
      (p_vertices -> v_i ->> 'longitude')::double precision,
      (p_vertices -> v_i ->> 'latitude')::double precision);
  END LOOP;
  v_wkt := v_wkt || format('%s %s',
    (p_vertices -> 0 ->> 'longitude')::double precision,
    (p_vertices -> 0 ->> 'latitude')::double precision);
  BEGIN
    v_geom := ST_GeomFromText('POLYGON((' || v_wkt || '))', 4326);
    IF NOT ST_IsValid(v_geom) THEN RETURN NULL; END IF;
    RETURN v_geom;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- area_contains: strict containment for every supported zone type.
--   circle / shrinking: ST_DWithin against the current radius
--     (p_radius_override carries the computed shrink radius).
--   rectangle: bounding box over the two dragged corners (p_area.corners[0..1]).
--   polygon: ST_Contains of polygon_from_vertices.
--   none / city_wide / unknown types: boundless area (always inside).
-- Errors degrade to "not contained", so a broken drawing can never jail anyone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION area_contains(
  p_area jsonb,
  p_lat double precision,
  p_lng double precision,
  p_radius_override real DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_type text := p_area->>'type';
  v_point geometry := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
BEGIN
  IF v_type IS NULL OR v_type = 'none' OR v_type = 'city_wide' THEN RETURN true; END IF;

  IF v_type IN ('circle', 'shrinking') THEN
    DECLARE
      v_radius real := COALESCE(p_radius_override, (p_area->>'radiusM')::real, 0);
      v_center jsonb := p_area->'center';
    BEGIN
      IF v_center IS NULL OR jsonb_typeof(v_center) != 'object' THEN RETURN true; END IF;
      RETURN ST_DWithin(
        ST_SetSRID(ST_MakePoint(
          (v_center ->> 'longitude')::double precision,
          (v_center ->> 'latitude')::double precision), 4326)::geography,
        v_point::geography, v_radius);
    END;
  END IF;

  IF v_type = 'rectangle' THEN
    DECLARE
      v_corners jsonb := p_area->'corners';
      v_lat_a double precision;
      v_lat_b double precision;
      v_lng_a double precision;
      v_lng_b double precision;
    BEGIN
      IF jsonb_typeof(v_corners) != 'array' OR jsonb_array_length(v_corners) < 2 THEN RETURN false; END IF;
      v_lat_a := (v_corners -> 0 ->> 'latitude')::double precision;
      v_lat_b := (v_corners -> 1 ->> 'latitude')::double precision;
      v_lng_a := (v_corners -> 0 ->> 'longitude')::double precision;
      v_lng_b := (v_corners -> 1 ->> 'longitude')::double precision;
      RETURN p_lat BETWEEN LEAST(v_lat_a, v_lat_b) AND GREATEST(v_lat_a, v_lat_b)
         AND p_lng BETWEEN LEAST(v_lng_a, v_lng_b) AND GREATEST(v_lng_a, v_lng_b);
    END;
  END IF;

  IF v_type = 'polygon' THEN
    DECLARE
      v_geom geometry := polygon_from_vertices(p_area->'vertices');
    BEGIN
      IF v_geom IS NULL THEN RETURN false; END IF;
      RETURN ST_Contains(v_geom, v_point);
    END;
  END IF;

  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- area_boundary_geom: boundary line of a zone, for edge-distance geometry
-- (planar degree approximations, plenty accurate for a 50 m warning band).
-- NULL when the zone type has no drawable boundary.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION area_boundary_geom(p_area jsonb, p_radius_override real DEFAULT NULL)
RETURNS geometry
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_type text := p_area->>'type';
  v_center jsonb := p_area->'center';
  v_geom geometry;
  v_radius real;
  v_lat double precision;
  v_lng double precision;
  v_dlat double precision;
  v_dlng double precision;
BEGIN
  IF v_type IN ('circle', 'shrinking') THEN
    v_radius := COALESCE(p_radius_override, (p_area->>'radiusM')::real, 0);
    IF v_center IS NULL OR jsonb_typeof(v_center) != 'object' OR v_radius <= 0 THEN RETURN NULL; END IF;
    v_lat := (v_center ->> 'latitude')::double precision;
    v_lng := (v_center ->> 'longitude')::double precision;
    v_dlat := v_radius / 111320.0;
    v_dlng := v_radius / (111320.0 * GREATEST(0.01, cos(radians(v_lat))));
    v_geom := ST_GeomFromText(format(
      'POLYGON((%s %s,%s %s,%s %s,%s %s,%s %s))',
      v_lng - v_dlng, v_lat, v_lng, v_lat + v_dlat, v_lng + v_dlng, v_lat,
      v_lng, v_lat - v_dlat, v_lng - v_dlng, v_lat), 4326);
    RETURN ST_Boundary(v_geom);
  END IF;

  IF v_type = 'rectangle' THEN
    DECLARE
      v_corners jsonb := p_area->'corners';
      v_lat_a double precision; v_lat_b double precision;
      v_lng_a double precision; v_lng_b double precision;
      v_min_lat double precision; v_max_lat double precision;
      v_min_lng double precision; v_max_lng double precision;
    BEGIN
      IF jsonb_typeof(v_corners) != 'array' OR jsonb_array_length(v_corners) < 2 THEN RETURN NULL; END IF;
      v_lat_a := (v_corners -> 0 ->> 'latitude')::double precision;
      v_lat_b := (v_corners -> 1 ->> 'latitude')::double precision;
      v_lng_a := (v_corners -> 0 ->> 'longitude')::double precision;
      v_lng_b := (v_corners -> 1 ->> 'longitude')::double precision;
      v_min_lat := LEAST(v_lat_a, v_lat_b);
      v_max_lat := GREATEST(v_lat_a, v_lat_b);
      v_min_lng := LEAST(v_lng_a, v_lng_b);
      v_max_lng := GREATEST(v_lng_a, v_lng_b);
      RETURN ST_Boundary(ST_GeomFromText(format(
        'POLYGON((%s %s,%s %s,%s %s,%s %s,%s %s))',
        v_min_lng, v_min_lat, v_max_lng, v_min_lat, v_max_lng, v_max_lat,
        v_min_lng, v_max_lat, v_min_lng, v_min_lat), 4326));
    END;
  END IF;

  IF v_type = 'polygon' THEN
    DECLARE v_geom geometry := polygon_from_vertices(p_area->'vertices');
    BEGIN
      IF v_geom IS NULL THEN RETURN NULL; END IF;
      RETURN ST_Boundary(v_geom);
    END;
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- judge_bounds: per-player boundary judgement. The app calls this every few
-- seconds with its own fix; the server stays the final judge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION judge_bounds(
  p_game_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m real DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_game games%ROWTYPE;
  v_settings jsonb;
  v_area jsonb;
  v_type text;
  v_started_at timestamptz;
  v_radius real;
  v_center geography;
  v_point geography := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_me game_players%ROWTYPE;
  v_inside boolean;
  v_edge_m real;
  v_nogo boolean := false;
  v_zones jsonb;
  v_zone_i integer;
  v_state text;
  v_grace_s integer;
  v_warn_m real;
  v_penalty text;
  v_since timestamptz;
  v_dwell_s real := 0;
  v_beyond_ok boolean;
  v_must_penalize boolean;
  v_accuracy_paused boolean := false;
  v_next jsonb;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'game_not_found'); END IF;
  SELECT * INTO v_me FROM game_players
  WHERE game_id = p_game_id AND user_id = auth.uid();
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'reason', 'not_in_game'); END IF;

  v_settings := v_game.settings;
  v_area := v_settings->'playArea';
  v_type := v_area->>'type';

  IF v_type IS NULL OR v_type = 'none' OR v_type = 'city_wide' THEN
    UPDATE game_players SET out_of_bounds_since = NULL, boundary_state = 'inside'
    WHERE id = v_me.id AND (out_of_bounds_since IS NOT NULL OR boundary_state != 'inside');
    RETURN jsonb_build_object('success', true, 'state', 'inside', 'noBoundary', true);
  END IF;

  v_started_at := v_game.started_at;

  IF v_type IN ('circle', 'shrinking') THEN
    IF v_type = 'shrinking' THEN
      v_radius := shrink_radius_at(v_settings, COALESCE((v_area->>'radiusM')::real, 500), v_started_at, now());
    ELSE
      v_radius := COALESCE((v_area->>'radiusM')::real, 0);
    END IF;
    IF v_area->'center' IS NULL OR jsonb_typeof(v_area->'center') != 'object' THEN
      RETURN jsonb_build_object('success', true, 'state', 'inside', 'noBoundary', true);
    END IF;
    v_center := ST_SetSRID(ST_MakePoint(
      (v_area #>> '{center,longitude}')::double precision,
      (v_area #>> '{center,latitude}')::double precision), 4326)::geography;
    v_inside := ST_DWithin(v_center, v_point, v_radius);
    v_edge_m := v_radius - ST_Distance(v_center, v_point);
  ELSE
    v_inside := area_contains(v_area, p_lat, p_lng);
    IF v_inside THEN
      v_edge_m := ST_Distance(area_boundary_geom(v_area), ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326));
    ELSE
      v_edge_m := -ST_Distance(area_boundary_geom(v_area), ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326));
    END IF;
  END IF;

  -- No-go zones: falling inside any of them reads as outside the boundary.
  v_zones := v_settings->'noGoZones';
  IF jsonb_typeof(v_zones) = 'array' THEN
    FOR v_zone_i IN 0 .. jsonb_array_length(v_zones) - 1 LOOP
      IF area_contains(v_zones -> v_zone_i, p_lat, p_lng) THEN
        v_nogo := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  v_grace_s := GREATEST(0, COALESCE((v_settings->>'boundaryGraceS')::integer, 30));
  v_warn_m := COALESCE((v_settings->>'boundaryWarningM')::real, 50);
  v_penalty := COALESCE(v_settings->>'boundaryPenalty', 'reveal');

  IF p_accuracy_m IS NOT NULL AND p_accuracy_m > 40 THEN v_accuracy_paused := true; END IF;

  IF NOT v_nogo AND v_inside THEN
    IF v_edge_m IS NOT NULL AND v_edge_m <= v_warn_m THEN
      v_state := 'near_edge';
    ELSE
      v_state := 'inside';
    END IF;
    IF v_state = 'near_edge' AND v_me.boundary_state != 'near_edge' AND v_me.out_of_bounds_since IS NULL THEN
      INSERT INTO events (game_id, actor_id, event_type, payload)
      VALUES (p_game_id, auth.uid(), 'zone_warning',
        jsonb_build_object('edgeM', round(v_edge_m::numeric), 'playerId', auth.uid()));
    END IF;
    UPDATE game_players SET out_of_bounds_since = NULL, boundary_state = v_state
    WHERE id = v_me.id AND (out_of_bounds_since IS NOT NULL OR boundary_state <> v_state);

    IF v_type = 'shrinking' THEN
      v_next := shrink_next_step(v_settings, COALESCE((v_area->>'radiusM')::real, 500), v_started_at, now());
    END IF;
    RETURN jsonb_build_object(
      'success', true, 'state', v_state, 'noGo', false, 'inside', true,
      'edgeM', CASE WHEN v_edge_m IS NULL THEN NULL ELSE round(v_edge_m::numeric) END,
      'penalty', v_penalty, 'radiusM', v_radius, 'nextShrink', v_next);
  END IF;

  -- Outside the boundary (or inside a no-go zone): grace dwell runs.
  v_state := 'grace';
  v_since := v_me.out_of_bounds_since;
  IF v_since IS NULL THEN
    v_since := now();
    UPDATE game_players SET out_of_bounds_since = v_since
    WHERE id = v_me.id AND out_of_bounds_since IS NULL;
  END IF;
  v_dwell_s := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_since)));
  -- Hysteresis: penalise only when the fix says the player is genuinely past
  -- the edge — the signed distance is negative outside, so magnitude is the
  -- only honest test: 20 m beyond (or edge distance unknown, in which case
  -- the grace-window requirement alone decides).
  v_beyond_ok := v_edge_m IS NULL OR ABS(v_edge_m) >= 20;
  v_must_penalize := NOT v_accuracy_paused
    AND v_dwell_s >= GREATEST(v_grace_s, 10)
    AND v_beyond_ok
    AND v_me.boundary_state <> 'oob_penalized';

  IF v_must_penalize THEN
    v_state := 'oob_penalized';
    UPDATE game_players
      SET boundary_state = 'oob_penalized', oob_penalty_count = oob_penalty_count + 1
    WHERE id = v_me.id;
    IF v_penalty = 'time' THEN
      UPDATE games SET max_ends_at = max_ends_at - make_interval(secs => 60) WHERE id = p_game_id;
    ELSIF v_penalty = 'disqualify' THEN
      UPDATE game_players SET role = 'spectator' WHERE id = v_me.id;
    END IF;
    INSERT INTO events (game_id, actor_id, event_type, payload)
    VALUES (p_game_id, auth.uid(), 'zone_penalty', jsonb_build_object(
      'type', v_penalty,
      'playerId', auth.uid(),
      'seconds', 60,
      'outsideForS', round(v_dwell_s::numeric)));
  ELSE
    -- Stay 'oob_penalized' until the player re-enters: downgrading to grace
    -- here would re-fire the penalty on every subsequent call. (The inside
    -- branch is the only path that clears both the dwell and the state.)
    UPDATE game_players SET boundary_state = 'grace'
    WHERE id = v_me.id AND boundary_state NOT IN ('grace', 'oob_penalized');
    v_state := CASE WHEN v_me.boundary_state = 'oob_penalized' THEN 'oob_penalized' ELSE 'grace' END;
  END IF;

  IF v_type = 'shrinking' THEN
    v_next := shrink_next_step(v_settings, COALESCE((v_area->>'radiusM')::real, 500), v_started_at, now());
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'state', CASE WHEN v_accuracy_paused AND v_state = 'grace' THEN 'grace_paused' ELSE v_state END,
    'noGo', v_nogo,
    'inside', false,
    'edgeM', v_edge_m,
    'graceRemainingS', GREATEST(0, v_grace_s - round(v_dwell_s::numeric)),
    'dwellS', round(v_dwell_s::numeric),
    'accuracyPaused', v_accuracy_paused,
    'penaltyFired', v_must_penalize,
    'penalty', v_penalty,
    'radiusM', v_radius,
    'nextShrink', v_next);
END;
$$;

-- Saved area templates (per host; reusable across games).
CREATE TABLE IF NOT EXISTS areas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER areas_updated_at
  BEFORE UPDATE ON areas
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Hosts manage their own area templates" ON areas
  FOR ALL USING (auth.uid() = host_id) WITH CHECK (auth.uid() = host_id);

GRANT EXECUTE ON FUNCTION judge_bounds(uuid, double precision, double precision, real) TO authenticated;
