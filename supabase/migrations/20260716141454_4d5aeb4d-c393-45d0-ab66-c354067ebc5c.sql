-- Add optional access code to event rooms.
ALTER TABLE public.event_rooms
  ADD COLUMN IF NOT EXISTS access_code text;

ALTER TABLE public.event_rooms
  DROP CONSTRAINT IF EXISTS event_rooms_access_code_format;
ALTER TABLE public.event_rooms
  ADD CONSTRAINT event_rooms_access_code_format
  CHECK (access_code IS NULL OR access_code ~ '^[A-Z0-9]{4,6}$');

-- Boolean indicator that is safe to expose to clients (does not reveal the code).
ALTER TABLE public.event_rooms
  ADD COLUMN IF NOT EXISTS has_access_code boolean
  GENERATED ALWAYS AS (access_code IS NOT NULL) STORED;

-- Hide the plaintext code from anon/authenticated Data API reads.
-- The organizer reads it via a server function (supabaseAdmin) after ownership check.
REVOKE SELECT (access_code) ON public.event_rooms FROM anon;
REVOKE SELECT (access_code) ON public.event_rooms FROM authenticated;