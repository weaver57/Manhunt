-- 0013: split the shared lifecycle trigger function.
--
-- log_game_event() was attached to BOTH games and game_players and branched
-- on TG_TABLE_NAME. PL/pgSQL caches compiled plans for statements and
-- condition expressions across invocations of the same function, so a plan
-- compiled for one table's record shape is reused for the other table's row,
-- where the referenced field doesn't exist:
--   42703: record "new" has no field "host_id" / "role"
-- (assignments/results like "Assign chaser" and "Set ready" then fail).
--
-- One function per table removes the shape collision entirely; behaviour and
-- event types are unchanged from 0009.

DROP TRIGGER IF EXISTS games_log_lifecycle ON games;
DROP TRIGGER IF EXISTS game_players_log_lifecycle ON game_players;
DROP FUNCTION IF EXISTS log_game_event();

CREATE OR REPLACE FUNCTION log_game_event_games()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO events (game_id, actor_id, event_type)
      VALUES (NEW.id, NEW.host_id, 'game_created');
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO events (game_id, actor_id, event_type)
      VALUES (NEW.id, NEW.host_id, CASE NEW.status
        WHEN 'countdown' THEN 'game_started'
        WHEN 'paused'    THEN 'game_paused'
        WHEN 'active'    THEN 'game_resumed'
        WHEN 'ended'     THEN 'game_ended'
        ELSE 'game_started'
      END);
  ELSIF NEW.host_id IS DISTINCT FROM OLD.host_id THEN
    INSERT INTO events (game_id, actor_id, event_type, payload)
      VALUES (NEW.id, OLD.host_id, 'host_transferred', jsonb_build_object('newHostId', NEW.host_id));
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE OR REPLACE FUNCTION log_game_event_players()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO events (game_id, actor_id, event_type, payload)
      VALUES (NEW.game_id, NEW.user_id, 'player_joined', jsonb_build_object('role', NEW.role));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO events (game_id, actor_id, event_type)
      VALUES (OLD.game_id, OLD.user_id, 'player_left');
  ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
    INSERT INTO events (game_id, actor_id, event_type, payload)
      VALUES (NEW.game_id, NEW.user_id, 'role_changed', jsonb_build_object('role', NEW.role));
  ELSIF NEW.is_ready IS DISTINCT FROM OLD.is_ready THEN
    INSERT INTO events (game_id, actor_id, event_type, payload)
      VALUES (NEW.game_id, NEW.user_id, 'ready_changed', jsonb_build_object('ready', NEW.is_ready));
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

CREATE TRIGGER games_log_lifecycle
  AFTER INSERT OR UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION log_game_event_games();

CREATE TRIGGER game_players_log_lifecycle
  AFTER INSERT OR UPDATE OR DELETE ON game_players
  FOR EACH ROW EXECUTE FUNCTION log_game_event_players();
