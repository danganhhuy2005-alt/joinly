
BEGIN;

-- ============================================
-- JOINLY LIVE QUIZ
-- INTRO 5S + EARLY REVEAL + DIRECT SKIP
-- ============================================

-- 1. CHO PHÉP GIAI ĐOẠN INTRO

ALTER TABLE public.quiz_sessions
DROP CONSTRAINT IF EXISTS
  quiz_sessions_live_phase_check;

ALTER TABLE public.quiz_sessions
ADD CONSTRAINT quiz_sessions_live_phase_check
CHECK (
  live_phase IN (
    'lobby',
    'intro',
    'question',
    'reveal',
    'leaderboard',
    'finished'
  )
);


-- ============================================
-- 2. AUTO LIVE CONTROLLER
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
  v_answered INTEGER;
  v_duration INTEGER;
  v_required_players INTEGER;

  v_question_id UUID;
  v_i INTEGER;
BEGIN

  -- ========================================
  -- VALIDATE ACTION
  -- ========================================

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


  -- Khóa phiên trong toàn bộ transaction.
  -- Tránh hai thiết bị chuyển câu cùng lúc.

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
  -- START -> INTRO
  -- ========================================

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
      live_phase = 'intro',

      current_question = 0,

      started_at = COALESCE(
        started_at,
        v_now
      ),

      phase_started_at = v_now,

      -- Chưa tính giờ trả lời.
      question_started_at = NULL,

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
        'Không thể tạm dừng.';
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
        'Phiên chưa được tạm dừng.';
    END IF;

    -- Dời mốc thời gian theo đúng
    -- khoảng thời gian đã Pause.

    UPDATE public.quiz_sessions
    SET
      status = 'active',

      phase_started_at =
        phase_started_at
        + (v_now - paused_at),

      question_started_at =
        CASE
          WHEN question_started_at IS NULL
            THEN NULL
          ELSE
            question_started_at
            + (v_now - paused_at)
        END,

      paused_at = NULL

    WHERE id = p_session_id
    RETURNING * INTO v_s;


  -- ========================================
  -- SKIP -> CÂU KẾ TIẾP
  -- ========================================

  ELSIF p_action = 'skip' THEN

    IF NOT v_s.auto_play_enabled
       OR v_s.status <> 'active'
    THEN
      RAISE EXCEPTION
        'Không thể Skip lúc này.';
    END IF;

    -- Câu cuối: kết thúc phiên.
    -- Không công bố đáp án câu bị Skip.

    IF v_s.current_question + 1 >= v_total THEN

      UPDATE public.quiz_sessions
      SET
        status = 'finished',
        live_phase = 'finished',

        finished_at = v_now,
        phase_started_at = v_now,

        results_revealed = FALSE,
        revealed_at = NULL,

        paused_at = NULL

      WHERE id = p_session_id
      RETURNING * INTO v_s;

    ELSE

      -- Câu 1 -> Intro câu 2.
      -- Bỏ qua Reveal và Leaderboard.

      UPDATE public.quiz_sessions
      SET
        current_question =
          current_question + 1,

        live_phase = 'intro',

        phase_started_at = v_now,
        question_started_at = NULL,

        results_revealed = FALSE,
        revealed_at = NULL

      WHERE id = p_session_id
      RETURNING * INTO v_s;

    END IF;


  -- ========================================
  -- TICK: TỰ ĐỒNG BỘ GIAI ĐOẠN
  -- ========================================

  ELSIF p_action = 'tick' THEN

    IF v_s.auto_play_enabled
       AND v_s.status = 'active'
    THEN

      -- Có thể phải chuyển nhiều giai đoạn
      -- khi trình duyệt tạm mất kết nối.

      FOR v_i IN 1..(v_total * 4 + 4) LOOP

        EXIT WHEN v_s.status <> 'active';

        EXIT WHEN v_s.live_phase NOT IN (
          'intro',
          'question',
          'reveal',
          'leaderboard'
        );

        IF v_s.phase_started_at IS NULL THEN
          RAISE EXCEPTION
            'Thiếu mốc thời gian giai đoạn.';
        END IF;


        -- ==================================
        -- XÁC ĐỊNH THỜI GIAN GIAI ĐOẠN
        -- ==================================

        IF v_s.live_phase = 'intro' THEN

          v_duration := 5;


        ELSIF v_s.live_phase = 'question' THEN

          SELECT id, time_limit_seconds
          INTO v_question_id, v_duration
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

          v_duration :=
            v_s.leaderboard_seconds;

        END IF;


        v_deadline :=
          v_s.phase_started_at
          + v_duration * INTERVAL '1 second';


        -- ==================================
        -- CHƯA HẾT THỜI GIAN
        -- ==================================

        IF v_now < v_deadline THEN

          -- Chỉ QUESTION được kết thúc sớm.
          -- INTRO luôn phải đủ 5 giây.

          IF v_s.live_phase <> 'question' THEN
            EXIT;
          END IF;


          -- Đếm số người đã trả lời câu này.
          -- Chỉ đếm thuộc đúng session.

          SELECT COUNT(
            DISTINCT a.id
          )::INTEGER
          INTO v_answered
          FROM public.quiz_answers ans
          JOIN public.quiz_attempts a
            ON a.id = ans.attempt_id
          WHERE a.session_id = p_session_id
            AND ans.question_id = v_question_id;


          -- Số người chơi cố định lúc Start.
          -- Tránh người mới làm thay đổi mốc
          -- hoàn tất của câu đang chơi.

          IF v_s.scoring_player_count IS NOT NULL THEN

            v_required_players :=
              v_s.scoring_player_count;

          ELSE

            SELECT COUNT(*)::INTEGER
            INTO v_required_players
            FROM public.quiz_attempts
            WHERE session_id = p_session_id;

          END IF;

          v_required_players :=
            GREATEST(1, v_required_players);


          -- Vẫn còn người chưa trả lời.
          -- Tiếp tục đếm ngược bình thường.

          IF v_answered < v_required_players THEN
            EXIT;
          END IF;


          -- Tất cả đã trả lời.
          -- Công bố ngay tại thời điểm server.

          v_transition := v_now;

        ELSE

          -- Hết giờ bình thường.
          -- Dùng deadline gốc để các thiết bị
          -- có cùng mốc chuyển giai đoạn.

          v_transition := v_deadline;

        END IF;


        -- ==================================
        -- INTRO -> QUESTION
        -- ==================================

        IF v_s.live_phase = 'intro' THEN

          UPDATE public.quiz_sessions
          SET
            live_phase = 'question',

            phase_started_at = v_transition,

            -- Chỉ bắt đầu tính giờ tại đây.
            question_started_at = v_transition,

            results_revealed = FALSE,
            revealed_at = NULL

          WHERE id = p_session_id
          RETURNING * INTO v_s;


        -- ==================================
        -- QUESTION -> REVEAL
        -- ==================================

        ELSIF v_s.live_phase = 'question' THEN

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

              live_phase = 'intro',

              phase_started_at = v_transition,

              -- Câu mới chưa bắt đầu tính giờ.
              question_started_at = NULL,

              results_revealed = FALSE,
              revealed_at = NULL

            WHERE id = p_session_id
            RETURNING * INTO v_s;

          END IF;

        END IF;

      END LOOP;

    END IF;

  END IF;


  -- ========================================
  -- RETURN TRẠNG THÁI MỚI
  -- ========================================

  RETURN jsonb_build_object(
    'ok', TRUE,

    'session_id', v_s.id,

    'status', v_s.status,

    'live_phase', v_s.live_phase,

    'current_question',
      v_s.current_question,

    'total_questions', v_total,

    'phase_started_at',
      v_s.phase_started_at,

    'question_started_at',
      v_s.question_started_at,

    'results_revealed',
      v_s.results_revealed,

    'server_now',
      clock_timestamp()
  );

END;
$$;


-- ============================================
-- 3. BẢO MẬT RPC
-- ============================================

REVOKE ALL ON FUNCTION
public.quiz_live_auto_control(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.quiz_live_auto_control(UUID, TEXT)
TO service_role;

COMMIT;
