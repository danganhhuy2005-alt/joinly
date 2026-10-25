-- JOINLY: Shared login for organizers and participants.
-- Safe to store in git. Apply only after reviewing existing Supabase migration history.
-- No existing table, participant record, ticket token, or role is modified.
BEGIN;

-- Lookup by verified email without opening broad SELECT access on participants.
CREATE INDEX IF NOT EXISTS idx_participants_normalized_email_for_account
  ON public.participants ((lower(btrim(email))));

CREATE OR REPLACE FUNCTION public.get_my_participations()
RETURNS TABLE (
  participant_id uuid,
  event_id uuid,
  event_name text,
  event_location text,
  event_starts_at timestamptz,
  room_name text,
  attendee_name text,
  checked_in boolean,
  checked_out_at timestamptz,
  confirmation_token uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_email text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- Never accept an email from the browser. Only verified owner of the
  -- authenticated Supabase identity can read their ticket history.
  SELECT lower(btrim(u.email)) INTO v_email
  FROM auth.users AS u
  WHERE u.id = auth.uid()
    AND u.email_confirmed_at IS NOT NULL
    AND u.email IS NOT NULL;

  IF v_email IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.event_id,
    e.name,
    e.location,
    e.starts_at,
    r.name,
    p.full_name,
    p.checked_in,
    p.checked_out_at,
    p.confirmation_token
  FROM public.participants AS p
  JOIN public.events AS e ON e.id = p.event_id
  JOIN public.event_rooms AS r ON r.id = p.room_id
  WHERE lower(btrim(p.email)) = v_email
    AND e.lifecycle_status = 'active'
  ORDER BY e.starts_at DESC NULLS LAST, p.created_at DESC
  LIMIT 200;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_participations()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_participations()
  TO authenticated, service_role;

COMMIT;
