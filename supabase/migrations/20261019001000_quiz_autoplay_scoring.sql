
BEGIN;

-- ============================================
-- JOINLY LIVE QUIZ - AUTO PLAY + SPEED SCORING
-- ============================================

-- Cho phép một bộ Quiz mở nhiều phiên Live.

DROP INDEX IF EXISTS
  public.idx_quiz_one_active_mode;


-- ============================================
-- 1. CẤU HÌNH PHIÊN LIVE
-- ============================================

ALTER TABLE public.quiz_sessions
ADD COLUMN IF NOT EXISTS
  auto_play_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.quiz_sessions
ADD COLUMN IF NOT EXISTS
  live_phase TEXT NOT NULL DEFAULT 'lobby';

ALTER TABLE public.quiz_sessions
ADD COLUMN IF NOT EXISTS
  phase_started_at TIMESTAMPTZ;

ALTER TABLE public.quiz_sessions
ADD COLUMN IF NOT EXISTS
  reveal_seconds INTEGER NOT NULL DEFAULT 4;

ALTER TABLE public.quiz_sessions
ADD COLUMN IF NOT EXISTS
  leaderboard_seconds INTEGER NOT NULL DEFAULT 5;

ALTER TABLE public.quiz_sessions
ADD COLUMN IF NOT EXISTS
  scoring_player_count INTEGER;


ALTER TABLE public.quiz_sessions
DROP CONSTRAINT IF EXISTS
  quiz_sessions_live_phase_check;

ALTER TABLE public.quiz_sessions
ADD CONSTRAINT quiz_sessions_live_phase_check
CHECK (
  live_phase IN (
    'lobby',
    'question',
    'reveal',
    'leaderboard',
    'finished'
  )
);


ALTER TABLE public.quiz_sessions
DROP CONSTRAINT IF EXISTS
  quiz_sessions_reveal_seconds_check;

ALTER TABLE public.quiz_sessions
ADD CONSTRAINT quiz_sessions_reveal_seconds_check
CHECK (
  reveal_seconds BETWEEN 1 AND 30
);


ALTER TABLE public.quiz_sessions
DROP CONSTRAINT IF EXISTS
  quiz_sessions_leaderboard_seconds_check;

ALTER TABLE public.quiz_sessions
ADD CONSTRAINT quiz_sessions_leaderboard_seconds_check
CHECK (
  leaderboard_seconds BETWEEN 1 AND 30
);


ALTER TABLE public.quiz_sessions
DROP CONSTRAINT IF EXISTS
  quiz_sessions_scoring_player_count_check;

ALTER TABLE public.quiz_sessions
ADD CONSTRAINT quiz_sessions_scoring_player_count_check
CHECK (
  scoring_player_count IS NULL
  OR scoring_player_count > 0
);


-- 20 giây/câu; BTC được tùy chỉnh.
-- Điểm không hiển thị cho người tạo Quiz.

ALTER TABLE public.quiz_questions
ALTER COLUMN time_limit_seconds SET DEFAULT 20;

ALTER TABLE public.quiz_questions
ALTER COLUMN points SET DEFAULT 1000;

-- Chuẩn bị ảnh/GIF cho câu hỏi.

ALTER TABLE public.quiz_questions
ADD COLUMN IF NOT EXISTS media_url TEXT;

-- Hỗ trợ đếm câu trả lời hiệu quả hơn.

CREATE INDEX IF NOT EXISTS
  idx_quiz_answers_question
ON public.quiz_answers(question_id, attempt_id);


-- ============================================
-- 2. AUTO PLAY CONTROLLER
-- ============================================

