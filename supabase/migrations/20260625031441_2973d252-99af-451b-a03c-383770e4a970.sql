CREATE UNIQUE INDEX IF NOT EXISTS participants_event_room_email_unique
  ON public.participants (event_id, room_id, lower(email));