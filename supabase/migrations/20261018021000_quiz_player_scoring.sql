
BEGIN;

-- ==============================================
-- JOINLY QUIZ
-- CHẤM ĐIỂM AN TOÀN PHÍA DATABASE
-- ==============================================

CREATE OR REPLACE FUNCTION public.quiz_submit_answer(
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
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;
  v_question public.quiz_questions%ROWTYPE;

  v_expected_question UUID;
  v_is_correct BOOLEAN;
  v_points INTEGER;
  v_answered INTEGER;
  v_total INTEGER;
BEGIN

  -- 1. Xác thực phiên người chơi.
  -- Khóa dòng để hai request đồng thời
  -- không thể cộng điểm hai lần.

  SELECT *
  INTO v_attempt
  FROM public.quiz_attempts
  WHERE id = p_attempt_id
    AND player_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'invalid_player'
    );
  END IF;

  IF v_attempt.status <> 'in_progress' THEN
    RETURN jsonb_build_object(
      'status', 'already_finished'
    );
  END IF;

  -- 2. Kiểm tra trạng thái phiên chơi.

  SELECT *
  INTO v_session
  FROM public.quiz_sessions
  WHERE id = v_attempt.session_id
    AND quiz_id = v_attempt.quiz_id
  FOR SHARE;

  IF NOT FOUND OR v_session.status <> 'active' THEN
    RETURN jsonb_build_object(
      'status', 'not_active'
    );
  END IF;

  -- 3. Chỉ cho phép trả lời câu hỏi
  -- thuộc đúng bộ Quiz.

  SELECT *
  INTO v_question
  FROM public.quiz_questions
  WHERE id = p_question_id
    AND quiz_id = v_attempt.quiz_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'invalid_question'
    );
  END IF;

  -- 4. Kiểm tra lựa chọn hợp lệ.

  IF p_selected_index IS NULL
     OR p_selected_index < 0
     OR p_selected_index >=
        jsonb_array_length(v_question.options)
  THEN
    RETURN jsonb_build_object(
      'status', 'invalid_choice'
    );
  END IF;

  -- 5. Chặn gửi cùng câu hỏi nhiều lần.

  IF EXISTS (
    SELECT 1
    FROM public.quiz_answers
    WHERE attempt_id = v_attempt.id
      AND question_id = p_question_id
  ) THEN
    RETURN jsonb_build_object(
      'status', 'already_answered'
    );
  END IF;

  -- ==========================================
  -- LIVE QUIZ
  -- Chỉ được trả lời câu BTC đang mở.
  -- ==========================================

  IF v_session.mode = 'live' THEN

    SELECT id
    INTO v_expected_question
    FROM public.quiz_questions
    WHERE quiz_id = v_attempt.quiz_id
    ORDER BY position, id
    OFFSET v_session.current_question
    LIMIT 1;

    IF v_expected_question IS DISTINCT
       FROM p_question_id THEN

      RETURN jsonb_build_object(
        'status', 'wrong_question'
      );

    END IF;

    -- BTC phải thực sự bắt đầu câu hỏi.

    IF v_session.question_started_at IS NULL THEN
      RETURN jsonb_build_object(
        'status', 'not_started'
      );
    END IF;

    -- Kiểm tra thời gian bằng đồng hồ server.
    -- Không tin đồng hồ từ điện thoại.

    IF statement_timestamp() >
       v_session.question_started_at
       + (
           v_question.time_limit_seconds
           * INTERVAL '1 second'
         )
    THEN
      RETURN jsonb_build_object(
        'status', 'time_up'
      );
    END IF;

  -- ==========================================
  -- SELF-PACED QUIZ
  -- Người chơi trả lời tuần tự.
  -- ==========================================

  ELSIF v_session.mode = 'self_paced' THEN

    SELECT q.id
    INTO v_expected_question
    FROM public.quiz_questions q
    WHERE q.quiz_id = v_attempt.quiz_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.quiz_answers a
        WHERE a.attempt_id = v_attempt.id
          AND a.question_id = q.id
      )
    ORDER BY q.position, q.id
    LIMIT 1;

    IF v_expected_question IS DISTINCT
       FROM p_question_id THEN

      RETURN jsonb_build_object(
        'status', 'wrong_question'
      );

    END IF;

  ELSE
    RETURN jsonb_build_object(
      'status', 'invalid_mode'
    );
  END IF;

  -- ==========================================
  -- 6. CHẤM ĐIỂM PHÍA DATABASE
  -- ==========================================

  v_is_correct :=
    p_selected_index = v_question.correct_index;

  v_points :=
    CASE
      WHEN v_is_correct THEN v_question.points
      ELSE 0
    END;

  -- 7. Lưu câu trả lời.

  INSERT INTO public.quiz_answers (
    quiz_id,
    attempt_id,
    question_id,
    selected_index,
    is_correct,
    points_earned
  )
  VALUES (
    v_attempt.quiz_id,
    v_attempt.id,
    p_question_id,
    p_selected_index,
    v_is_correct,
    v_points
  );

  -- 8. Cộng điểm.
  -- Vì toàn bộ chạy trong một transaction,
  -- không lưu được đáp án thì không cộng điểm.

  UPDATE public.quiz_attempts
  SET
    score = score + v_points,
    correct_count = correct_count +
      CASE WHEN v_is_correct THEN 1 ELSE 0 END
  WHERE id = v_attempt.id;

  -- 9. Đếm tiến độ làm bài.

  SELECT COUNT(*)
  INTO v_answered
  FROM public.quiz_answers
  WHERE attempt_id = v_attempt.id;

  SELECT COUNT(*)
  INTO v_total
  FROM public.quiz_questions
  WHERE quiz_id = v_attempt.quiz_id;

  -- Không trả đáp án đúng hoặc điểm ngay.
  -- Chỉ trả trạng thái đã lưu thành công.

  RETURN jsonb_build_object(
    'status', 'ok',
    'answered_count', v_answered,
    'total_questions', v_total
  );

