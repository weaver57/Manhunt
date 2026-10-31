-- =============================================================================
-- Migration 0003: Games and game players
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: generate a unique 6-character game code
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION generate_game_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O, 1/I ambiguity
  code   text;
  exists boolean;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(chars, ceil(random() * length(chars))::int, 1);
    END LOOP;
    SELECT EXISTS (SELECT 1 FROM games WHERE games.code = code AND status != 'ended')
    INTO exists;
    EXIT WHEN NOT exists;
  END LOOP;
  RETURN code;
END;
$$;

-- ---------------------------------------------------------------------------
-- Games table
-- ---------------------------------------------------------------------------

CREATE TABLE games (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  host_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  code        text NOT NULL CHECK (char_length(code) = 6),
  status      game_status NOT NULL DEFAULT 'lobby',
  mode        game_mode NOT NULL DEFAULT 'classic',
  -- JSON: GameSettings (see src/types/database.ts)
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at  timestamptz,
  ended_at    timestamptz,
  winner      text CHECK (winner IN ('runners', 'chasers'))
);

CREATE TRIGGER games_updated_at
  BEFORE UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Index for code lookups (joining by code from the app)
CREATE UNIQUE INDEX games_code_active_idx
  ON games (code)
  WHERE status != 'ended';

-- RLS
ALTER TABLE games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Games are viewable by authenticated users"
  ON games FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Hosts can create games"
  ON games FOR INSERT
  WITH CHECK (auth.uid() = host_id);

CREATE POLICY "Hosts can update their own games"
  ON games FOR UPDATE
  USING (auth.uid() = host_id);

-- ---------------------------------------------------------------------------
-- Game players table
-- ---------------------------------------------------------------------------

CREATE TABLE game_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role        player_role NOT NULL DEFAULT 'runner',
  status      player_status NOT NULL DEFAULT 'waiting',
  joined_at   timestamptz NOT NULL DEFAULT now(),
  tagged_at   timestamptz,
  distance_m  integer NOT NULL DEFAULT 0,
  tags_made   integer NOT NULL DEFAULT 0,

  UNIQUE (game_id, user_id)
);

CREATE INDEX game_players_game_id_idx ON game_players (game_id);
CREATE INDEX game_players_user_id_idx ON game_players (user_id);

-- RLS
ALTER TABLE game_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Game players viewable by authenticated users"
  ON game_players FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users can join games"
  ON game_players FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Players can update their own row"
  ON game_players FOR UPDATE
  USING (auth.uid() = user_id);

-- Hosts can update any player row in their game (role reassignment, etc.)
CREATE POLICY "Hosts can update any player in their game"
  ON game_players FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM games
      WHERE games.id = game_players.game_id
        AND games.host_id = auth.uid()
    )
  );
