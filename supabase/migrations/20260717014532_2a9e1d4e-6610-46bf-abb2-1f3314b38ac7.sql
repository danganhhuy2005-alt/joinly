-- Remove overly permissive public SELECT policy that exposed access_code
DROP POLICY IF EXISTS "Anyone can view rooms" ON public.event_rooms;

-- Revoke direct table SELECT from anon; authenticated organizers still read via RLS policy below
REVOKE SELECT ON public.event_rooms FROM anon;
REVOKE SELECT ON public.event_rooms FROM authenticated;

-- Re-grant SELECT to authenticated so the organizer RLS policy has row-level access.
-- RLS "Organizers manage rooms of their events" (ALL) already restricts rows to owners only.
GRANT SELECT ON public.event_rooms TO authenticated;

-- Public view exposes only non-sensitive columns; access_code is NOT included.
-- security_invoker=false so the view runs as its owner (bypasses table RLS) and can serve anon lookups.
CREATE OR REPLACE VIEW public.event_rooms_public
WITH (security_invoker = false) AS
SELECT id, event_id, name, position, has_access_code, created_at
FROM public.event_rooms;

GRANT SELECT ON public.event_rooms_public TO anon, authenticated;

-- Server-side RPC to verify a room access code without ever revealing it to the client.
CREATE OR REPLACE FUNCTION public.verify_room_access_code(_room_id uuid, _code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored text;
BEGIN
  SELECT access_code INTO stored FROM public.event_rooms WHERE id = _room_id;
  IF stored IS NULL THEN
    RETURN TRUE; -- open room, no code required
  END IF;
  RETURN upper(stored) = upper(coalesce(_code, ''));
END;
$$;

REVOKE ALL ON FUNCTION public.verify_room_access_code(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_room_access_code(uuid, text) TO anon, authenticated;