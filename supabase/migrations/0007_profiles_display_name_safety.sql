-- =============================================================================
-- Migration 0007: Harden profile display_name on sign-up
-- =============================================================================
-- Migration 0002's on_auth_user_created trigger writes the Google full_name
-- into profiles.display_name, which is CHECK-constrained to 1..30 characters.
-- Google display names can exceed 30 characters (or contain only whitespace),
-- which would fail the insert and reject the sign-up outright. Clamp the name
-- to 30 chars and fall back to the email prefix when nothing usable remains.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_name text;
BEGIN
  v_name := COALESCE(NULLIF(left(NEW.raw_user_meta_data ->> 'full_name', 30), ''),
                     NULLIF(left(NEW.raw_user_meta_data ->> 'name', 30), ''),
                     split_part(NEW.email, '@', 1));

  INSERT INTO profiles (id, display_name, avatar_url)
  VALUES (NEW.id, v_name, NEW.raw_user_meta_data ->> 'avatar_url');
  RETURN NEW;
END;
$$;
