
BEGIN;

-- ============================================
-- JOINLY APP REVIEWS
-- HỆ THỐNG ĐÁNH GIÁ ỨNG DỤNG
-- ============================================

-- 1. BẢNG ĐÁNH GIÁ JOINLY

CREATE TABLE IF NOT EXISTS public.joinly_app_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  email_normalized TEXT NOT NULL UNIQUE
    CHECK (
      length(email_normalized) BETWEEN 3 AND 320
      AND email_normalized = lower(btrim(email_normalized))
    ),

  source_submission_id UUID UNIQUE
    REFERENCES public.feedback_submissions(id)
    ON DELETE SET NULL,

  rating SMALLINT NOT NULL
    CHECK (rating BETWEEN 1 AND 5),

  comment TEXT
    CHECK (
      comment IS NULL
      OR length(btrim(comment)) BETWEEN 1 AND 1000
    ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_joinly_app_reviews_created
ON public.joinly_app_reviews(created_at DESC);


-- ============================================
-- 2. BẢNG LỜI MỜI ĐÁNH GIÁ JOINLY
-- ============================================

CREATE TABLE IF NOT EXISTS public.joinly_app_review_invites (
  submission_id UUID PRIMARY KEY
    REFERENCES public.feedback_submissions(id)
    ON DELETE CASCADE,

  -- Chỉ lưu SHA-256, không lưu token gốc
  token_hash TEXT NOT NULL UNIQUE
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),

  expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_joinly_app_review_invites_expires
ON public.joinly_app_review_invites(expires_at);


-- ============================================
-- 3. BẢO MẬT DỮ LIỆU
-- ============================================

ALTER TABLE public.joinly_app_reviews
ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.joinly_app_review_invites
ENABLE ROW LEVEL SECURITY;

-- Không cho người dùng đọc đánh giá trực tiếp

REVOKE ALL
ON TABLE public.joinly_app_reviews
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON TABLE public.joinly_app_review_invites
FROM PUBLIC, anon, authenticated;

-- Chỉ backend sử dụng service_role

GRANT ALL
ON TABLE public.joinly_app_reviews
TO service_role;

GRANT ALL
ON TABLE public.joinly_app_review_invites
TO service_role;


-- ============================================
-- 4. RPC GỬI ĐÁNH GIÁ JOINLY
-- ============================================

CREATE OR REPLACE FUNCTION public.submit_joinly_app_review(
  p_token_hash TEXT,
  p_rating SMALLINT,
  p_comment TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission_id UUID;
  v_email TEXT;
  v_comment TEXT;
  v_review_id UUID;
BEGIN

  -- KIỂM TRA TOKEN

  IF p_token_hash IS NULL
     OR p_token_hash !~ '^[0-9a-f]{64}$' THEN

    RETURN jsonb_build_object(
      'status', 'unavailable'
    );
  END IF;

  -- KIỂM TRA SỐ SAO

  IF p_rating IS NULL
     OR p_rating NOT BETWEEN 1 AND 5 THEN

    RETURN jsonb_build_object(
      'status', 'invalid_rating'
    );
  END IF;

  -- KIỂM TRA NHẬN XÉT

  IF p_comment IS NOT NULL
     AND length(btrim(p_comment)) NOT BETWEEN 1 AND 1000 THEN

    RETURN jsonb_build_object(
      'status', 'invalid_comment'
    );
  END IF;

  v_comment := NULLIF(btrim(p_comment), '');

  -- TÌM LỜI MỜI CÒN HIỆU LỰC
  -- KHÓA DÒNG ĐỂ TRÁNH GỬI ĐỒNG THỜI

  SELECT
    i.submission_id,
    s.email_normalized
  INTO
    v_submission_id,
    v_email

  FROM public.joinly_app_review_invites i

  JOIN public.feedback_submissions s
    ON s.id = i.submission_id

  WHERE i.token_hash = p_token_hash
    AND i.expires_at > now()

  FOR UPDATE OF i;

  IF NOT FOUND THEN

    RETURN jsonb_build_object(
      'status', 'unavailable'
    );

  END IF;

  -- MỖI EMAIL CHỈ ĐƯỢC ĐÁNH GIÁ JOINLY MỘT LẦN

  IF EXISTS (
    SELECT 1
    FROM public.joinly_app_reviews r
    WHERE r.email_normalized = v_email
       OR r.source_submission_id = v_submission_id
  ) THEN

    RETURN jsonb_build_object(
      'status', 'already_reviewed'
    );

  END IF;

  -- LƯU ĐÁNH GIÁ

  INSERT INTO public.joinly_app_reviews (
    email_normalized,
    source_submission_id,
    rating,
    comment
  )
  VALUES (
    v_email,
    v_submission_id,
    p_rating,
    v_comment
  )

  ON CONFLICT DO NOTHING

  RETURNING id INTO v_review_id;

  -- CHỐNG GỬI TRÙNG KHI HAI YÊU CẦU ĐỒNG THỜI

  IF v_review_id IS NULL THEN

    RETURN jsonb_build_object(
      'status', 'already_reviewed'
    );

  END IF;

  -- XÓA TOKEN SAU KHI DÙNG THÀNH CÔNG

  DELETE FROM public.joinly_app_review_invites
  WHERE submission_id = v_submission_id;

  RETURN jsonb_build_object(
    'status', 'ok'
  );

END;
$$;


-- ============================================
-- 5. GIỚI HẠN QUYỀN GỌI RPC
-- ============================================

REVOKE ALL
ON FUNCTION public.submit_joinly_app_review(
  TEXT, SMALLINT, TEXT
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.submit_joinly_app_review(
  TEXT, SMALLINT, TEXT
)
TO service_role;

COMMIT;
