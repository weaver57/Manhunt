-- =============================================================================
-- Migration 0011: Phase 3 — location engine support
-- =============================================================================

-- Self-reported mock GPS detection. The client writes this exactly once when
-- expo-location reports a mocked fix; hosts see the flag in the lobby player
-- list and decide the penalty (trust mode: friends play, cheats get called out).
ALTER TABLE game_players
  ADD COLUMN IF NOT EXISTS mock_detected_at timestamptz;

-- Marking a fake-GPS flag server-side. SECURITY DEFINER because the row policy
-- for self-updates would otherwise have to open up column-level edits.
CREATE OR REPLACE FUNCTION report_mock_location(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE game_players
  SET mock_detected_at = now()
  WHERE game_id = p_game_id
    AND user_id = auth.uid()
    AND mock_detected_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'You are not in this game'; END IF;
END; $$;

GRANT EXECUTE ON FUNCTION report_mock_location(uuid) TO authenticated;
