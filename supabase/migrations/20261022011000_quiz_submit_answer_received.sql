-- JOINLY - Production Quiz RPC
-- Synced from Supabase 2026-10-22
-- Original hash: 9068cdf95a703174bf1f76c9a4bd8b49

BEGIN;

CREATE OR REPLACE FUNCTION public.quiz_submit_answer_received(p_attempt_id uuid, p_token_hash text, p_question_id uuid, p_selected_index integer, p_received_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_a public.quiz_attempts%ROWTYPE;
  v_s public.quiz_sessions%ROWTYPE;
  v_q public.quiz_questions%ROWTYPE;

  v_expected UUID;
  v_elapsed NUMERIC;
  v_correct BOOLEAN;
  v_points INTEGER;

  v_prior_answers INTEGER := 0;
  v_player_total INTEGER := 1;
  v_crowd_ratio NUMERIC := 0;

  v_answered INTEGER;
  v_total INTEGER;
BEGIN

  -- 1. Kiểm tra thời điểm nhận từ server.
  -- Không lấy thời gian trực tiếp từ thiết bị người chơi.

  IF p_received_at IS NULL
     OR p_received_at > clock_timestamp() + INTERVAL '5 seconds'
     OR p_received_at < clock_timestamp() - INTERVAL '90 seconds'
  THEN
    RETURN jsonb_build_object('status', 'invalid_time');
  END IF;

  -- 2. Xác thực người chơi và khóa attempt.
  -- Ngăn hai request đồng thời cộng điểm hai lần.

  SELECT *
  INTO v_a
  FROM public.quiz_attempts
  WHERE id = p_attempt_id
    AND player_token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_player');
  END IF;

  IF v_a.status <> 'in_progress' THEN
    RETURN jsonb_build_object('status', 'already_finished');
  END IF;

  -- 3. Kiểm tra phiên Quiz.

  SELECT *
  INTO v_s
  FROM public.quiz_sessions
  WHERE id = v_a.session_id
    AND quiz_id = v_a.quiz_id
  FOR SHARE;

  IF NOT FOUND OR v_s.status <> 'active' THEN
    RETURN jsonb_build_object('status', 'not_active');
  END IF;

  -- 4. Kiểm tra câu hỏi.

  SELECT *
  INTO v_q
  FROM public.quiz_questions
  WHERE id = p_question_id
    AND quiz_id = v_a.quiz_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_question');
  END IF;

  IF p_selected_index IS NULL
     OR p_selected_index < 0
     OR p_selected_index >= jsonb_array_length(v_q.options)
  THEN
    RETURN jsonb_build_object('status', 'invalid_choice');
  END IF;

  -- Không cho trả lời cùng câu hai lần.

  IF EXISTS (
    SELECT 1
    FROM public.quiz_answers
    WHERE attempt_id = v_a.id
      AND question_id = p_question_id
  ) THEN
    RETURN jsonb_build_object('status', 'already_answered');
  END IF;

  -- 5. Kiểm tra tiến độ và thời gian.

  IF v_s.mode = 'live' THEN

    SELECT id
    INTO v_expected
    FROM public.quiz_questions
    WHERE quiz_id = v_a.quiz_id
    ORDER BY position, id
    OFFSET v_s.current_question
    LIMIT 1;

    IF v_expected IS DISTINCT FROM p_question_id THEN
      RETURN jsonb_build_object('status', 'wrong_question');
    END IF;

    IF v_s.question_started_at IS NULL THEN
      RETURN jsonb_build_object('status', 'not_started');
    END IF;

    IF v_s.results_revealed
       OR (
         v_s.auto_play_enabled
         AND v_s.live_phase <> 'question'
       )
    THEN
      RETURN jsonb_build_object('status', 'time_up');
    END IF;

    -- Tính từ lúc SERVER mở câu hỏi
    -- đến lúc SERVER nhận yêu cầu trả lời.

    v_elapsed := EXTRACT(
      EPOCH FROM (p_received_at - v_s.question_started_at)
    );

    IF v_elapsed < 0 THEN
      RETURN jsonb_build_object('status', 'not_started');
    END IF;

    IF v_elapsed >= v_q.time_limit_seconds THEN
      RETURN jsonb_build_object('status', 'time_up');
    END IF;

  ELSIF v_s.mode = 'self_paced' THEN

    -- Mỗi người chơi có tiến độ riêng.

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

    IF v_expected IS DISTINCT FROM p_question_id THEN
      RETURN jsonb_build_object('status', 'wrong_question');
    END IF;

  ELSE
    RETURN jsonb_build_object('status', 'invalid_mode');
  END IF;

  -- 6. Đếm số người trả lời trước.
  -- Giữ nguyên cơ chế tính điểm theo thứ tự.
  -- Cửa sổ 0,5 giây không bị ảnh hưởng bởi số này.

  IF v_s.mode = 'live'
     AND v_s.auto_play_enabled
  THEN

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

  -- 7. Chấm điểm.

  v_correct := p_selected_index = v_q.correct_index;

  IF NOT v_correct THEN

    v_points := 0;

  ELSIF v_s.mode = 'live'
        AND v_s.auto_play_enabled
        AND v_elapsed <= 0.5
  THEN

    -- Mọi đáp án đúng trong 0,5 giây đầu
    -- đều nhận chính xác 1000 điểm.

    v_points := 1000;

  ELSIF v_s.mode = 'live'
        AND v_s.auto_play_enabled
  THEN

    -- Sau 0,5 giây, điểm giảm theo:
    -- 1. Thời gian trả lời
    -- 2. Tỷ lệ người đã trả lời trước
    -- Giới hạn 200 - 1000 điểm.

    v_points := LEAST(
      1000,
      GREATEST(
        200,
        FLOOR(
          1000
          * GREATEST(
              0,
              1 - GREATEST(0, v_elapsed - 0.5)
                  / v_q.time_limit_seconds
            )
          * (
              1 - 0.70 * POWER(v_crowd_ratio, 2)
            )
        )::INTEGER
      )
    );

  ELSE

    -- Self-paced và Live không bật Auto Play:
    -- giữ điểm được cấu hình trong câu hỏi.

    v_points := v_q.points;

  END IF;

  -- 8. Lưu đáp án.

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

  -- 9. Cập nhật tổng điểm.

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

  -- Không tiết lộ đúng/sai và điểm trước Reveal.

  RETURN jsonb_build_object(
    'status', 'ok',
    'answered_count', v_answered,
    'total_questions', v_total
  );

END;
$function$;

REVOKE ALL ON FUNCTION public.quiz_submit_answer_received(uuid, text, uuid, integer, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.quiz_submit_answer_received(uuid, text, uuid, integer, timestamptz) TO service_role;

COMMIT;