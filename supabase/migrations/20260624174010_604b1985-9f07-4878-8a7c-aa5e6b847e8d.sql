
ALTER TABLE public.participants
  ADD COLUMN IF NOT EXISTS confirmation_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_confirmation_token
  ON public.participants(confirmation_token);

CREATE OR REPLACE FUNCTION public.get_participant_confirmation(_token uuid)
RETURNS TABLE (
  participant_id uuid,
  full_name text,
  email text,
  event_id uuid,
  event_name text,
  event_description text,
  event_location text,
  event_starts_at timestamptz,
  room_id uuid,
  room_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.full_name,
    p.email,
    e.id,
    e.name,
    e.description,
    e.location,
    e.starts_at,
    r.id,
    r.name
  FROM public.participants p
  JOIN public.events e ON e.id = p.event_id
  JOIN public.event_rooms r ON r.id = p.room_id
  WHERE p.confirmation_token = _token
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_participant_confirmation(uuid) TO anon, authenticated;
