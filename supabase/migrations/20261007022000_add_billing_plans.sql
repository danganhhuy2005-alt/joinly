-- ============================================
-- JOINLY BILLING PLANS
-- ============================================

CREATE TABLE public.billing_plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  price_vnd integer NOT NULL DEFAULT 0,

  -- event = mua cho từng sự kiện
  -- monthly = gói theo tài khoản
  billing_type text NOT NULL
    CHECK (billing_type IN ('event', 'monthly')),

  -- Giới hạn người của mỗi event
  -- Monthly hiện chưa chốt nên để NULL
  attendee_limit integer,

  -- Chỉ dùng cho Monthly
  event_limit integer,
  duration_days integer,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- CÁC GÓI JOINLY
-- ============================================

INSERT INTO public.billing_plans (
  code,
  name,
  price_vnd,
  billing_type,
  attendee_limit,
  event_limit,
  duration_days
)
VALUES
  ('free', 'Free', 0, 'event', 50, NULL, NULL),

  ('small', 'Small', 50000, 'event', 100, NULL, NULL),

  ('standard', 'Standard', 88000, 'event', 300, NULL, NULL),

  ('pro', 'Pro', 199000, 'event', 700, NULL, NULL),

  ('monthly', 'Monthly', 150000, 'monthly', NULL, 3, 30);

-- ============================================
-- RLS
-- ============================================

ALTER TABLE public.billing_plans
ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view billing plans"
ON public.billing_plans
FOR SELECT
TO anon, authenticated
USING (true);

GRANT SELECT ON public.billing_plans
TO anon, authenticated;

GRANT ALL ON public.billing_plans
TO service_role;

-- ============================================
-- EVENT PLAN
-- ============================================

ALTER TABLE public.events
ADD COLUMN plan_code text NOT NULL DEFAULT 'free';

ALTER TABLE public.events
ADD COLUMN attendee_limit integer NOT NULL DEFAULT 50;

ALTER TABLE public.events
ADD CONSTRAINT events_plan_code_fkey
FOREIGN KEY (plan_code)
REFERENCES public.billing_plans(code);

ALTER TABLE public.events
ADD CONSTRAINT events_attendee_limit_check
CHECK (attendee_limit > 0);

-- ============================================
-- KHÓA BILLING FIELDS
-- User bình thường không được tự nâng gói
-- ============================================

CREATE OR REPLACE FUNCTION public.protect_event_billing_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN

    IF NEW.plan_code IS DISTINCT FROM OLD.plan_code
       OR NEW.attendee_limit IS DISTINCT FROM OLD.attendee_limit
    THEN
      RAISE EXCEPTION
        'Bạn không có quyền thay đổi gói của sự kiện.';
    END IF;

  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_event_billing_fields_trigger
BEFORE UPDATE OF plan_code, attendee_limit
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.protect_event_billing_fields();