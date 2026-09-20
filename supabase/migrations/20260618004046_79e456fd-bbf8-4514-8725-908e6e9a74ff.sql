
CREATE TABLE public.participants (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.event_rooms(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  student_id text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.participants TO authenticated;
GRANT INSERT ON public.participants TO anon;
GRANT ALL ON public.participants TO service_role;

ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can register as participant"
ON public.participants FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.event_rooms r
    WHERE r.id = participants.room_id AND r.event_id = participants.event_id
  )
);

CREATE POLICY "Organizers manage participants of their events"
ON public.participants FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = participants.event_id AND e.organizer_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = participants.event_id AND e.organizer_id = auth.uid()));

CREATE INDEX idx_participants_event ON public.participants(event_id);
CREATE INDEX idx_participants_room ON public.participants(room_id);
