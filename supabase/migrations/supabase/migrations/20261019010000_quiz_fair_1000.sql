
BEGIN;

DO $joinly$
DECLARE
  v_control TEXT;
  v_scoring TEXT;
  v_old_branch TEXT;
  v_new_branch TEXT;
BEGIN

  -- ======================================
  -- LIVE INTRO = 9 GIÂY
  -- 5 giây hiện từng từ
  -- 4 giây hiện đáp án
  -- ======================================

  v_control := pg_get_functiondef(
    'public.quiz_live_auto_control(uuid,text)'::regprocedure
  );

  IF position('v_duration := 9;' IN v_control) = 0 THEN

    IF position('v_duration := 5;' IN v_control) = 0 THEN
      RAISE EXCEPTION
        'Cấu trúc Live Control không khớp. Dừng cập nhật.';
    END IF;

    v_control := replace(
      v_control,
      'v_duration := 5;',
      'v_duration := 9;'
    );

    EXECUTE v_control;
  END IF;


  -- ======================================
  -- FAIR SCORING
  -- MỌI NGƯỜI ĐÚNG TRONG 0,5S = 1000
  -- ======================================

  v_scoring := pg_get_functiondef(
    'public.quiz_submit_answer(uuid,text,uuid,integer)'::regprocedure
  );

  v_old_branch :=
    E'  ELSIF v_s.mode = ''live''\n'
    || E'        AND v_s.auto_play_enabled\n'
    || E'  THEN';

  v_new_branch :=
    E'  ELSIF v_s.mode = ''live''\n'
    || E'        AND v_s.auto_play_enabled\n'
    || E'        AND v_elapsed <= 0.5\n'
    || E'  THEN\n'
    || E'    v_points := 1000;\n\n'
    || v_old_branch;

  -- Không thêm nhánh trùng nếu đã sửa trước.

  IF position('AND v_elapsed <= 0.5' IN v_scoring) = 0 THEN

    IF position(v_old_branch IN v_scoring) = 0 THEN
      RAISE EXCEPTION
        'Cấu trúc chấm điểm không khớp. Dừng cập nhật.';
    END IF;

    v_scoring := replace(
      v_scoring,
      v_old_branch,
      v_new_branch
    );

  END IF;


  -- ======================================
  -- SAU 0,5S ĐIỂM GIẢM DẦN
  -- ======================================

  IF position(
    '1 - GREATEST(0, v_elapsed - 0.5) / v_q.time_limit_seconds'
    IN v_scoring
  ) = 0 THEN

    IF position(
      '1 - v_elapsed / v_q.time_limit_seconds'
      IN v_scoring
    ) = 0 THEN
      RAISE EXCEPTION
        'Không tìm thấy công thức thời gian cần cập nhật.';
    END IF;

    v_scoring := replace(
      v_scoring,
      '1 - v_elapsed / v_q.time_limit_seconds',
      '1 - GREATEST(0, v_elapsed - 0.5) / v_q.time_limit_seconds'
    );

  END IF;

  EXECUTE v_scoring;

END;
$joinly$;

COMMIT;
