
BEGIN;

-- ==========================================
-- 1. THÊM GIỚI HẠN LỰA CHỌN
-- ==========================================

ALTER TABLE public.feedback_questions
ADD COLUMN IF NOT EXISTS max_choices INTEGER;

-- ==========================================
-- 2. KIỂM TRA CẤU HÌNH CÂU HỎI
-- ==========================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.feedback_questions'::regclass
      AND conname = 'feedback_max_choices_check'
  ) THEN

    ALTER TABLE public.feedback_questions
    ADD CONSTRAINT feedback_max_choices_check
    CHECK (
      (
        question_type = 'multi_choice'
        AND (
          max_choices IS NULL
          OR (
            max_choices BETWEEN 1 AND 30
            AND max_choices <= jsonb_array_length(options)
          )
        )
      )
      OR (
        question_type <> 'multi_choice'
        AND max_choices IS NULL
      )
    );

  END IF;
END;
$$;

-- ==========================================
-- 3. KIỂM TRA ĐÁP ÁN KHI LƯU
-- ==========================================

CREATE OR REPLACE FUNCTION public.enforce_feedback_max_choices()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_question_type TEXT;
  v_max_choices INTEGER;
BEGIN

  SELECT
    q.question_type,
    q.max_choices
  INTO
    v_question_type,
    v_max_choices
  FROM public.feedback_questions q
  WHERE q.id = NEW.question_id
    AND q.form_id = NEW.form_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Câu hỏi Feedback không hợp lệ.';
  END IF;

  IF v_question_type = 'multi_choice'
     AND v_max_choices IS NOT NULL THEN

    IF jsonb_typeof(NEW.answer)
       IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Đáp án không hợp lệ.';
    END IF;

    IF jsonb_array_length(NEW.answer) > v_max_choices THEN
      RAISE EXCEPTION
        'Chỉ được chọn tối đa % đáp án.',
        v_max_choices;
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

-- ==========================================
-- 4. KÍCH HOẠT TRIGGER
-- ==========================================

DROP TRIGGER IF EXISTS trg_enforce_feedback_max_choices
ON public.feedback_answers;

CREATE TRIGGER trg_enforce_feedback_max_choices
BEFORE INSERT OR UPDATE OF
  answer, question_id, form_id
ON public.feedback_answers
FOR EACH ROW
EXECUTE FUNCTION public.enforce_feedback_max_choices();

-- Không cho client gọi hàm trigger trực tiếp
REVOKE ALL
ON FUNCTION public.enforce_feedback_max_choices()
FROM PUBLIC, anon, authenticated;

COMMIT;
