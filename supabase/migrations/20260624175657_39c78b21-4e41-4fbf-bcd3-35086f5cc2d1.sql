
DROP POLICY IF EXISTS "Organizers manage participants of their events" ON public.participants;
DROP POLICY IF EXISTS "Organizers can view their event participants" ON public.participants;
DROP POLICY IF EXISTS "Organizers can update their event participants" ON public.participants;
DROP POLICY IF EXISTS "Organizers can delete their event participants" ON public.participants;
DROP POLICY IF EXISTS "Restrict participant reads to event organizer" ON public.participants;

CREATE POLICY "Organizers can view their event participants"
ON public.participants AS PERMISSIVE
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = participants.event_id AND e.organizer_id = auth.uid()));

CREATE POLICY "Organizers can update their event participants"
ON public.participants AS PERMISSIVE
FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = participants.event_id AND e.organizer_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.events e WHERE e.id = participants.event_id AND e.organizer_id = auth.uid()));

CREATE POLICY "Organizers can delete their event participants"
ON public.participants AS PERMISSIVE
FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = participants.event_id AND e.organizer_id = auth.uid()));

-- Restrictive SELECT: must be event organizer regardless of any other permissive policy.
CREATE POLICY "Restrict participant reads to event organizer"
ON public.participants AS RESTRICTIVE
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = participants.event_id AND e.organizer_id = auth.uid()));

REVOKE SELECT ON public.participants FROM anon;
GRANT INSERT ON public.participants TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.participants TO authenticated;
GRANT ALL ON public.participants TO service_role;
