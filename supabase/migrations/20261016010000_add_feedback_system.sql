
BEGIN;

-- =========================================
-- 1. BIỂU MẪU FEEDBACK
-- =========================================
CREATE TABLE public.feedback_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  event_id UUID NOT NULL
    REFERENCES public.events(id) ON DELETE CASCADE,

  title TEXT NOT NULL
    CHECK (length(btrim(title)) BETWEEN 1 AND 200),

  description TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'closed')),

  created_by UUID REFERENCES auth.users(id)
    ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_forms_event
ON public.feedback_forms(event_id);


-- =========================================
-- 2. CÂU HỎI TRONG BIỂU MẪU
-- =========================================
CREATE TABLE public.feedback_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  form_id UUID NOT NULL
    REFERENCES public.feedback_forms(id) ON DELETE CASCADE,

  title TEXT NOT NULL
    CHECK (length(btrim(title)) BETWEEN 1 AND 500),

  question_type TEXT NOT NULL
    CHECK (question_type IN (
      'rating',
      'short_text',
      'long_text',
      'single_choice',
      'multi_choice'
    )),

  options JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(options) = 'array'),

  is_required BOOLEAN NOT NULL DEFAULT true,

  position INTEGER NOT NULL DEFAULT 0
    CHECK (position >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (form_id, id)
);

CREATE INDEX idx_feedback_questions_form
ON public.feedback_questions(form_id, position);


-- =========================================
-- 3. LƯỢT GỬI FEEDBACK
-- =========================================
CREATE TABLE public.feedback_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  form_id UUID NOT NULL
    REFERENCES public.feedback_forms(id) ON DELETE CASCADE,

  participant_id UUID NOT NULL
    REFERENCES public.participants(id) ON DELETE CASCADE,

  email_normalized TEXT NOT NULL
    CHECK (
      length(email_normalized) BETWEEN 3 AND 320
      AND email_normalized = lower(btrim(email_normalized))
    ),

  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Chống gửi trùng email, kể cả nhiều phòng
  UNIQUE (form_id, email_normalized),

  UNIQUE (form_id, id)
);

CREATE INDEX idx_feedback_submissions_form
ON public.feedback_submissions(form_id);


-- =========================================
-- 4. CÂU TRẢ LỜI
-- =========================================
CREATE TABLE public.feedback_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  form_id UUID NOT NULL,
  submission_id UUID NOT NULL,
  question_id UUID NOT NULL,

  answer JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (form_id, submission_id)
    REFERENCES public.feedback_submissions(form_id, id)
    ON DELETE CASCADE,

  FOREIGN KEY (form_id, question_id)
    REFERENCES public.feedback_questions(form_id, id)
    ON DELETE CASCADE,

  UNIQUE (submission_id, question_id)
);

CREATE INDEX idx_feedback_answers_question
ON public.feedback_answers(question_id);


-- =========================================
-- 5. KIỂM TRA EMAIL + SỰ KIỆN Ở DATABASE
-- =========================================
CREATE FUNCTION public.validate_feedback_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id UUID;
  v_status TEXT;
  v_participant_event UUID;
  v_participant_email TEXT;
BEGIN
  SELECT f.event_id, f.status
  INTO v_event_id, v_status
  FROM public.feedback_forms f
  WHERE f.id = NEW.form_id
  FOR SHARE;

  IF v_event_id IS NULL OR v_status <> 'open' THEN
    RAISE EXCEPTION 'Biểu mẫu không nhận phản hồi.';
  END IF;

  SELECT p.event_id, lower(btrim(p.email))
  INTO v_participant_event, v_participant_email
  FROM public.participants p
  WHERE p.id = NEW.participant_id;

  IF v_participant_event IS DISTINCT FROM v_event_id
     OR v_participant_email IS DISTINCT FROM NEW.email_normalized THEN
    RAISE EXCEPTION 'Không thể xác nhận người tham gia.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_feedback_submission
BEFORE INSERT ON public.feedback_submissions
FOR EACH ROW
EXECUTE FUNCTION public.validate_feedback_submission();

REVOKE ALL ON FUNCTION public.validate_feedback_submission()
FROM PUBLIC, anon, authenticated;


-- =========================================
-- 6. BẬT ROW LEVEL SECURITY
-- =========================================
ALTER TABLE public.feedback_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_answers ENABLE ROW LEVEL SECURITY;

-- Không cho người dùng ghi trực tiếp
REVOKE ALL ON
  public.feedback_forms,
  public.feedback_questions,
  public.feedback_submissions,
  public.feedback_answers
FROM PUBLIC, anon, authenticated;

-- Đội ngũ quản lý được đọc qua RLS
GRANT SELECT ON
  public.feedback_forms,
  public.feedback_questions,
  public.feedback_submissions,
  public.feedback_answers
TO authenticated;

-- Backend có quyền xử lý
GRANT ALL ON
  public.feedback_forms,
  public.feedback_questions,
  public.feedback_submissions,
  public.feedback_answers
TO service_role;


-- =========================================
-- 7. CHÍNH SÁCH ĐỌC CHO BTC
-- =========================================
CREATE POLICY "Managers view feedback forms"
ON public.feedback_forms
FOR SELECT TO authenticated
USING (
  public.get_event_role(event_id)
  IN ('owner', 'co_owner', 'manager')
);

CREATE POLICY "Managers view feedback questions"
ON public.feedback_questions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.feedback_forms f
    WHERE f.id = form_id
      AND public.get_event_role(f.event_id)
      IN ('owner', 'co_owner', 'manager')
  )
);

CREATE POLICY "Managers view feedback submissions"
ON public.feedback_submissions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.feedback_forms f
    WHERE f.id = form_id
      AND public.get_event_role(f.event_id)
      IN ('owner', 'co_owner', 'manager')
  )
);

CREATE POLICY "Managers view feedback answers"
ON public.feedback_answers
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.feedback_forms f
    WHERE f.id = form_id
      AND public.get_event_role(f.event_id)
      IN ('owner', 'co_owner', 'manager')
  )
);

COMMIT;
