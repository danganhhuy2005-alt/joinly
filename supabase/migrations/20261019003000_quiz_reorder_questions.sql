
BEGIN;

-- ==========================================
-- JOINLY QUIZ - ĐỔI THỨ TỰ CÂU HỎI
-- ==========================================

CREATE OR REPLACE FUNCTION
public.quiz_move_question(
  p_quiz_id UUID,
  p_question_id UUID,
  p_direction TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_ids UUID[];
  v_count INTEGER;
  v_current INTEGER;
  v_target INTEGER;
  v_temp UUID;
BEGIN

  -- Chỉ nhận lệnh lên hoặc xuống.
  IF p_direction IS NULL
     OR p_direction NOT IN ('up', 'down')
  THEN
    RAISE EXCEPTION 'Hướng di chuyển không hợp lệ.';
  END IF;

  -- Khóa bộ Quiz để các lệnh đổi thứ tự
  -- không chạy chồng lên nhau.
  PERFORM 1
  FROM public.quizzes
  WHERE id = p_quiz_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy Quiz.';
  END IF;

  -- Không thay đổi bộ câu hỏi
  -- đã có người tham gia.
  IF EXISTS (
    SELECT 1
    FROM public.quiz_attempts
    WHERE quiz_id = p_quiz_id
  ) THEN
    RAISE EXCEPTION
      'Quiz đã có người tham gia, không thể đổi thứ tự.';
  END IF;

  -- Không thay đổi khi có phiên đang mở.
  IF EXISTS (
    SELECT 1
    FROM public.quiz_sessions
    WHERE quiz_id = p_quiz_id
      AND status IN ('waiting', 'active', 'paused')
  ) THEN
    RAISE EXCEPTION
      'Hãy đóng phiên Quiz đang mở trước.';
  END IF;

  -- Lấy danh sách theo thứ tự thực tế
  -- giống cách Host và người chơi đọc.
  SELECT ARRAY_AGG(id ORDER BY position ASC, id ASC)
  INTO v_ids
  FROM public.quiz_questions
  WHERE quiz_id = p_quiz_id;

  v_count := COALESCE(
    ARRAY_LENGTH(v_ids, 1),
    0
  );

  IF v_count > 1001 THEN
    RAISE EXCEPTION
      'Bộ Quiz vượt giới hạn thứ tự câu hỏi.';
  END IF;

  v_current := ARRAY_POSITION(
    v_ids,
    p_question_id
  );

  IF v_current IS NULL THEN
    RAISE EXCEPTION
      'Không tìm thấy câu hỏi trong Quiz.';
  END IF;

  -- Xác định vị trí mới.
  IF p_direction = 'up' THEN
    v_target := v_current - 1;
  ELSE
    v_target := v_current + 1;
  END IF;

  -- Đã ở đầu/cuối thì không cần đổi.
  IF v_target < 1 OR v_target > v_count THEN
    RETURN jsonb_build_object(
      'ok', TRUE,
      'moved', FALSE,
      'position', v_current - 1
    );
  END IF;

  -- Hoán đổi hai câu liền kề.
  v_temp := v_ids[v_current];

  v_ids[v_current] := v_ids[v_target];

  v_ids[v_target] := v_temp;

  -- Cập nhật toàn bộ position
  -- bằng một câu SQL duy nhất.
  -- Nếu lỗi, PostgreSQL rollback cả lệnh.
  UPDATE public.quiz_questions AS q
  SET position = ordered.ordinal::INTEGER - 1
  FROM UNNEST(v_ids) WITH ORDINALITY
    AS ordered(question_id, ordinal)
  WHERE q.id = ordered.question_id
    AND q.quiz_id = p_quiz_id;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'moved', TRUE,
    'position', v_target - 1
  );

END;
$$;

-- Browser không được gọi trực tiếp.
-- Backend phải kiểm tra vai trò BTC trước.

REVOKE ALL ON FUNCTION
  public.quiz_move_question(UUID, UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.quiz_move_question(UUID, UUID, TEXT)
TO service_role;

COMMIT;
