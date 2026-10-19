
BEGIN;

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

  -- Khóa phiên để tránh hai Host
  -- thay đổi trạng thái cùng lúc.

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


  -- ===================================
  -- BẮT ĐẦU LIVE QUIZ
  -- ===================================

  IF p_action = 'start' THEN

    IF v_s.status <> 'waiting' THEN
      RAISE EXCEPTION
        'Phiên không ở phòng chờ.';
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


  -- ===================================
  -- TẠM DỪNG
  -- ===================================

  ELSIF p_action = 'pause' THEN

    IF NOT v_s.auto_play_enabled
       OR v_s.status <> 'active'
    THEN
      RAISE EXCEPTION
        'Không thể tạm dừng.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'paused',
      paused_at = v_now
    WHERE id = p_session_id
    RETURNING * INTO v_s;


  -- ===================================
  -- TIẾP TỤC
  -- ===================================

  ELSIF p_action = 'resume' THEN

    IF NOT v_s.auto_play_enabled
       OR v_s.status <> 'paused'
       OR v_s.paused_at IS NULL
    THEN
      RAISE EXCEPTION
        'Phiên chưa được tạm dừng.';
    END IF;

    -- Giữ lại thời gian còn lại.
    -- Điểm không giảm khi đang Pause.

    UPDATE public.quiz_sessions
    SET
      status = 'active',

      phase_started_at =
        phase_started_at + (v_now - paused_at),

      question_started_at =
        question_started_at + (v_now - paused_at),

      paused_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_s;


  -- ===================================
  -- TỰ CHUYỂN / BỎ QUA
  -- ===================================

  ELSIF p_action IN ('tick', 'skip') THEN

    IF p_action = 'skip'
       AND (
         NOT v_s.auto_play_enabled
         OR v_s.status <> 'active'
       )
    THEN
      RAISE EXCEPTION
        'Không thể Skip lúc này.';
    END IF;

    IF v_s.auto_play_enabled
       AND v_s.status = 'active'
    THEN

      FOR v_i IN 1..(v_total * 3 + 3) LOOP

        EXIT WHEN v_s.status <> 'active';

        EXIT WHEN v_s.live_phase NOT IN (
          'question',
          'reveal',
          'leaderboard'
        );

        IF v_s.phase_started_at IS NULL THEN
          RAISE EXCEPTION
            'Thiếu mốc thời gian giai đoạn.';
        END IF;


        -- Xác định thời gian giai đoạn.

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


        -- ===================================
        -- SKIP KHI CÂU CHƯA HẾT GIỜ
        -- ===================================

        IF p_action = 'skip'
           AND v_s.live_phase = 'question'
           AND v_now < v_deadline
        THEN

          -- Không cho kết thúc câu cuối sớm,
          -- vì bảng điểm có thể làm lộ kết quả.

          IF v_s.current_question + 1 >= v_total THEN
            RAISE EXCEPTION
              'Câu cuối cần chờ hết giờ trước khi Skip.';
          END IF;

          -- Chuyển thẳng câu mới.
          -- Không hiện đáp án câu bị bỏ qua.

          UPDATE public.quiz_sessions
          SET
            current_question =
              current_question + 1,

            live_phase = 'question',

            phase_started_at = v_now,
            question_started_at = v_now,

            results_revealed = FALSE,
            revealed_at = NULL
          WHERE id = p_session_id
          RETURNING * INTO v_s;

          EXIT;
        END IF;


        -- ===================================
        -- AUTO PLAY THÔNG THƯỜNG
        -- ===================================

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


        -- ===================================
        -- QUESTION -> REVEAL
        -- ===================================

        IF v_s.live_phase = 'question' THEN

          -- Chỉ đến đây khi đã hết giờ.

          UPDATE public.quiz_sessions
          SET
            live_phase = 'reveal',
            phase_started_at = v_transition,
            results_revealed = TRUE,
            revealed_at = v_transition
          WHERE id = p_session_id
          RETURNING * INTO v_s;


        -- ===================================
        -- REVEAL -> LEADERBOARD
        -- ===================================

        ELSIF v_s.live_phase = 'reveal' THEN

          UPDATE public.quiz_sessions
          SET
            live_phase = 'leaderboard',
            phase_started_at = v_transition
          WHERE id = p_session_id
          RETURNING * INTO v_s;


        -- ===================================
        -- LEADERBOARD -> NEXT / FINISH
        -- ===================================

        ELSIF v_s.live_phase = 'leaderboard' THEN

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
              current_question =
                current_question + 1,

              live_phase = 'question',

              phase_started_at = v_transition,
              question_started_at = v_transition,

              results_revealed = FALSE,
              revealed_at = NULL
            WHERE id = p_session_id
            RETURNING * INTO v_s;

          END IF;

        END IF;

        -- Skip chỉ chuyển một giai đoạn.
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
    'question_started_at',
      v_s.question_started_at,
    'results_revealed',
      v_s.results_revealed,
    'server_now', clock_timestamp()
  );

END;
$$;


-- Chỉ backend service_role được gọi RPC.

REVOKE ALL ON FUNCTION
public.quiz_live_auto_control(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.quiz_live_auto_control(UUID, TEXT)
TO service_role;

COMMIT;
