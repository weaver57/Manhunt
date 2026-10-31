-- Ensure Google sign-up always creates a profile with a valid display name.
-- profiles.display_name is NOT NULL and constrained to 1..30 characters.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name text;
BEGIN
  v_name := COALESCE(
    NULLIF(left(btrim(NEW.raw_user_meta_data ->> 'full_name'), 20), ''),
    NULLIF(left(btrim(NEW.raw_user_meta_data ->> 'name'), 20), ''),
    NULLIF(left(split_part(COALESCE(NEW.email, ''), '@', 1), 20), ''),
    'Player'
  );

  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (NEW.id, v_name, NEW.raw_user_meta_data ->> 'avatar_url');

  RETURN NEW;
END;
$$;
