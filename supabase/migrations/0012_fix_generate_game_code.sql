-- 0012: fix generate_game_code — PL/pgSQL variable `code` collided with the
-- games.code column, making the WHERE clause ambiguous at runtime (42702:
-- "column reference \"code\" is ambiguous"). create_game calls this function,
-- so game creation failed for every player since 0003.
-- Rename the variables to the v_ convention and qualify the column ref.

CREATE OR REPLACE FUNCTION generate_game_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O, 1/I ambiguity
  v_code text;
  v_exists boolean;
BEGIN
  LOOP
    v_code := '';
    FOR i IN 1..6 LOOP
      v_code := v_code || substr(chars, ceil(random() * length(chars))::int, 1);
    END LOOP;
    SELECT EXISTS (
      SELECT 1 FROM games WHERE games.code = v_code AND games.status != 'ended'
    ) INTO v_exists;
    EXIT WHEN NOT v_exists;
  END LOOP;
  RETURN v_code;
END;
$$;
