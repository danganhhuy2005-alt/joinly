-- JOINLY Live Q&A / Raise Hand
-- New tables only. Does not modify participants, ticket tokens, billing or Quiz.
-- IMPORTANT: Review first; run once in Supabase SQL Editor. Do not db push manually-run migration.
BEGIN;

CREATE TABLE IF NOT EXISTS public.event_qna_settings (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  is_open boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_qna_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 5 AND 400),
  is_anonymous boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'answered', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_qna_questions_event
  ON public.event_qna_questions (event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_qna_questions_participant
  ON public.event_qna_questions (participant_id, created_at DESC);
-- At most one unmoderated question per participant per event.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_qna_pending_participant
  ON public.event_qna_questions(event_id, participant_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS public.event_qna_hands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'raised'
    CHECK (status IN ('raised', 'lowered', 'handled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(event_id, participant_id)
);
CREATE INDEX IF NOT EXISTS idx_event_qna_hands_queue
  ON public.event_qna_hands(event_id, status, updated_at);

-- Prevent cross-event attribution: tickets must belong to the same event.
CREATE OR REPLACE FUNCTION public.assert_qna_participant_event()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.participants p
    WHERE p.id = NEW.participant_id AND p.event_id = NEW.event_id
  ) THEN
    RAISE EXCEPTION 'QNA_PARTICIPANT_EVENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_qna_question_participant_event ON public.event_qna_questions;
CREATE TRIGGER trg_qna_question_participant_event
  BEFORE INSERT OR UPDATE ON public.event_qna_questions
  FOR EACH ROW EXECUTE FUNCTION public.assert_qna_participant_event();
DROP TRIGGER IF EXISTS trg_qna_hand_participant_event ON public.event_qna_hands;
CREATE TRIGGER trg_qna_hand_participant_event
  BEFORE INSERT OR UPDATE ON public.event_qna_hands
  FOR EACH ROW EXECUTE FUNCTION public.assert_qna_participant_event();

ALTER TABLE public.event_qna_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_qna_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_qna_hands ENABLE ROW LEVEL SECURITY;

-- No direct writes from browsers: server-side functions validate confirmation_token
-- or signed-in event management role before using service_role.
REVOKE ALL ON public.event_qna_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.event_qna_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.event_qna_hands FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.event_qna_settings TO anon, authenticated;
-- Only organizers can SELECT raw question rows containing participant IDs.
-- Participants receive a sanitized approved list via server function instead.
GRANT SELECT ON public.event_qna_questions TO authenticated;
GRANT SELECT ON public.event_qna_hands TO authenticated;

DROP POLICY IF EXISTS qna_settings_public_read ON public.event_qna_settings;
CREATE POLICY qna_settings_public_read ON public.event_qna_settings FOR SELECT
TO anon, authenticated USING (
  EXISTS (SELECT 1 FROM public.events e
          WHERE e.id = event_id AND e.lifecycle_status = 'active')
  OR public.get_event_role(event_id) IN ('owner', 'co_owner', 'manager')
);

DROP POLICY IF EXISTS qna_questions_host_read ON public.event_qna_questions;
CREATE POLICY qna_questions_host_read ON public.event_qna_questions FOR SELECT
TO authenticated USING (
  public.get_event_role(event_id) IN ('owner', 'co_owner', 'manager')
);

DROP POLICY IF EXISTS qna_hands_host_read ON public.event_qna_hands;
CREATE POLICY qna_hands_host_read ON public.event_qna_hands FOR SELECT
TO authenticated USING (
  public.get_event_role(event_id) IN ('owner', 'co_owner', 'manager')
);

-- Supabase Realtime, if publication exists. Polling still works otherwise.
DO $block$
DECLARE v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY[
      'event_qna_questions', 'event_qna_hands', 'event_qna_settings'
    ] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public' AND tablename = v_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END;
$block$;

COMMIT;
