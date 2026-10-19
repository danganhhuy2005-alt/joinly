
BEGIN;

-- ==============================================
-- JOINLY LIVE QUIZ
-- HOST CONTROL: START / NEXT / PAUSE /
-- RESUME / FINISH / CLOSE
-- ==============================================

-- Lưu thời điểm BTC tạm dừng.
-- Khi tiếp tục, thời điểm bắt đầu câu hỏi
-- được dịch chuyển để giữ nguyên thời gian còn lại.

ALTER TABLE public.quiz_sessions
ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;


-- ==============================================
-- HÀM ĐIỀU KHIỂN LIVE QUIZ
-- Chỉ server service_role được gọi.
-- ==============================================

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
  v_now TIMESTAMPTZ;
BEGIN

  -- 1. Chỉ chấp nhận các thao tác hợp lệ.

  IF p_action IS NULL OR p_action NOT IN (
    'start',
    'next',
    'pause',
    'resume',
    'finish',
    'close'
  ) THEN
    RAISE EXCEPTION 'Thao tác Live Quiz không hợp lệ.';
  END IF;

  -- 2. Khóa phiên để tránh hai Host
  -- chuyển câu hoặc thay đổi trạng thái cùng lúc.

  SELECT *
  INTO v_session
  FROM public.quiz_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy phiên Quiz.';
  END IF;

  IF v_session.mode <> 'live' THEN
    RAISE EXCEPTION
      'Chỉ hỗ trợ điều khiển Live Quiz.';
  END IF;

  -- Lấy thời gian sau khi đã khóa phiên.
  v_now := clock_timestamp();

  SELECT COUNT(*)::INTEGER
  INTO v_total
  FROM public.quiz_questions
  WHERE quiz_id = v_session.quiz_id;

  -- ==========================================
  -- START: BẮT ĐẦU LIVE QUIZ
  -- ==========================================

  IF p_action = 'start' THEN

    IF v_session.status <> 'waiting' THEN
      RAISE EXCEPTION
        'Chỉ có thể bắt đầu từ phòng chờ.';
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
      paused_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;

  -- ==========================================
  -- NEXT: CHUYỂN CÂU TIẾP THEO
  -- ==========================================

  ELSIF p_action = 'next' THEN

    IF v_session.status <> 'active' THEN
      RAISE EXCEPTION
        'Quiz phải đang chạy để chuyển câu.';
    END IF;

    IF v_session.current_question + 1 >= v_total THEN
      RAISE EXCEPTION
        'Đã đến câu cuối. Hãy kết thúc Quiz.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      current_question = current_question + 1,
      question_started_at = v_now,
      paused_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;

  -- ==========================================
  -- PAUSE: TẠM DỪNG
  -- ==========================================

  ELSIF p_action = 'pause' THEN

    IF v_session.status <> 'active' THEN
      RAISE EXCEPTION
        'Chỉ có thể tạm dừng Quiz đang chạy.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'paused',
      paused_at = v_now
    WHERE id = p_session_id
    RETURNING * INTO v_session;

  -- ==========================================
  -- RESUME: TIẾP TỤC
  -- ==========================================

  ELSIF p_action = 'resume' THEN

    IF v_session.status <> 'paused'
       OR v_session.paused_at IS NULL THEN
      RAISE EXCEPTION
        'Quiz không ở trạng thái tạm dừng.';
    END IF;

    -- Dịch thời gian bắt đầu câu hỏi
    -- theo đúng thời gian đã tạm dừng.
    -- Ví dụ còn 12 giây thì vẫn còn 12 giây
    -- khi BTC bấm Tiếp tục.

    UPDATE public.quiz_sessions
    SET
      status = 'active',
      question_started_at =
        question_started_at +
        (v_now - paused_at),
      paused_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;

  -- ==========================================
  -- FINISH: KẾT THÚC TRẬN ĐẤU
  -- ==========================================

  ELSIF p_action = 'finish' THEN

    IF v_session.status NOT IN (
      'active',
      'paused'
    ) THEN
      RAISE EXCEPTION
        'Quiz chưa chạy hoặc đã kết thúc.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'finished',
      finished_at = v_now,
      paused_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;

  -- ==========================================
  -- CLOSE: HỦY PHÒNG CHỜ
  -- ==========================================

  ELSIF p_action = 'close' THEN

    IF v_session.status <> 'waiting' THEN
      RAISE EXCEPTION
        'Chỉ có thể hủy phòng đang chờ.';
    END IF;

    UPDATE public.quiz_sessions
    SET
      status = 'closed',
      finished_at = v_now,
      paused_at = NULL
    WHERE id = p_session_id
    RETURNING * INTO v_session;

  END IF;

  -- 3. Chỉ trả thông tin phiên,
  -- không tiết lộ đáp án đúng.

  RETURN jsonb_build_object(
    'ok', TRUE,
    'session_id', v_session.id,
    'status', v_session.status,
    'current_question', v_session.current_question,
    'total_questions', v_total,
    'question_started_at',
      v_session.question_started_at,
    'started_at', v_session.started_at,
    'finished_at', v_session.finished_at
  );

END;
$$;


-- ==============================================
-- BẢO MẬT
-- Browser không được gọi trực tiếp RPC.
-- Server phải xác minh vai trò BTC trước.
-- ==============================================

REVOKE ALL ON FUNCTION
  public.quiz_host_control(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.quiz_host_control(UUID, TEXT)
TO service_role;

COMMIT;
