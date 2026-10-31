-- =============================================================================
-- Migration 0004: Player locations (time-series GPS data)
-- =============================================================================

CREATE TABLE player_locations (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id      uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- PostGIS geometry for efficient distance queries
  geom         geometry(Point, 4326) NOT NULL,
  latitude     double precision NOT NULL,
  longitude    double precision NOT NULL,
  accuracy_m   real NOT NULL,
  speed_ms     real,          -- metres per second; null if unavailable
  heading      real,          -- degrees, null if stationary
  recorded_at  timestamptz NOT NULL,
  is_mocked    boolean NOT NULL DEFAULT false
);

-- Spatial index for nearby-player queries
CREATE INDEX player_locations_geom_idx
  ON player_locations USING GIST (geom);

-- Time-range query index (e.g., last 30 seconds for tag validation)
CREATE INDEX player_locations_game_user_time_idx
  ON player_locations (game_id, user_id, recorded_at DESC);

-- Auto-populate the geom column from lat/lng
CREATE OR REPLACE FUNCTION set_location_geom()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.geom = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  RETURN NEW;
END;
$$;

CREATE TRIGGER player_locations_set_geom
  BEFORE INSERT ON player_locations
  FOR EACH ROW EXECUTE FUNCTION set_location_geom();

-- RLS
ALTER TABLE player_locations ENABLE ROW LEVEL SECURITY;

-- Players can only read locations of players in the same active game
CREATE POLICY "Locations readable by players in the same game"
  ON player_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM game_players gp
      WHERE gp.game_id = player_locations.game_id
        AND gp.user_id = auth.uid()
        AND gp.status IN ('active', 'tagged', 'sos')    -- spectators can watch
    )
  );

-- Players can only insert their own locations
CREATE POLICY "Players can insert their own locations"
  ON player_locations FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND NOT is_mocked  -- mocked positions are rejected at DB level too
  );

-- No updates or deletes — locations are immutable
