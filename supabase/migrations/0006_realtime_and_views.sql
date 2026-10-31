-- =============================================================================
-- Migration 0006: Realtime publication & leaderboard view
-- =============================================================================

-- Enable Supabase Realtime for live updates
-- These tables need broadcast so all players receive changes immediately.

ALTER PUBLICATION supabase_realtime ADD TABLE games;
ALTER PUBLICATION supabase_realtime ADD TABLE game_players;
ALTER PUBLICATION supabase_realtime ADD TABLE player_locations;
ALTER PUBLICATION supabase_realtime ADD TABLE tags;

-- ---------------------------------------------------------------------------
-- View: game_leaderboard
-- Used on the post-game stats screen
-- ---------------------------------------------------------------------------

CREATE VIEW game_leaderboard AS
SELECT
  gp.game_id,
  gp.user_id,
  p.display_name,
  p.avatar_url,
  gp.role,
  gp.status,
  gp.distance_m,
  gp.tags_made,
  -- Survival seconds: from game start to when they were tagged (or game end)
  CASE
    WHEN gp.role = 'runner' AND gp.status = 'tagged' THEN
      EXTRACT(EPOCH FROM (gp.tagged_at - g.started_at))::integer
    WHEN gp.role = 'runner' AND gp.status = 'active' THEN
      EXTRACT(EPOCH FROM (g.ended_at - g.started_at))::integer
    ELSE NULL
  END AS survival_seconds,
  -- Score formula
  CASE
    WHEN gp.role = 'runner' AND gp.status != 'tagged' THEN
      EXTRACT(EPOCH FROM (COALESCE(g.ended_at, now()) - g.started_at))::integer
    WHEN gp.role = 'runner' AND gp.status = 'tagged' THEN
      EXTRACT(EPOCH FROM (gp.tagged_at - g.started_at))::integer
    WHEN gp.role = 'chaser' THEN
      (gp.tags_made * 100) + COALESCE(
        (SELECT SUM(
          GREATEST(0, EXTRACT(EPOCH FROM (g.ended_at - t.tagged_at))::integer)
        )
        FROM tags t
        WHERE t.game_id = gp.game_id AND t.chaser_id = gp.user_id),
        0
      )
    ELSE 0
  END AS score
FROM game_players gp
JOIN profiles p ON p.id = gp.user_id
JOIN games g ON g.id = gp.game_id;

-- RLS on the view inherits from the underlying tables
