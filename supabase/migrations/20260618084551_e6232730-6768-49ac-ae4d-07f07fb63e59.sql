DROP POLICY IF EXISTS "Anyone can register as participant" ON public.participants;

CREATE POLICY "Anyone can register as participant"
ON public.participants
FOR INSERT
TO anon, authenticated
WITH CHECK (
  checked_in = false
  AND EXISTS (
    SELECT 1 FROM public.event_rooms r
    WHERE r.id = participants.room_id
      AND r.event_id = participants.event_id
  )
);