-- =============================================================================
-- Migration 0009: Phase 2 lobby lifecycle
-- =============================================================================

ALTER TYPE game_status ADD VALUE IF NOT EXISTS 'countdown' BEFORE 'starting';
ALTER TYPE game_status ADD VALUE IF NOT EXISTS 'head_start' BEFORE 'active';

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Manhunt game',
  ADD COLUMN IF NOT EXISTS countdown_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS head_start_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS paused_remaining_seconds integer;

ALTER TABLE game_players
  ADD COLUMN IF NOT EXISTS is_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE games
  ADD CONSTRAINT games_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 40);

CREATE INDEX IF NOT EXISTS game_players_presence_idx
  ON game_players (game_id, last_seen_at);

-- Immutable, client-readable audit trail for the lobby and game lifecycle.
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  game_id uuid NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('game_created', 'player_joined', 'player_left', 'role_changed', 'ready_changed', 'game_started', 'game_paused', 'game_resumed', 'game_ended', 'host_transferred')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS events_game_created_idx ON events (game_id, created_at DESC);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Game events are visible to game players" ON events FOR SELECT USING (
  EXISTS (SELECT 1 FROM game_players WHERE game_players.game_id = events.game_id AND game_players.user_id = auth.uid())
);
ALTER PUBLICATION supabase_realtime ADD TABLE events;

CREATE OR REPLACE FUNCTION log_game_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'games' AND TG_OP = 'INSERT' THEN
    INSERT INTO events (game_id, actor_id, event_type) VALUES (NEW.id, NEW.host_id, 'game_created');
  ELSIF TG_TABLE_NAME = 'game_players' AND TG_OP = 'INSERT' THEN
    INSERT INTO events (game_id, actor_id, event_type, payload) VALUES (NEW.game_id, NEW.user_id, 'player_joined', jsonb_build_object('role', NEW.role));
  ELSIF TG_TABLE_NAME = 'game_players' AND TG_OP = 'DELETE' THEN
    INSERT INTO events (game_id, actor_id, event_type) VALUES (OLD.game_id, OLD.user_id, 'player_left');
  ELSIF TG_TABLE_NAME = 'game_players' AND TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO events (game_id, actor_id, event_type, payload) VALUES (NEW.game_id, NEW.user_id, 'role_changed', jsonb_build_object('role', NEW.role));
  ELSIF TG_TABLE_NAME = 'game_players' AND TG_OP = 'UPDATE' AND NEW.is_ready IS DISTINCT FROM OLD.is_ready THEN
    INSERT INTO events (game_id, actor_id, event_type, payload) VALUES (NEW.game_id, NEW.user_id, 'ready_changed', jsonb_build_object('ready', NEW.is_ready));
  ELSIF TG_TABLE_NAME = 'games' AND TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO events (game_id, actor_id, event_type) VALUES (NEW.id, NEW.host_id, CASE NEW.status WHEN 'countdown' THEN 'game_started' WHEN 'paused' THEN 'game_paused' WHEN 'active' THEN 'game_resumed' WHEN 'ended' THEN 'game_ended' ELSE 'game_started' END);
  ELSIF TG_TABLE_NAME = 'games' AND TG_OP = 'UPDATE' AND NEW.host_id IS DISTINCT FROM OLD.host_id THEN
    INSERT INTO events (game_id, actor_id, event_type, payload) VALUES (NEW.id, OLD.host_id, 'host_transferred', jsonb_build_object('newHostId', NEW.host_id));
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
CREATE TRIGGER games_log_lifecycle AFTER INSERT OR UPDATE ON games FOR EACH ROW EXECUTE FUNCTION log_game_event();
CREATE TRIGGER game_players_log_lifecycle AFTER INSERT OR UPDATE OR DELETE ON game_players FOR EACH ROW EXECUTE FUNCTION log_game_event();

-- Keep ordinary members from changing their role, readiness, or play state.
DROP POLICY IF EXISTS "Players can update their own row" ON game_players;
CREATE POLICY "Players can update their own presence"
  ON game_players FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- The public client calls these SECURITY DEFINER functions instead of writing
-- lifecycle fields directly. Each function verifies the caller and locks the
-- game row, so concurrent host actions cannot produce an invalid state.
CREATE OR REPLACE FUNCTION create_game(
  p_name text,
  p_mode game_mode DEFAULT 'classic',
  p_settings jsonb DEFAULT '{}'::jsonb
) RETURNS games
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_game games;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in'; END IF;
  INSERT INTO games (host_id, code, name, mode, settings)
  VALUES (auth.uid(), generate_game_code(), btrim(p_name), p_mode, p_settings)
  RETURNING * INTO v_game;
  INSERT INTO game_players (game_id, user_id, role, is_ready)
  VALUES (v_game.id, auth.uid(), 'runner', true);
  RETURN v_game;
END; $$;

CREATE OR REPLACE FUNCTION join_game(p_code text)
RETURNS games
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_game games;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'You must be signed in'; END IF;
  SELECT * INTO v_game FROM games WHERE code = upper(trim(p_code)) AND status = 'lobby' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That code is invalid or this lobby has already started'; END IF;
  INSERT INTO game_players (game_id, user_id, role)
  VALUES (v_game.id, auth.uid(), 'runner')
  ON CONFLICT (game_id, user_id) DO UPDATE SET last_seen_at = now();
  RETURN v_game;
