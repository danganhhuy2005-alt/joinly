-- JOINLY Live Q&A: maximum 3 questions per participant ticket per event.
-- Counts every status (pending, approved, answered, rejected).
-- Safe for concurrent submissions: serialize by locking the participant row.
-- Does not delete or modify existing questions.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_qna_three_questions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Serialize submissions for the same ticket, even across devices.
  PERFORM 1
  FROM public.participants p
  WHERE p.id = NEW.participant_id
    AND p.event_id = NEW.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QNA_PARTICIPANT_EVENT_MISMATCH';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM public.event_qna_questions q
  WHERE q.event_id = NEW.event_id
    AND q.participant_id = NEW.participant_id;

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'QNA_QUESTION_LIMIT_REACHED';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_qna_max_3_questions ON public.event_qna_questions;
CREATE TRIGGER trg_qna_max_3_questions
BEFORE INSERT ON public.event_qna_questions
FOR EACH ROW EXECUTE FUNCTION public.enforce_qna_three_questions();

-- Ordinary users cannot call this trigger function as a standalone RPC.
REVOKE ALL ON FUNCTION public.enforce_qna_three_questions()
FROM PUBLIC, anon, authenticated;

COMMIT;
