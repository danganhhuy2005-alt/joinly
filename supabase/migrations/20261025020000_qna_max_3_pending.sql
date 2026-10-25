-- JOINLY Live Q&A: TOI DA 3 CAU DANG CHO DUYET TREN MOI VE.
-- Da duyet/da tra loi/tu choi khong chiem cho trong hang cho.
-- Khong gioi han tong so cau hoi cua mot nguoi tham gia.
-- Thay the gioi han 3 cau TONG CONG o migration 20261025010000.
-- KHONG xoa hay sua cau hoi da luu. An toan khi chay 1 lan trong SQL Editor.
BEGIN;

-- Unique index cu chi cho phep 1 cau pending/ve; phai go bo de cho 3 cau.
DROP INDEX IF EXISTS public.uq_event_qna_pending_participant;

-- Giu ten function va trigger cu de co the nang cap tu ban truoc.
CREATE OR REPLACE FUNCTION public.enforce_qna_three_questions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Chi dem khi chen cau hoi cho duyet.
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  -- Khoa participant de tranh hai request dong thoi vuot qua 3 pending.
  PERFORM 1
  FROM public.participants p
  WHERE p.id = NEW.participant_id
    AND p.event_id = NEW.event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QNA_PARTICIPANT_EVENT_MISMATCH';
  END IF;

  SELECT COUNT(*)::integer
  INTO v_count
  FROM public.event_qna_questions q
  WHERE q.event_id = NEW.event_id
    AND q.participant_id = NEW.participant_id
    AND q.status = 'pending';

  IF v_count >= 3 THEN
    RAISE EXCEPTION 'QNA_QUESTION_LIMIT_REACHED';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_qna_max_3_questions
  ON public.event_qna_questions;

CREATE TRIGGER trg_qna_max_3_questions
BEFORE INSERT ON public.event_qna_questions
FOR EACH ROW EXECUTE FUNCTION public.enforce_qna_three_questions();

REVOKE ALL ON FUNCTION public.enforce_qna_three_questions()
FROM PUBLIC, anon, authenticated;

COMMIT;
