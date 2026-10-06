-- ============================================
-- JOINLY USER SUBSCRIPTIONS
-- Dùng cho gói Monthly
-- ============================================

CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  plan_code text NOT NULL
    REFERENCES public.billing_plans(code),

  -- Payment đã kích hoạt subscription này
  payment_id uuid
    REFERENCES public.payments(id)
    ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'active'
    CHECK (
      status IN (
        'active',
        'expired',
        'cancelled'
      )
    ),

  starts_at timestamptz NOT NULL DEFAULT now(),

  expires_at timestamptz NOT NULL,

  -- Monthly hiện tại tối đa 3 event / chu kỳ
  event_limit integer NOT NULL DEFAULT 3,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- INDEX
-- ============================================

CREATE INDEX user_subscriptions_user_id_idx
ON public.user_subscriptions(user_id);

CREATE INDEX user_subscriptions_status_idx
ON public.user_subscriptions(status);

CREATE INDEX user_subscriptions_expires_at_idx
ON public.user_subscriptions(expires_at);

-- ============================================
-- UPDATED_AT
-- ============================================

CREATE TRIGGER user_subscriptions_updated_at
BEFORE UPDATE ON public.user_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ============================================
-- RLS
-- ============================================

ALTER TABLE public.user_subscriptions
ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own subscriptions"
ON public.user_subscriptions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

GRANT SELECT ON public.user_subscriptions
TO authenticated;

GRANT ALL ON public.user_subscriptions
TO service_role;

-- ============================================
-- EVENTS USED BY MONTHLY SUBSCRIPTION
-- ============================================

CREATE TABLE public.subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  subscription_id uuid NOT NULL
    REFERENCES public.user_subscriptions(id)
    ON DELETE CASCADE,

  event_id uuid NOT NULL
    REFERENCES public.events(id)
    ON DELETE CASCADE,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (subscription_id, event_id)
);

CREATE INDEX subscription_events_subscription_id_idx
ON public.subscription_events(subscription_id);

CREATE INDEX subscription_events_event_id_idx
ON public.subscription_events(event_id);

ALTER TABLE public.subscription_events
ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their subscription events"
ON public.subscription_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_subscriptions s
    WHERE s.id = subscription_id
      AND s.user_id = auth.uid()
  )
);

GRANT SELECT ON public.subscription_events
TO authenticated;

GRANT ALL ON public.subscription_events
TO service_role;

-- ============================================
-- KIỂM TRA MONTHLY CÒN SLOT EVENT KHÔNG
-- ============================================

CREATE OR REPLACE FUNCTION public.get_active_monthly_subscription(
  p_user_id uuid
)
RETURNS TABLE (
  subscription_id uuid,
  expires_at timestamptz,
  event_limit integer,
  events_used bigint,
  events_remaining bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.expires_at,
    s.event_limit,
    COUNT(se.id) AS events_used,
    GREATEST(
      s.event_limit - COUNT(se.id),
      0
    ) AS events_remaining
  FROM public.user_subscriptions s
  LEFT JOIN public.subscription_events se
    ON se.subscription_id = s.id
  WHERE s.user_id = p_user_id
    AND s.plan_code = 'monthly'
    AND s.status = 'active'
    AND s.starts_at <= now()
    AND s.expires_at > now()
  GROUP BY
    s.id,
    s.expires_at,
    s.event_limit
  ORDER BY s.expires_at DESC
  LIMIT 1;
$$;