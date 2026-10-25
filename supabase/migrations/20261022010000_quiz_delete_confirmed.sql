
-- JOINLY - QUIZ DELETE CONFIRMED
-- Dong bo RPC tu Supabase production
-- Chi service_role co quyen thuc thi

BEGIN;

CREATE OR REPLACE FUNCTION public.quiz_delete_confirmed(
  p_quiz_id uuid,
  p_confirm_active boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_has_active BOOLEAN;
BEGIN
  -- Khoa bo Quiz trong luc xoa.
  PERFORM 1
  FROM public.quizzes
  WHERE id = p_quiz_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUIZ_NOT_FOUND';
  END IF;

  -- Kiem tra phien dang mo.
  SELECT EXISTS (
    SELECT 1
    FROM public.quiz_sessions
    WHERE quiz_id = p_quiz_id
      AND status IN ('waiting', 'active', 'paused')
  )
  INTO v_has_active;

  -- Phai co xac nhan ro rang.
  IF v_has_active
     AND NOT COALESCE(p_confirm_active, FALSE)
  THEN
    RAISE EXCEPTION 'QUIZ_CONFIRM_ACTIVE_REQUIRED';
  END IF;

  -- Xoa cau tra loi.
  DELETE FROM public.quiz_answers
  WHERE quiz_id = p_quiz_id;

  -- Xoa luot tham gia va diem.
  DELETE FROM public.quiz_attempts
  WHERE quiz_id = p_quiz_id;

  -- Xoa tat ca phien Quiz.
  DELETE FROM public.quiz_sessions
  WHERE quiz_id = p_quiz_id;

  -- Xoa cau hoi.
  DELETE FROM public.quiz_questions
  WHERE quiz_id = p_quiz_id;

  -- Xoa bo Quiz.
  DELETE FROM public.quizzes
  WHERE id = p_quiz_id;

  RETURN TRUE;
END;
$function$;

-- Bao ve RPC: chi backend duoc phep goi.
REVOKE ALL ON FUNCTION
public.quiz_delete_confirmed(uuid, boolean)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.quiz_delete_confirmed(uuid, boolean)
TO service_role;

COMMIT;
