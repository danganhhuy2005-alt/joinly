CREATE OR REPLACE FUNCTION public.process_sepay_payment(
  p_order_code text,
  p_transaction_id bigint,
  p_transfer_amount bigint,
  p_gateway text,
  p_reference_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_plan public.billing_plans%ROWTYPE;

  v_start timestamptz;
  v_latest_expiry timestamptz;
BEGIN

  -- Khóa payment lại để 2 webhook không xử lý đồng thời
  SELECT *
  INTO v_payment
  FROM public.payments
  WHERE order_code = p_order_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'payment_not_found'
    );
  END IF;

  -- Đã xử lý webhook này rồi
  IF v_payment.status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', true,
      'reason', 'already_paid',
      'payment_id', v_payment.id
    );
  END IF;

  -- Đơn đã hủy/refund thì không cấp gói
  IF v_payment.status IN ('cancelled', 'refunded') THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'invalid_payment_status'
    );
  END IF;

  -- Kiểm tra số tiền CHÍNH XÁC
  IF v_payment.amount_vnd <> p_transfer_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'amount_mismatch',
      'expected', v_payment.amount_vnd,
      'received', p_transfer_amount
    );
  END IF;

  -- Chống 1 transaction SePay dùng cho nhiều payment
  IF EXISTS (
    SELECT 1
    FROM public.payments
    WHERE sepay_transaction_id = p_transaction_id
      AND id <> v_payment.id
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'transaction_already_used'
    );
  END IF;

  SELECT *
  INTO v_plan
  FROM public.billing_plans
  WHERE code = v_payment.plan_code
    AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing plan not found';
  END IF;

  -- =========================================
  -- ĐÁNH DẤU PAYMENT PAID
  -- =========================================

  UPDATE public.payments
  SET
    status = 'paid',
    sepay_transaction_id = p_transaction_id,
    sepay_reference_code = p_reference_code,
    bank_gateway = p_gateway,
    paid_at = now()
  WHERE id = v_payment.id;

  -- =========================================
  -- SMALL / STANDARD / PRO
  -- =========================================

  IF v_plan.billing_type = 'event' THEN

    IF v_payment.event_id IS NULL THEN
      RAISE EXCEPTION 'Event payment has no event_id';
    END IF;

    UPDATE public.events
    SET
      plan_code = v_plan.code,
      attendee_limit = v_plan.attendee_limit
    WHERE id = v_payment.event_id;

  -- =========================================
  -- MONTHLY
  -- =========================================

  ELSIF v_plan.billing_type = 'monthly' THEN

    -- Nếu đã có Monthly thì gói mới nối tiếp gói cũ
    SELECT MAX(expires_at)
    INTO v_latest_expiry
    FROM public.user_subscriptions
    WHERE user_id = v_payment.user_id
      AND plan_code = 'monthly'
      AND expires_at > now();

    v_start := GREATEST(
      now(),
      COALESCE(v_latest_expiry, now())
    );

    INSERT INTO public.user_subscriptions (
      user_id,
      plan_code,
      payment_id,
      status,
      starts_at,
      expires_at,
      event_limit
    )
    VALUES (
      v_payment.user_id,
      'monthly',
      v_payment.id,
      'active',
      v_start,
      v_start + make_interval(
        days => COALESCE(v_plan.duration_days, 30)
      ),
      COALESCE(v_plan.event_limit, 3)
    );

  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'reason', 'payment_completed',
    'payment_id', v_payment.id,
    'plan_code', v_plan.code
  );

END;
$$;

-- User bình thường tuyệt đối không được tự gọi function này
REVOKE ALL
ON FUNCTION public.process_sepay_payment(
  text,
  bigint,
  bigint,
  text,
  text
)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.process_sepay_payment(
  text,
  bigint,
  bigint,
  text,
  text
)
FROM anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.process_sepay_payment(
  text,
  bigint,
  bigint,
  text,
  text
)
TO service_role;