END; $$;

CREATE OR REPLACE FUNCTION set_player_ready(p_game_id uuid, p_ready boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE game_players SET is_ready = p_ready, last_seen_at = now()
  WHERE game_id = p_game_id AND user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND status = 'lobby');
  IF NOT FOUND THEN RAISE EXCEPTION 'You cannot change readiness for this game'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION set_player_role(p_game_id uuid, p_user_id uuid, p_role player_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND host_id = auth.uid() AND status = 'lobby') THEN
    RAISE EXCEPTION 'Only the host can assign roles before the game starts';
  END IF;
  UPDATE game_players SET role = p_role WHERE game_id = p_game_id AND user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Player was not found in this game'; END IF;
END; $$;

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
    max_ends_at = now() + make_interval(secs => COALESCE((settings->>'durationMinutes')::integer, 30) * 60 + v_countdown + v_head_start)
    WHERE id = p_game_id RETURNING * INTO v_game;
  UPDATE game_players SET status = CASE WHEN role = 'spectator' THEN 'waiting' ELSE 'active' END WHERE game_id = p_game_id;
  RETURN v_game;
END; $$;

CREATE OR REPLACE FUNCTION advance_game_state(p_game_id uuid)
RETURNS games
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_game games; v_head_start integer;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game was not found'; END IF;
  IF v_game.status = 'countdown' AND v_game.countdown_ends_at <= now() THEN
    v_head_start := GREATEST(0, COALESCE((v_game.settings->>'headStartSeconds')::integer, 30));
    UPDATE games SET status = CASE WHEN v_head_start > 0 THEN 'head_start' ELSE 'active' END,
      head_start_ends_at = CASE WHEN v_head_start > 0 THEN now() + make_interval(secs => v_head_start) ELSE NULL END,
      started_at = CASE WHEN v_head_start = 0 THEN now() ELSE started_at END WHERE id = p_game_id RETURNING * INTO v_game;
  ELSIF v_game.status = 'head_start' AND v_game.head_start_ends_at <= now() THEN
    UPDATE games SET status = 'active', started_at = COALESCE(started_at, now()) WHERE id = p_game_id RETURNING * INTO v_game;
  ELSIF v_game.status = 'active' AND v_game.max_ends_at <= now() THEN
    UPDATE games SET status = 'ended', ended_at = now(), winner = 'runners' WHERE id = p_game_id RETURNING * INTO v_game;
  END IF;
  RETURN v_game;
END; $$;

CREATE OR REPLACE FUNCTION manage_game(p_game_id uuid, p_action text, p_target_user_id uuid DEFAULT NULL)
RETURNS games
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_game games;
BEGIN
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND OR v_game.host_id <> auth.uid() THEN RAISE EXCEPTION 'Only the host can manage this game'; END IF;
  CASE p_action
    WHEN 'pause' THEN UPDATE games SET status = 'paused', paused_at = now() WHERE id = p_game_id RETURNING * INTO v_game;
    WHEN 'resume' THEN UPDATE games SET status = 'active', paused_at = NULL WHERE id = p_game_id RETURNING * INTO v_game;
    WHEN 'end' THEN UPDATE games SET status = 'ended', ended_at = now() WHERE id = p_game_id RETURNING * INTO v_game;
    WHEN 'transfer_host' THEN
      IF p_target_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM game_players WHERE game_id = p_game_id AND user_id = p_target_user_id) THEN RAISE EXCEPTION 'Choose a player in this game'; END IF;
      UPDATE games SET host_id = p_target_user_id WHERE id = p_game_id RETURNING * INTO v_game;
    WHEN 'kick' THEN
      IF p_target_user_id IS NULL OR p_target_user_id = auth.uid() THEN RAISE EXCEPTION 'Choose another player to remove'; END IF;
      DELETE FROM game_players WHERE game_id = p_game_id AND user_id = p_target_user_id;
    ELSE RAISE EXCEPTION 'Unsupported game action';
  END CASE;
  RETURN v_game;
END; $$;

CREATE OR REPLACE FUNCTION heartbeat_game(p_game_id uuid)
RETURNS games
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_game games;
BEGIN
  UPDATE game_players SET last_seen_at = now() WHERE game_id = p_game_id AND user_id = auth.uid();
  SELECT * INTO v_game FROM games WHERE id = p_game_id FOR UPDATE;
  IF FOUND AND v_game.host_id <> auth.uid() AND EXISTS (
    SELECT 1 FROM game_players WHERE game_id = p_game_id AND user_id = v_game.host_id AND last_seen_at < now() - interval '60 seconds'
  ) THEN
    UPDATE games SET host_id = auth.uid() WHERE id = p_game_id AND status = 'lobby' RETURNING * INTO v_game;
  END IF;
  RETURN v_game;
END; $$;

GRANT EXECUTE ON FUNCTION create_game(text, game_mode, jsonb), join_game(text), set_player_ready(uuid, boolean),
  set_player_role(uuid, uuid, player_role), start_game(uuid, boolean), advance_game_state(uuid),
  manage_game(uuid, text, uuid), heartbeat_game(uuid) TO authenticated;