END;
$$;


-- ==============================================
-- HOÀN THÀNH QUIZ VÀ LẤY KẾT QUẢ
-- ==============================================

CREATE OR REPLACE FUNCTION public.quiz_finish_attempt(
  p_attempt_id UUID,
  p_token_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_attempt public.quiz_attempts%ROWTYPE;
  v_session public.quiz_sessions%ROWTYPE;

  v_total INTEGER;
  v_answered INTEGER;
BEGIN

  -- 1. Xác thực người chơi.

  SELECT *
  INTO v_attempt
  FROM public.quiz_attempts
  WHERE id = p_attempt_id
    AND player_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'invalid_player'
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.quiz_sessions
  WHERE id = v_attempt.session_id
    AND quiz_id = v_attempt.quiz_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'status', 'invalid_session'
    );
  END IF;

  -- 2. Kiểm tra điều kiện hoàn thành.

  IF v_attempt.status <> 'submitted' THEN

    IF v_session.mode = 'self_paced' THEN

      IF v_session.status <> 'active' THEN
        RETURN jsonb_build_object(
          'status', 'not_active'
        );
      END IF;

      SELECT COUNT(*)
      INTO v_total
      FROM public.quiz_questions
      WHERE quiz_id = v_attempt.quiz_id;

      SELECT COUNT(*)
      INTO v_answered
      FROM public.quiz_answers
      WHERE attempt_id = v_attempt.id;

      IF v_answered < v_total THEN
        RETURN jsonb_build_object(
          'status', 'incomplete',
          'answered_count', v_answered,
          'total_questions', v_total
        );
      END IF;

    ELSIF v_session.mode = 'live' THEN

      -- Live Quiz chỉ được xem kết quả
      -- khi BTC kết thúc phiên chơi.

      IF v_session.status <> 'finished' THEN
        RETURN jsonb_build_object(
          'status', 'not_finished'
        );
      END IF;

    ELSE
      RETURN jsonb_build_object(
        'status', 'invalid_mode'
      );
    END IF;

    -- 3. Đánh dấu hoàn thành.

    UPDATE public.quiz_attempts
    SET
      status = 'submitted',
      completed_at = statement_timestamp()
    WHERE id = v_attempt.id;

  END IF;

  -- 4. Trả kết quả cuối cùng.

  SELECT COUNT(*)
  INTO v_total
  FROM public.quiz_questions
  WHERE quiz_id = v_attempt.quiz_id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'score', v_attempt.score,
    'correct_count', v_attempt.correct_count,
    'total_questions', v_total
  );

END;
$$;


-- ==============================================
-- BẢO MẬT RPC
-- Chỉ server sử dụng service_role được gọi.
-- Không cho browser gọi SQL trực tiếp.
-- ==============================================

REVOKE EXECUTE ON FUNCTION
  public.quiz_submit_answer(UUID, TEXT, UUID, INTEGER)
FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION
  public.quiz_finish_attempt(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.quiz_submit_answer(UUID, TEXT, UUID, INTEGER)
TO service_role;

GRANT EXECUTE ON FUNCTION
  public.quiz_finish_attempt(UUID, TEXT)
TO service_role;

COMMIT;
