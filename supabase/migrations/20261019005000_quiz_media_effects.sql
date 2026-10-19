
BEGIN;

-- ============================================
-- JOINLY QUIZ - 16 HIỆU ỨNG ẢNH
-- ============================================

-- Mỗi câu hỏi có thể chọn một hiệu ứng riêng.
-- Mặc định: Che 9 ô.
-- Câu không có ảnh sẽ bỏ qua hiệu ứng.

ALTER TABLE public.quiz_questions
ADD COLUMN IF NOT EXISTS media_effect TEXT
NOT NULL DEFAULT 'tiles9';

-- Giới hạn đúng 16 hiệu ứng được hỗ trợ.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'quiz_questions_media_effect_check'
      AND conrelid = 'public.quiz_questions'::regclass
  ) THEN

    ALTER TABLE public.quiz_questions
    ADD CONSTRAINT quiz_questions_media_effect_check
    CHECK (
      media_effect IN (
        'full',
        'tiles4',
        'tiles9',
        'tiles16',
        'random',
        'flip',
        'blur',
        'pixel',
        'left',
        'right',
        'down',
        'up',
        'center',
        'circle',
        'zoom',
        'spotlight'
      )
    );

  END IF;
END;
$$;

COMMENT ON COLUMN
public.quiz_questions.media_effect
IS 'Hiệu ứng ảnh/GIF riêng cho câu hỏi Quiz; mặc định tiles9.';

COMMIT;
