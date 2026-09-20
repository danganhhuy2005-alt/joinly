-- 1) Make the public view use invoker rights (respect RLS + column grants of caller)
ALTER VIEW public.event_rooms_public SET (security_invoker = true);

-- 2) Ensure anon/authenticated can read only the safe columns of event_rooms via the view
GRANT SELECT (id, event_id, name, position, has_access_code, created_at)
  ON public.event_rooms TO anon, authenticated;

-- 3) Add a permissive SELECT policy so RLS allows reading rooms through the view.
--    Column-level grants above ensure access_code stays hidden from anon/authenticated.
DROP POLICY IF EXISTS "Public can view rooms" ON public.event_rooms;
CREATE POLICY "Public can view rooms"
  ON public.event_rooms
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- 4) Revoke EXECUTE on the SECURITY DEFINER verification function from public roles.
--    It is only invoked from trusted server code (service role), which is unaffected.
REVOKE EXECUTE ON FUNCTION public.verify_room_access_code(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.verify_room_access_code(uuid, text) FROM anon, authenticated;
