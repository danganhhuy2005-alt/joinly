
ALTER TABLE public.events ADD COLUMN expected_attendees INTEGER;

CREATE TABLE public.event_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX event_rooms_event_id_idx ON public.event_rooms(event_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_rooms TO authenticated;
GRANT SELECT ON public.event_rooms TO anon;
GRANT ALL ON public.event_rooms TO service_role;

ALTER TABLE public.event_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view rooms"
  ON public.event_rooms FOR SELECT TO anon, authenticated
  USING (true);

CREATE POLICY "Organizers manage rooms of their events"
  ON public.event_rooms FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.organizer_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.organizer_id = auth.uid()));
