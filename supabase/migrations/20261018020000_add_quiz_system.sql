
BEGIN;

-- ==========================================
-- 1. BỘ CÂU HỎI QUIZ
-- ==========================================

CREATE TABLE public.quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  event_id UUID NOT NULL
    REFERENCES public.events(id) ON DELETE CASCADE,

  title TEXT NOT NULL
    CHECK (length(btrim(title)) BETWEEN 1 AND 200),

  description TEXT,

  created_by UUID REFERENCES auth.users(id)
    ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_quizzes_event
ON public.quizzes(event_id);


-- ==========================================
-- 2. CÂU HỎI TRẮC NGHIỆM
-- ==========================================

CREATE TABLE public.quiz_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  quiz_id UUID NOT NULL
    REFERENCES public.quizzes(id) ON DELETE CASCADE,

  title TEXT NOT NULL
    CHECK (length(btrim(title)) BETWEEN 1 AND 1000),

  options JSONB NOT NULL
    CHECK (
      jsonb_typeof(options) = 'array'
      AND jsonb_array_length(options) BETWEEN 2 AND 6
    ),

  correct_index INTEGER NOT NULL
    CHECK (correct_index >= 0),

  position INTEGER NOT NULL DEFAULT 0
    CHECK (position >= 0),

  points INTEGER NOT NULL DEFAULT 100
    CHECK (points BETWEEN 1 AND 10000),

  time_limit_seconds INTEGER NOT NULL DEFAULT 20
    CHECK (time_limit_seconds BETWEEN 5 AND 300),

  explanation TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (quiz_id, id),

  CONSTRAINT valid_quiz_correct_index
  CHECK (correct_index < jsonb_array_length(options))
);

CREATE INDEX idx_quiz_questions_order
ON public.quiz_questions(quiz_id, position);


-- ==========================================
-- 3. PHIÊN CHƠI
-- LIVE / SELF-PACED
-- ==========================================

CREATE TABLE public.quiz_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  quiz_id UUID NOT NULL
    REFERENCES public.quizzes(id) ON DELETE CASCADE,

  mode TEXT NOT NULL
    CHECK (mode IN ('live', 'self_paced')),

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'waiting',
        'active',
        'paused',
        'finished',
        'closed'
      )
    ),

  join_code TEXT UNIQUE
    CHECK (
      join_code IS NULL
      OR join_code ~ '^[A-Z0-9]{6,8}$'
    ),

  current_question INTEGER NOT NULL DEFAULT 0
    CHECK (current_question >= 0),

  question_started_at TIMESTAMPTZ,

  created_by UUID REFERENCES auth.users(id)
    ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,

  UNIQUE (quiz_id, id)
);

CREATE INDEX idx_quiz_sessions_quiz
ON public.quiz_sessions(quiz_id, created_at DESC);

-- Mỗi bộ câu hỏi chỉ có một phiên đang
-- hoạt động cho từng chế độ cùng lúc.

CREATE UNIQUE INDEX idx_quiz_one_active_mode
ON public.quiz_sessions(quiz_id, mode)
WHERE status IN ('waiting', 'active', 'paused');


-- ==========================================
-- 4. NGƯỜI CHƠI / LƯỢT LÀM BÀI
-- ==========================================

CREATE TABLE public.quiz_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  quiz_id UUID NOT NULL,

  session_id UUID NOT NULL,

  player_name TEXT NOT NULL
    CHECK (length(btrim(player_name)) BETWEEN 1 AND 100),

  -- Hash token để xác thực phiên người chơi
  -- Không lưu token gốc vào database.

  player_token_hash TEXT NOT NULL
    CHECK (player_token_hash ~ '^[0-9a-f]{64}$'),

  score INTEGER NOT NULL DEFAULT 0
    CHECK (score >= 0),

  correct_count INTEGER NOT NULL DEFAULT 0
    CHECK (correct_count >= 0),

  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'submitted')),

  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  FOREIGN KEY (quiz_id, session_id)
    REFERENCES public.quiz_sessions(quiz_id, id)
    ON DELETE CASCADE,

  UNIQUE (session_id, player_token_hash),

  UNIQUE (quiz_id, id)
);

CREATE INDEX idx_quiz_attempts_session
ON public.quiz_attempts(session_id, score DESC);


-- ==========================================
-- 5. CÂU TRẢ LỜI NGƯỜI CHƠI
-- ==========================================

CREATE TABLE public.quiz_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  quiz_id UUID NOT NULL,
  attempt_id UUID NOT NULL,
  question_id UUID NOT NULL,

  selected_index INTEGER NOT NULL
    CHECK (selected_index >= 0),

  is_correct BOOLEAN NOT NULL DEFAULT false,

  points_earned INTEGER NOT NULL DEFAULT 0
    CHECK (points_earned >= 0),

  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  FOREIGN KEY (quiz_id, attempt_id)
    REFERENCES public.quiz_attempts(quiz_id, id)
    ON DELETE CASCADE,

  FOREIGN KEY (quiz_id, question_id)
    REFERENCES public.quiz_questions(quiz_id, id),

  UNIQUE (attempt_id, question_id)
);

CREATE INDEX idx_quiz_answers_attempt
ON public.quiz_answers(attempt_id);


-- ==========================================
-- 6. ROW LEVEL SECURITY
-- ==========================================

ALTER TABLE public.quizzes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quiz_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quiz_attempts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quiz_answers ENABLE ROW LEVEL SECURITY;


-- Không cho client tự ghi điểm hoặc đáp án.

REVOKE ALL ON
  public.quizzes,
  public.quiz_questions,
  public.quiz_sessions,
  public.quiz_attempts,
  public.quiz_answers
FROM PUBLIC, anon, authenticated;


-- BTC có thể đọc dữ liệu thông qua RLS.

GRANT SELECT ON
  public.quizzes,
  public.quiz_questions,
  public.quiz_sessions,
  public.quiz_attempts,
  public.quiz_answers
TO authenticated;


-- Server sử dụng service_role sau khi
-- đã kiểm tra quyền hoặc phiên người chơi.

GRANT ALL ON
  public.quizzes,
  public.quiz_questions,
  public.quiz_sessions,
  public.quiz_attempts,
  public.quiz_answers
TO service_role;


-- ==========================================
-- 7. PHÂN QUYỀN BTC
-- ==========================================

CREATE POLICY "BTC view quizzes"
ON public.quizzes
FOR SELECT TO authenticated
USING (
  public.get_event_role(event_id)
  IN ('owner', 'co_owner', 'manager')
);

CREATE POLICY "BTC view quiz questions"
ON public.quiz_questions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.quizzes q
    WHERE q.id = quiz_id
      AND public.get_event_role(q.event_id)
      IN ('owner', 'co_owner', 'manager')
  )
);

CREATE POLICY "BTC view quiz sessions"
ON public.quiz_sessions
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.quizzes q
    WHERE q.id = quiz_id
      AND public.get_event_role(q.event_id)
      IN ('owner', 'co_owner', 'manager')
  )
);

CREATE POLICY "BTC view quiz attempts"
ON public.quiz_attempts
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.quizzes q
    WHERE q.id = quiz_id
      AND public.get_event_role(q.event_id)
      IN ('owner', 'co_owner', 'manager')
  )
);

CREATE POLICY "BTC view quiz answers"
ON public.quiz_answers
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.quizzes q
    WHERE q.id = quiz_id
      AND public.get_event_role(q.event_id)
      IN ('owner', 'co_owner', 'manager')
  )
);

COMMIT;
