
BEGIN;

-- ============================================
-- JOINLY LIVE QUIZ
-- ĐỒNG BỘ CÔNG BỐ KẾT QUẢ
-- ============================================

-- 1. Lưu trạng thái công bố đáp án.

ALTER TABLE public.quiz_sessions
ADD COLUMN IF NOT EXISTS results_revealed
BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.quiz_sessions
ADD COLUMN IF NOT EXISTS revealed_at
TIMESTAMPTZ;


-- ============================================
-- 2. CẬP NHẬT HÀM ĐIỀU KHIỂN HOST
-- ============================================

CREATE OR REPLACE FUNCTION public.quiz_host_control(
  p_session_id UUID,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_session public.quiz_sessions%ROWTYPE;
  v_total INTEGER;
  v_seconds INTEGER;
  v_now TIMESTAMPTZ;
BEGIN

  IF p_action IS NULL OR p_action NOT IN (
    'start',
    'next',
    'pause',
    'resume',
    'reveal',
    'finish',
    'close'
  ) THEN
    RAISE EXCEPTION
      'Thao tác Live Quiz không hợp lệ.';
  END IF;

  -- Khóa phiên tránh hai Host thao tác đồng thời.

  SELECT *
  INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'Không tìm thấy phiên Quiz.';
  END IF;

  IF v_session.mode <> 'live' THEN
    RAISE EXCEPTION
      'Đây không phải phiên Live Quiz.';
  END IF;

  v_now := clock_timestamp();

  SELECT COUNT(*)::INTEGER
  INTO v_total
  FROM public.quiz_questions
  WHERE quiz_id = v_session.quiz_id;


  -- ==========================================
  -- START
  -- ==========================================

  IF p_action = 'start' THEN

    IF v_session.status <> 'waiting' THEN
      RAISE EXCEPTION
        'Quiz không còn ở phòng chờ.';
    END IF;

    IF v_total = 0 THEN
      RAISE EXCEPTION
        'Quiz chưa có câu hỏi.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'active',
      current_question = 0,
      question_started_at = v_now,
      started_at = COALESCE(started_at, v_now),
      paused_at = NULL,
      results_revealed = FALSE,
      revealed_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;


  -- ==========================================
  -- REVEAL
  -- CÔNG BỐ ĐÁP ÁN ĐÚNG
  -- ==========================================

  ELSIF p_action = 'reveal' THEN

    IF v_session.status <> 'active' THEN
      RAISE EXCEPTION
        'Quiz phải đang chạy để công bố đáp án.';
    END IF;

    -- Lấy thời gian câu hỏi hiện tại.

    SELECT time_limit_seconds
    INTO v_seconds
    FROM public.quiz_questions
    WHERE quiz_id = v_session.quiz_id
    ORDER BY position, id
    LIMIT 1
    OFFSET v_session.current_question;

    IF NOT FOUND
       OR v_session.question_started_at IS NULL
    THEN
      RAISE EXCEPTION
        'Không tìm thấy câu hỏi đang chạy.';
    END IF;

    -- Chỉ được công bố sau khi hết giờ.
    -- Sử dụng đồng hồ database.

    IF v_now <
       v_session.question_started_at
       + v_seconds * INTERVAL '1 second'
    THEN
      RAISE EXCEPTION
        'Chưa hết thời gian trả lời.';
    END IF;

    -- Nếu đã công bố thì giữ nguyên kết quả.
    -- Không tạo một lần công bố mới.

    IF NOT v_session.results_revealed THEN

      UPDATE public.quiz_sessions
      SET
        results_revealed = TRUE,
        revealed_at = v_now
      WHERE id = p_session_id
      RETURNING * INTO v_session;

    END IF;


  -- ==========================================
  -- NEXT
  -- CHUYỂN CÂU TIẾP THEO
  -- ==========================================

  ELSIF p_action = 'next' THEN

    IF v_session.status <> 'active' THEN
      RAISE EXCEPTION
        'Quiz phải đang chạy để chuyển câu.';
    END IF;

    -- Không cho BTC bỏ qua phần công bố.

    IF NOT v_session.results_revealed THEN
      RAISE EXCEPTION
        'Hãy công bố kết quả câu hiện tại trước.';
    END IF;

    IF v_session.current_question + 1 >= v_total THEN
      RAISE EXCEPTION
        'Đã đến câu cuối. Hãy kết thúc Quiz.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      current_question = current_question + 1,
      question_started_at = v_now,
      paused_at = NULL,
      results_revealed = FALSE,
      revealed_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;


  -- ==========================================
  -- PAUSE
  -- ==========================================

  ELSIF p_action = 'pause' THEN

    IF v_session.status <> 'active' THEN
      RAISE EXCEPTION
        'Quiz không ở trạng thái đang chạy.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'paused',
      paused_at = v_now
    WHERE id = p_session_id
    RETURNING * INTO v_session;


  -- ==========================================
  -- RESUME
  -- ==========================================

  ELSIF p_action = 'resume' THEN

    IF v_session.status <> 'paused'
       OR v_session.paused_at IS NULL
    THEN
      RAISE EXCEPTION
        'Quiz không ở trạng thái tạm dừng.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'active',

      -- Bảo toàn thời gian còn lại.
      question_started_at =
        question_started_at +
        (v_now - paused_at),

      paused_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;


  -- ==========================================
  -- FINISH
  -- ==========================================

  ELSIF p_action = 'finish' THEN

    IF v_session.status NOT IN ('active', 'paused') THEN
      RAISE EXCEPTION
        'Không thể kết thúc phiên này.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'finished',
      finished_at = v_now,
      paused_at = NULL,
      results_revealed = TRUE,
      revealed_at = COALESCE(revealed_at, v_now)
    WHERE id = p_session_id
    RETURNING * INTO v_session;


  -- ==========================================
  -- CLOSE
  -- ==========================================

  ELSIF p_action = 'close' THEN

    IF v_session.status <> 'waiting' THEN
      RAISE EXCEPTION
        'Chỉ được hủy phòng đang chờ.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'closed',
      finished_at = v_now,
      paused_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;

  END IF;


  -- ==========================================
  -- KẾT QUẢ TRẢ VỀ
  -- ==========================================

  RETURN jsonb_build_object(
    'ok', TRUE,
    'session_id', v_session.id,
    'status', v_session.status,
    'current_question', v_session.current_question,
    'total_questions', v_total,
    'question_started_at',
      v_session.question_started_at,
    'results_revealed',
      v_session.results_revealed,
    'revealed_at', v_session.revealed_at,
    'started_at', v_session.started_at,
    'finished_at', v_session.finished_at
  );

END;
$$;


-- ============================================
-- 3. KHÔNG CHO GHI ĐÁP ÁN SAU KHI CÔNG BỐ
-- Áp dụng ngay cả khi request xảy ra đồng thời.
-- ============================================

CREATE OR REPLACE FUNCTION
public.quiz_reject_answers_after_reveal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_mode TEXT;
  v_revealed BOOLEAN;
BEGIN

  SELECT
    s.mode,
    s.results_revealed
  INTO
    v_mode,
    v_revealed
  FROM public.quiz_attempts a
  JOIN public.quiz_sessions s
    ON s.id = a.session_id
  WHERE a.id = NEW.attempt_id
  FOR SHARE OF s;

  IF v_mode = 'live'
     AND v_revealed IS TRUE
  THEN
    RAISE EXCEPTION
      'Câu hỏi đã công bố kết quả.';
  END IF;

  RETURN NEW;

END;
$$;


DROP TRIGGER IF EXISTS
quiz_block_revealed_answers
ON public.quiz_answers;

CREATE TRIGGER quiz_block_revealed_answers
BEFORE INSERT ON public.quiz_answers
FOR EACH ROW
EXECUTE FUNCTION
public.quiz_reject_answers_after_reveal();


-- ============================================
-- 4. QUYỀN THỰC THI
-- ============================================

REVOKE ALL ON FUNCTION
public.quiz_host_control(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
public.quiz_host_control(UUID, TEXT)
TO service_role;

COMMIT;
