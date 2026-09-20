ALTER TABLE public.events ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS events_organizer_is_demo_idx ON public.events (organizer_id, is_demo);