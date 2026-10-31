-- =============================================================================
-- Migration 0008: Profile face (Phase 1 spec)
-- =============================================================================
-- Phase 1 asks for:
--   * optional nickname on the profile
--   * "favorite color" used for the player's map marker
--   * display name missing/too long -> email prefix, trimmed to 20 chars
--   * RLS: a user can edit ONLY their own profile
-- 0002 already created display_name (<=30 chars) and the SELECT/UPDATE policies.

ALTER TABLE profiles ADD COLUMN nickname text;
ALTER TABLE profiles ADD CONSTRAINT nickname_len
  CHECK (nickname IS NULL OR char_length(nickname) BETWEEN 1 AND 30);

-- Favourite marker colour: 6- or 8-digit hex colour, applied by the app/DB default.
ALTER TABLE profiles ADD COLUMN marker_color text NOT NULL DEFAULT '#3D94F6'
  CHECK (marker_color ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$');

-- Clamp the sign-up display name to 20 characters per the phase guide
-- (0007 clamps to 30 to satisfy the CHECK; this tightens the product value).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_name text;
BEGIN
  v_name := COALESCE(NULLIF(left(NEW.raw_user_meta_data ->> 'full_name', 20), ''),
                     NULLIF(left(NEW.raw_user_meta_data ->> 'name', 20), ''),
                     left(split_part(NEW.email, '@', 1), 20));
  -- Ensure we never violate the display_name length constraint (1-30)
  IF v_name IS NULL OR char_length(v_name) = 0 THEN
    v_name := left(NEW.email, 20);
  END IF;
  IF char_length(v_name) > 30 THEN
    v_name := left(v_name, 30);
  END IF;

  INSERT INTO profiles (id, display_name, avatar_url)
  VALUES (NEW.id, v_name, NEW.raw_user_meta_data ->> 'avatar_url');
  RETURN NEW;
END;
$$;

-- Tighten the UPDATE policy: reads check auth.uid() = id AND the written row
-- must also belong to the caller (no hijacking another user's row).
DROP POLICY "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
