-- 0014: cast CASE-computed statuses to their enum types.
--
-- In PL/pgSQL, a bare `CASE WHEN ... THEN 'a' ELSE 'b' END` resolves to type
-- text (fallback for untyped literals), and assigning text to an enum column
-- fails at runtime with 42804:
--   column "status" is of type player_status but expression is of type text
-- Plain literal assignments (`SET status = 'paused'`) are fine because untyped
-- literals coerce directly to the column type — only CASE needs the cast.
--
-- Affected (from 0009):
--   start_game        — activating players on start (blocks Start game)
--   advance_game_state — countdown -> head_start/active (would block the
--                        first phase transition after start)
--
-- Bodies are byte-for-byte the 0009 versions except for the two :: casts.

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
  UPDATE game_players SET status = (CASE WHEN role = 'spectator' THEN 'waiting'::player_status ELSE 'active'::player_status END)::player_status WHERE game_id = p_game_id;
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
    UPDATE games SET status = (CASE WHEN v_head_start > 0 THEN 'head_start'::game_status ELSE 'active'::game_status END)::game_status,
      head_start_ends_at = CASE WHEN v_head_start > 0 THEN now() + make_interval(secs => v_head_start) ELSE NULL END,
      started_at = CASE WHEN v_head_start = 0 THEN now() ELSE started_at END WHERE id = p_game_id RETURNING * INTO v_game;
  ELSIF v_game.status = 'head_start' AND v_game.head_start_ends_at <= now() THEN
    UPDATE games SET status = 'active', started_at = COALESCE(started_at, now()) WHERE id = p_game_id RETURNING * INTO v_game;
  ELSIF v_game.status = 'active' AND v_game.max_ends_at <= now() THEN
    UPDATE games SET status = 'ended', ended_at = now(), winner = 'runners' WHERE id = p_game_id RETURNING * INTO v_game;
  END IF;
  RETURN v_game;
END; $$;