CREATE OR REPLACE FUNCTION
public.quiz_live_auto_control(
  p_session_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_s public.quiz_sessions%ROWTYPE;

  v_now TIMESTAMPTZ;
  v_deadline TIMESTAMPTZ;
  v_transition TIMESTAMPTZ;

  v_total INTEGER;
  v_players INTEGER;
  v_duration INTEGER;
  v_i INTEGER;
BEGIN

  IF p_action IS NULL
     OR p_action NOT IN (
       'start',
       'pause',
       'resume',
       'skip',
       'tick'
     )
  THEN
    RAISE EXCEPTION
      'Lệnh Live Quiz không hợp lệ.';
  END IF;


  -- Khóa phiên để đồng bộ các lệnh Host.

  SELECT *
  INTO v_s
  FROM public.quiz_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND OR v_s.mode <> 'live' THEN
    RAISE EXCEPTION
      'Không tìm thấy phiên Live Quiz.';
  END IF;

  v_now := clock_timestamp();

  SELECT COUNT(*)::INTEGER
  INTO v_total
  FROM public.quiz_questions
  WHERE quiz_id = v_s.quiz_id;


  -- ========================================
  -- START
  -- ========================================

  IF p_action = 'start' THEN

    IF v_s.status <> 'waiting' THEN
      RAISE EXCEPTION
        'Chỉ bắt đầu được từ phòng chờ.';
    END IF;

    IF v_total = 0 THEN
      RAISE EXCEPTION
        'Quiz chưa có câu hỏi.';
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_players
    FROM public.quiz_attempts
    WHERE session_id = p_session_id;

    IF v_players = 0 THEN
      RAISE EXCEPTION
        'Cần ít nhất một người chơi.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      auto_play_enabled = TRUE,
      scoring_player_count = v_players,
      status = 'active',
      live_phase = 'question',
      current_question = 0,
      started_at = COALESCE(started_at, v_now),
      question_started_at = v_now,
      phase_started_at = v_now,
      paused_at = NULL,
      results_revealed = FALSE,
      revealed_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_s;


  -- ========================================
  -- PAUSE
  -- ========================================

  ELSIF p_action = 'pause' THEN

    IF NOT v_s.auto_play_enabled
       OR v_s.status <> 'active'
    THEN
      RAISE EXCEPTION
        'Không thể tạm dừng phiên này.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'paused',
      paused_at = v_now
    WHERE id = p_session_id
    RETURNING * INTO v_s;


  -- ========================================
  -- RESUME
  -- ========================================

  ELSIF p_action = 'resume' THEN

    IF NOT v_s.auto_play_enabled
       OR v_s.status <> 'paused'
       OR v_s.paused_at IS NULL
    THEN
      RAISE EXCEPTION
        'Phiên này chưa được tạm dừng.';
    END IF;

    -- Bảo toàn thời gian còn lại
    -- của câu hỏi và giai đoạn hiện tại.

    UPDATE public.quiz_sessions
    SET
      status = 'active',

      phase_started_at =
        phase_started_at
        + (v_now - paused_at),

      question_started_at =
        question_started_at
        + (v_now - paused_at),

      paused_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_s;


  -- ========================================
  -- TICK / SKIP
  -- ========================================

  ELSIF p_action IN ('tick', 'skip') THEN

    IF p_action = 'skip'
       AND (
         NOT v_s.auto_play_enabled
         OR v_s.status <> 'active'
       )
    THEN
      RAISE EXCEPTION
        'Không thể bỏ qua giai đoạn hiện tại.';
    END IF;

    IF v_s.auto_play_enabled
       AND v_s.status = 'active'
    THEN

      -- Tick có thể bắt kịp nhiều giai đoạn.
      -- Skip chỉ chuyển một giai đoạn.

      FOR v_i IN 1..(v_total * 3 + 3) LOOP

        EXIT WHEN v_s.status <> 'active';

        EXIT WHEN v_s.live_phase NOT IN (
          'question',
          'reveal',
          'leaderboard'
        );

        IF v_s.phase_started_at IS NULL THEN
          RAISE EXCEPTION
            'Thiếu mốc thời gian của phiên.';
        END IF;


        -- Lấy thời gian của giai đoạn.

        IF v_s.live_phase = 'question' THEN

          SELECT time_limit_seconds
          INTO v_duration
          FROM public.quiz_questions
          WHERE quiz_id = v_s.quiz_id
          ORDER BY position, id
          OFFSET v_s.current_question
          LIMIT 1;

          IF NOT FOUND THEN
            RAISE EXCEPTION
              'Không tìm thấy câu hỏi hiện tại.';
          END IF;

        ELSIF v_s.live_phase = 'reveal' THEN

          v_duration := v_s.reveal_seconds;

        ELSE

          v_duration := v_s.leaderboard_seconds;

        END IF;


        v_deadline :=
          v_s.phase_started_at
          + v_duration * INTERVAL '1 second';


        -- Chưa hết giờ thì không chuyển.

        IF p_action = 'tick'
           AND v_now < v_deadline
        THEN
          EXIT;
        END IF;


        v_transition :=
          CASE
            WHEN p_action = 'skip'
              THEN v_now
            ELSE v_deadline
          END;


        -- ==================================
        -- QUESTION -> REVEAL
        -- ==================================

        IF v_s.live_phase = 'question' THEN

          UPDATE public.quiz_sessions
          SET
            live_phase = 'reveal',
            phase_started_at = v_transition,
            results_revealed = TRUE,
            revealed_at = v_transition
          WHERE id = p_session_id
          RETURNING * INTO v_s;


        -- ==================================
        -- REVEAL -> LEADERBOARD
        -- ==================================

        ELSIF v_s.live_phase = 'reveal' THEN

          UPDATE public.quiz_sessions
          SET
            live_phase = 'leaderboard',
            phase_started_at = v_transition
          WHERE id = p_session_id
          RETURNING * INTO v_s;


        -- ==================================
        -- LEADERBOARD -> NEXT / FINISH
        -- ==================================

        ELSE

          IF v_s.current_question + 1 >= v_total THEN

            UPDATE public.quiz_sessions
            SET
              status = 'finished',
              live_phase = 'finished',
              finished_at = v_transition,
              phase_started_at = v_transition,
              paused_at = NULL
            WHERE id = p_session_id
            RETURNING * INTO v_s;

          ELSE

            UPDATE public.quiz_sessions
            SET
              current_question = current_question + 1,
              live_phase = 'question',
              phase_started_at = v_transition,
              question_started_at = v_transition,
              results_revealed = FALSE,
              revealed_at = NULL
            WHERE id = p_session_id
            RETURNING * INTO v_s;

          END IF;

        END IF;


        IF p_action = 'skip' THEN
          EXIT;
        END IF;

      END LOOP;

    END IF;

  END IF;


  RETURN jsonb_build_object(
    'ok', TRUE,
    'session_id', v_s.id,
    'status', v_s.status,
    'live_phase', v_s.live_phase,
    'current_question', v_s.current_question,
    'total_questions', v_total,
    'phase_started_at', v_s.phase_started_at,
    'question_started_at', v_s.question_started_at,
    'results_revealed', v_s.results_revealed,
    'server_now', clock_timestamp()
  );

END;
$$;


-- ============================================
-- 3. CHẤM ĐIỂM LIVE QUIZ
-- ============================================

CREATE OR REPLACE FUNCTION
public.quiz_submit_answer(
  p_attempt_id UUID,
  p_token_hash TEXT,
  p_question_id UUID,
  p_selected_index INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_a public.quiz_attempts%ROWTYPE;
  v_s public.quiz_sessions%ROWTYPE;
  v_q public.quiz_questions%ROWTYPE;

  v_expected UUID;

  v_received_at TIMESTAMPTZ;
  v_elapsed NUMERIC;

  v_correct BOOLEAN;
  v_points INTEGER;

  v_prior_answers INTEGER := 0;
  v_player_total INTEGER := 1;
  v_crowd_ratio NUMERIC := 0;

  v_answered INTEGER;
  v_total INTEGER;
BEGIN

  -- ========================================
  -- XÁC THỰC NGƯỜI CHƠI
  -- ========================================

  SELECT *
  INTO v_a
  FROM public.quiz_attempts
  WHERE id = p_attempt_id
    AND player_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'invalid_player'
    );
  END IF;

  IF v_a.status <> 'in_progress' THEN
    RETURN jsonb_build_object(
      'status', 'already_finished'
    );
  END IF;


  -- Khóa đọc phiên để đồng bộ với Host.

  SELECT *
  INTO v_s
  FROM public.quiz_sessions
  WHERE id = v_a.session_id
    AND quiz_id = v_a.quiz_id
  FOR SHARE;

  IF NOT FOUND OR v_s.status <> 'active' THEN
    RETURN jsonb_build_object(
      'status', 'not_active'
    );
  END IF;


  -- Ghi thời điểm server nhận xử lý.
  -- Không sử dụng thời gian từ điện thoại.

  v_received_at := clock_timestamp();


  -- ========================================
  -- KIỂM TRA CÂU HỎI VÀ ĐÁP ÁN
  -- ========================================

  SELECT *
  INTO v_q
  FROM public.quiz_questions
  WHERE id = p_question_id
    AND quiz_id = v_a.quiz_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'invalid_question'
    );
  END IF;

  IF p_selected_index IS NULL
     OR p_selected_index < 0
     OR p_selected_index >=
        jsonb_array_length(v_q.options)
  THEN
    RETURN jsonb_build_object(
      'status', 'invalid_choice'
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.quiz_answers
    WHERE attempt_id = v_a.id
      AND question_id = p_question_id
  ) THEN
    RETURN jsonb_build_object(
      'status', 'already_answered'
    );
  END IF;


  -- ========================================
  -- LIVE QUIZ
  -- ========================================

  IF v_s.mode = 'live' THEN

    SELECT id
    INTO v_expected
    FROM public.quiz_questions
    WHERE quiz_id = v_a.quiz_id
    ORDER BY position, id
    OFFSET v_s.current_question
    LIMIT 1;

    IF v_expected IS DISTINCT
       FROM p_question_id
    THEN
      RETURN jsonb_build_object(
        'status', 'wrong_question'
      );
    END IF;

    IF v_s.question_started_at IS NULL THEN
      RETURN jsonb_build_object(
        'status', 'not_started'
      );
    END IF;


    -- Sau khi công bố đáp án thì khóa.

    IF v_s.results_revealed
       OR (
         v_s.auto_play_enabled
         AND v_s.live_phase <> 'question'
       )
    THEN
      RETURN jsonb_build_object(
        'status', 'time_up'
      );
    END IF;


    v_elapsed := EXTRACT(
      EPOCH FROM (
        v_received_at - v_s.question_started_at
      )
    );

    IF v_elapsed < 0 THEN
      RETURN jsonb_build_object(
        'status', 'not_started'
      );
    END IF;


    -- Chỉ hết giờ mới khóa trả lời.
    -- Số người đã trả lời không làm
    -- câu hỏi kết thúc sớm.

    IF v_elapsed >= v_q.time_limit_seconds THEN
      RETURN jsonb_build_object(
        'status', 'time_up'
      );
    END IF;


  -- ========================================
  -- SELF-PACED
  -- ========================================

  ELSIF v_s.mode = 'self_paced' THEN

    SELECT q.id
    INTO v_expected
    FROM public.quiz_questions q
    WHERE q.quiz_id = v_a.quiz_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.quiz_answers ans
        WHERE ans.attempt_id = v_a.id
          AND ans.question_id = q.id
      )
    ORDER BY q.position, q.id
    LIMIT 1;

    IF v_expected IS DISTINCT
       FROM p_question_id
    THEN
      RETURN jsonb_build_object(
        'status', 'wrong_question'
      );
    END IF;

  ELSE
    RETURN jsonb_build_object(
      'status', 'invalid_mode'
    );
  END IF;


  -- ========================================
  -- ĐẾM NGƯỜI ĐÃ TRẢ LỜI TRƯỚC
  -- ========================================

  IF v_s.mode = 'live'
     AND v_s.auto_play_enabled
  THEN

    -- Xếp tuần tự các lần nộp đáp án
    -- cùng một câu, tránh đếm thiếu
    -- khi nhiều người gửi đồng thời.

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_s.id::TEXT || ':' || v_q.id::TEXT,
        0
      )
    );

    SELECT COUNT(*)::INTEGER
    INTO v_prior_answers
    FROM public.quiz_answers ans
    JOIN public.quiz_attempts a
      ON a.id = ans.attempt_id
    WHERE a.session_id = v_s.id
      AND ans.question_id = v_q.id;

    v_player_total := GREATEST(
      1,
      COALESCE(v_s.scoring_player_count, 1)
    );

    v_crowd_ratio := LEAST(
      1,
      v_prior_answers::NUMERIC / v_player_total
    );

  END IF;


  -- ========================================
  -- CÔNG THỨC CHẤM ĐIỂM
  -- ========================================

  v_correct :=
    p_selected_index = v_q.correct_index;


  IF NOT v_correct THEN

    -- Sai luôn 0 điểm.

    v_points := 0;


  ELSIF v_s.mode = 'live'
        AND v_s.auto_play_enabled
  THEN

    -- Live Auto Play:
    -- Tối đa 1000 điểm.
    -- Tối thiểu 200 điểm nếu đúng hạn.
    --
    -- Giảm theo thời gian còn lại và
    -- số người đã trả lời trước.
    --
    -- Điểm = FLOOR(
    --   1000
    --   * (1 - elapsed / duration)
    --   * (1 - 0.70 * crowd_ratio^2)
    -- )
    --
    -- Giới hạn kết quả trong 200..1000.

    v_points := LEAST(
      1000,
      GREATEST(
        200,
        FLOOR(
          1000

          * GREATEST(
              0,
              1 - v_elapsed / v_q.time_limit_seconds
            )

          * (
              1 - 0.70 * POWER(v_crowd_ratio, 2)
            )
        )::INTEGER
      )
    );

  ELSE

    -- Self-paced và Live phiên cũ:
    -- Giữ cách chấm điểm cũ.

    v_points := v_q.points;

  END IF;


  -- ========================================
  -- LƯU ĐÁP ÁN
  -- ========================================

  INSERT INTO public.quiz_answers (
    quiz_id,
    attempt_id,
    question_id,
    selected_index,
    is_correct,
    points_earned
  )
  VALUES (
    v_a.quiz_id,
    v_a.id,
    p_question_id,
    p_selected_index,
    v_correct,
    v_points
  );


  -- ========================================
  -- CẬP NHẬT ĐIỂM NGƯỜI CHƠI
  -- ========================================

  UPDATE public.quiz_attempts
  SET
    score = score + v_points,
    correct_count = correct_count
      + CASE WHEN v_correct THEN 1 ELSE 0 END
  WHERE id = v_a.id;


  SELECT COUNT(*)::INTEGER
  INTO v_answered
  FROM public.quiz_answers
  WHERE attempt_id = v_a.id;

  SELECT COUNT(*)::INTEGER
  INTO v_total
  FROM public.quiz_questions
  WHERE quiz_id = v_a.quiz_id;


  -- Không tiết lộ đúng/sai hoặc điểm
  -- trước khi công bố đáp án.

  RETURN jsonb_build_object(
    'status', 'ok',
    'answered_count', v_answered,
    'total_questions', v_total
  );

END;
$$;


-- ============================================
-- 4. BẢO MẬT RPC
-- ============================================

REVOKE ALL ON FUNCTION
public.quiz_live_auto_control(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.quiz_live_auto_control(UUID, TEXT)
TO service_role;


REVOKE ALL ON FUNCTION
public.quiz_submit_answer(
  UUID, TEXT, UUID, INTEGER
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.quiz_submit_answer(
  UUID, TEXT, UUID, INTEGER
)
TO service_role;

COMMIT;
