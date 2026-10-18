
BEGIN;

-- ==========================================
-- JOINLY FEEDBACK
-- RPC GỬI PHẢN HỒI SỰ KIỆN
-- ==========================================

CREATE OR REPLACE FUNCTION public.submit_feedback_response(
  p_form_id UUID,
  p_email TEXT,
  p_answers JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event_id UUID;
  v_status TEXT;
  v_email TEXT;
  v_participant_id UUID;
  v_submission_id UUID;

  v_item JSONB;
  v_value JSONB;
  v_question public.feedback_questions%ROWTYPE;
  v_question_id UUID;
  v_question_id_text TEXT;

  v_seen UUID[] := ARRAY[]::UUID[];
  v_count INTEGER;
  v_distinct_count INTEGER;
  v_missing_required BOOLEAN;
BEGIN

  -- 1. KIỂM TRA BIỂU MẪU
  SELECT f.event_id, f.status
  INTO v_event_id, v_status
  FROM public.feedback_forms f
  WHERE f.id = p_form_id
  FOR SHARE;

  IF v_event_id IS NULL OR v_status <> 'open' THEN
    RETURN jsonb_build_object('status', 'closed');
  END IF;

  -- 2. CHUẨN HÓA EMAIL
  v_email := lower(btrim(p_email));

  IF v_email IS NULL
     OR length(v_email) NOT BETWEEN 3 AND 320 THEN
    RETURN jsonb_build_object('status', 'not_registered');
  END IF;

  -- 3. XÁC NHẬN THAM GIA ĐÚNG SỰ KIỆN
  SELECT p.id
  INTO v_participant_id
  FROM public.participants p
  WHERE p.event_id = v_event_id
    AND lower(btrim(p.email)) = v_email
  ORDER BY p.created_at, p.id
  LIMIT 1;

  IF v_participant_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_registered');
  END IF;

  -- 4. KIỂM TRA ĐÃ GỬI CHƯA
  IF EXISTS (
    SELECT 1
    FROM public.feedback_submissions s
    WHERE s.form_id = p_form_id
      AND s.email_normalized = v_email
  ) THEN
    RETURN jsonb_build_object('status', 'already_submitted');
  END IF;

  -- 5. KIỂM TRA DANH SÁCH CÂU TRẢ LỜI
  IF jsonb_typeof(p_answers) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('status', 'invalid_answers');
  END IF;

  IF jsonb_array_length(p_answers) NOT BETWEEN 1 AND 100 THEN
    RETURN jsonb_build_object('status', 'invalid_answers');
  END IF;

  -- 6. KIỂM TRA TỪNG CÂU TRẢ LỜI
  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_answers)
  LOOP

    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RETURN jsonb_build_object('status', 'invalid_answers');
    END IF;

    v_question_id_text := v_item ->> 'question_id';
    v_value := v_item -> 'value';

    IF v_question_id_text IS NULL
       OR v_question_id_text !~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT (v_item ? 'value') THEN
      RETURN jsonb_build_object('status', 'invalid_answers');
    END IF;

    v_question_id := v_question_id_text::UUID;

    -- Không cho trả lời trùng câu hỏi
    IF v_question_id = ANY(v_seen) THEN
      RETURN jsonb_build_object('status', 'invalid_answers');
    END IF;

    v_seen := array_append(v_seen, v_question_id);

    -- Chỉ nhận câu hỏi thuộc đúng form
    SELECT q.*
    INTO v_question
    FROM public.feedback_questions q
    WHERE q.id = v_question_id
      AND q.form_id = p_form_id
    FOR SHARE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('status', 'invalid_answers');
    END IF;

    -- ĐÁNH GIÁ 1-5 SAO
    IF v_question.question_type = 'rating' THEN

      IF jsonb_typeof(v_value) IS DISTINCT FROM 'number'
         OR v_value::TEXT NOT IN ('1', '2', '3', '4', '5') THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

    -- CÂU TRẢ LỜI NGẮN
    ELSIF v_question.question_type = 'short_text' THEN

      IF jsonb_typeof(v_value) IS DISTINCT FROM 'string' THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

      IF length(btrim(v_value #>> '{}')) NOT BETWEEN 1 AND 500 THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

    -- CÂU TRẢ LỜI DÀI
    ELSIF v_question.question_type = 'long_text' THEN

      IF jsonb_typeof(v_value) IS DISTINCT FROM 'string' THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

      IF length(btrim(v_value #>> '{}')) NOT BETWEEN 1 AND 2000 THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

    -- MỘT LỰA CHỌN
    ELSIF v_question.question_type = 'single_choice' THEN

      IF jsonb_typeof(v_value) IS DISTINCT FROM 'string' THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

      IF NOT (
        v_question.options @> jsonb_build_array(v_value)
      ) THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

    -- NHIỀU LỰA CHỌN
    ELSIF v_question.question_type = 'multi_choice' THEN

      IF jsonb_typeof(v_value) IS DISTINCT FROM 'array' THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

      v_count := jsonb_array_length(v_value);

      IF v_count NOT BETWEEN 1 AND 30 THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

      -- Giới hạn Checkbox của BTC
      IF v_question.max_choices IS NOT NULL
         AND v_count > v_question.max_choices THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

      -- Chỉ nhận các phương án có sẵn
      IF NOT (v_question.options @> v_value) THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

      -- Từng phần tử phải là chuỗi
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_value) AS a(value)
        WHERE jsonb_typeof(a.value) <> 'string'
      ) THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

      -- Không chấp nhận đáp án trùng nhau
      SELECT
        count(*),
        count(DISTINCT a.value)
      INTO v_count, v_distinct_count
      FROM jsonb_array_elements(v_value) AS a(value);

      IF v_count <> v_distinct_count THEN
        RETURN jsonb_build_object('status', 'invalid_answers');
      END IF;

    ELSE
      RETURN jsonb_build_object('status', 'invalid_answers');
    END IF;

  END LOOP;

  -- 7. KIỂM TRA CÂU HỎI BẮT BUỘC
  SELECT EXISTS (
    SELECT 1
    FROM public.feedback_questions q
    WHERE q.form_id = p_form_id
      AND q.is_required = true
      AND NOT (q.id = ANY(v_seen))
  )
  INTO v_missing_required;

  IF v_missing_required THEN
    RETURN jsonb_build_object('status', 'invalid_answers');
  END IF;

  -- 8. TẠO LƯỢT GỬI
  -- Unique constraint xử lý cả trường hợp gửi đồng thời
  INSERT INTO public.feedback_submissions (
    form_id,
    participant_id,
    email_normalized
  )
  VALUES (
    p_form_id,
    v_participant_id,
    v_email
  )
  ON CONFLICT (form_id, email_normalized) DO NOTHING
  RETURNING id INTO v_submission_id;

  IF v_submission_id IS NULL THEN
    RETURN jsonb_build_object('status', 'already_submitted');
  END IF;

  -- 9. LƯU TẤT CẢ CÂU TRẢ LỜI
  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_answers)
  LOOP

    INSERT INTO public.feedback_answers (
      form_id,
      submission_id,
      question_id,
      answer
    )
    VALUES (
      p_form_id,
      v_submission_id,
      (v_item ->> 'question_id')::UUID,
      v_item -> 'value'
    );

  END LOOP;

  RETURN jsonb_build_object('status', 'ok');

END;
$$;

-- ==========================================
-- QUYỀN GỌI RPC
-- ==========================================

REVOKE ALL
ON FUNCTION public.submit_feedback_response(UUID, TEXT, JSONB)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.submit_feedback_response(UUID, TEXT, JSONB)
TO service_role;

COMMIT;
