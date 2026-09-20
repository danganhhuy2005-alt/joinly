-- Prevent anon/authenticated from reading the access_code column directly.
-- The has_access_code generated boolean remains readable so clients can tell
-- whether a code is required. Verification happens server-side via the
-- service-role client in verifyRoomAccessCode.
REVOKE SELECT (access_code) ON public.event_rooms FROM anon;
REVOKE SELECT (access_code) ON public.event_rooms FROM authenticated;

-- Re-grant SELECT on every other column so existing "SELECT *" style reads
-- (excluding access_code) keep working under the existing RLS policies.
GRANT SELECT (id, event_id, name, position, created_at, has_access_code)
  ON public.event_rooms TO anon;
GRANT SELECT (id, event_id, name, position, created_at, has_access_code)
  ON public.event_rooms TO authenticated;
